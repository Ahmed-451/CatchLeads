import { NextResponse } from "next/server";
import {
  getAllEmails,
  insertEmail,
  updateEmailClassification,
  updateEmailDraft,
  updateEmailStatus,
} from "@/lib/db";
import { classifyEmail, draftReply } from "@/lib/llm";
import { fetchUnreadEmails } from "@/lib/imap";

// IMAP, SQLite, and the Gemini SDK require Node.js APIs rather than Edge APIs.
export const runtime = "nodejs";
// Sync has side effects and must never return a cached response.
export const dynamic = "force-dynamic";

const BODY_SNIPPET_LENGTH = 5_000;
const CLASSIFICATION_DELAY_MS = 1_250;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logDbWriteFailure(subject: string, operation: string, error: unknown): void {
  console.error(`DB WRITE FAILED for ${subject} during ${operation}: ${errorMessage(error)}`, error);
}

/**
 * Imports unread messages, then processes every email waiting in the `new`
 * state. Re-running this route is safe: message_id prevents duplicate rows and
 * only unclassified rows are sent to Gemini.
 */
export async function POST() {
  let unreadEmails;

  try {
    unreadEmails = await fetchUnreadEmails();
  } catch (error) {
    console.error("Unable to fetch unread emails from IMAP.", error);
    return NextResponse.json(
      { error: "Unable to fetch unread emails. Check the IMAP connection and credentials." },
      { status: 500 },
    );
  }

  // Subject-only logging helps diagnose messages that are absent from a sync.
  console.log("Fetched unread subjects:", unreadEmails.map((email) => email.subject));

  // Persist first, so a later failure can be resumed on the next sync run.
  for (const email of unreadEmails) {
    try {
      await insertEmail({
        message_id: email.messageId,
        from_address: email.from,
        subject: email.subject,
        // This preserves enough context for classification and reply drafting.
        body_snippet: email.body.slice(0, BODY_SNIPPET_LENGTH),
        received_at: email.receivedAt,
      });
    } catch (error) {
      logDbWriteFailure(email.subject, "insertEmail", error);
    }
  }

  let classified = 0;
  let leadsFound = 0;
  let emailsToClassify;
  try {
    emailsToClassify = (await getAllEmails()).filter(
      (email) =>
        email.status === "new" ||
        // Retry only the explicit LLM fallback on a later sync, never a valid classification.
        (email.status === "classified" && email.reasoning === "classification failed"),
    );
  } catch (error) {
    console.error(`DB READ FAILED while loading sync queue: ${errorMessage(error)}`, error);
    return NextResponse.json({ error: "Unable to load persisted emails for processing." }, { status: 500 });
  }
  let hasAttemptedClassification = false;

  // Process serially to make API usage predictable and to isolate failures.
  for (const email of emailsToClassify) {
    try {
      if (hasAttemptedClassification) {
        await wait(CLASSIFICATION_DELAY_MS);
      }
      hasAttemptedClassification = true;
      const classification = await classifyEmail(email.subject, email.body_snippet);
      try {
        await updateEmailClassification(email.id, classification);
      } catch (error) {
        logDbWriteFailure(email.subject, "updateEmailClassification", error);
        continue;
      }
      classified += 1;

      console.log(
        `Classified: ${email.subject} -> ${classification.category} (${classification.lead_score})`,
      );

      if (
        classification.category === "sales_lead" &&
        classification.lead_score >= 50
      ) {
        leadsFound += 1;

        const draft = await draftReply(
          {
            from: email.from_address,
            subject: email.subject,
            body: email.body_snippet,
          },
          classification,
        );

        // A lead still needs human review if Gemini could not produce a draft.
        if (draft) {
          try {
            await updateEmailDraft(email.id, draft);
          } catch (error) {
            logDbWriteFailure(email.subject, "updateEmailDraft", error);
            continue;
          }
        } else {
          console.warn(`No draft generated for lead: ${email.subject}`);
        }
        try {
          await updateEmailStatus(email.id, "pending_approval");
        } catch (error) {
          logDbWriteFailure(email.subject, "updateEmailStatus", error);
          continue;
        }
      }
    } catch (error) {
      // Continue so one bad email cannot abort the rest of the mailbox sync.
      console.error(`Failed to process email ${email.id} (${email.subject}).`, error);
    }
  }

  return NextResponse.json({
    fetched: unreadEmails.length,
    classified,
    leadsFound,
  });
}
