import { NextResponse } from "next/server";
import { getEmailById, updateEmailStatus } from "@/lib/db";
import { createSmtpTransport, getSenderAddress } from "@/lib/smtp";

export const runtime = "nodejs";

type RouteContext = {
  params: { id: string };
};

type SendPayload = {
  body?: unknown;
};

function parseEmailId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function replySubject(subject: string): string {
  return /^re\s*:/i.test(subject) ? subject : `Re: ${subject}`;
}

/**
 * Sends a reviewed lead reply. The status is intentionally changed only after
 * SMTP confirms success, making an SMTP failure safe to retry.
 *
 * Manual test plan:
 * 1. POST with no body to send the stored draft_reply.
 * 2. POST { "body": "...edited draft..." } to send the edited text.
 * 3. POST { "body": "   " } and expect HTTP 400 with no SMTP send.
 * 4. Repeat a successful request and expect HTTP 400 because status is sent.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const id = parseEmailId(params.id);
  if (!id) {
    return NextResponse.json(
      { error: "Email id must be a positive integer." },
      { status: 400 },
    );
  }

  let payload: SendPayload = {};
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      payload = (await request.json()) as SendPayload;
    }
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (payload.body !== undefined && typeof payload.body !== "string") {
    return NextResponse.json({ error: "body must be a string." }, { status: 400 });
  }

  const email = await getEmailById(id);
  if (!email) {
    return NextResponse.json({ error: "Email not found." }, { status: 404 });
  }

  if (email.status !== "pending_approval") {
    return NextResponse.json(
      { error: "Only emails pending approval can be sent." },
      { status: 400 },
    );
  }

  // An explicitly supplied body takes priority, including an empty value that
  // should fail validation instead of silently sending the stored draft.
  const finalBody = payload.body ?? email.draft_reply ?? "";
  if (!finalBody.trim()) {
    return NextResponse.json(
      { error: "Email body cannot be empty." },
      { status: 400 },
    );
  }

  try {
    const transport = createSmtpTransport();
    const info = await transport.sendMail({
      from: getSenderAddress(),
      to: email.from_address,
      subject: replySubject(email.subject),
      text: finalBody,
      inReplyTo: email.message_id,
      references: email.message_id,
    });

    await updateEmailStatus(id, "sent");
    console.log(`Sent reply for email ${id}: ${email.subject}`);

    return NextResponse.json({ id, status: "sent", messageId: info.messageId });
  } catch (error) {
    // Do not update the row: it remains pending_approval and can be retried.
    const reason = error instanceof Error ? error.message : "Unknown SMTP error";
    console.error(`Unable to send reply for email ${id}.`, error);
    return NextResponse.json(
      { error: "Unable to send email.", reason },
      { status: 500 },
    );
  }
}
