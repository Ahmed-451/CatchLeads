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

const BODY_SNIPPET_LENGTH = 5_000;
const CLASSIFICATION_DELAY_MS = 1_250;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
    await insertEmail({
      message_id: email.messageId,
      from_address: email.from,
      subject: email.subject,
      // This preserves enough context for classification and reply drafting.
      body_snippet: email.body.slice(0, BODY_SNIPPET_LENGTH),
      received_at: email.receivedAt,
    });
  }

  let classified = 0;
  let leadsFound = 0;
  const emailsToClassify = (await getAllEmails()).filter(
    (email) =>
      email.status === "new" ||
      // Retry only the explicit Gemini fallback on a later sync, never a valid classification.
      (email.status === "classified" && email.reasoning === "classification failed"),
  );
  let hasAttemptedClassification = false;

  // Process serially to make API usage predictable and to isolate failures.
  for (const email of emailsToClassify) {
    try {
      if (hasAttemptedClassification) {
        await wait(CLASSIFICATION_DELAY_MS);
      }
      hasAttemptedClassification = true;
      const classification = await classifyEmail(email.subject, email.body_snippet);
      await updateEmailClassification(email.id, classification);
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
          await updateEmailDraft(email.id, draft);
        } else {
          console.warn(`No draft generated for lead: ${email.subject}`);
        }
        await updateEmailStatus(email.id, "pending_approval");
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
