import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

export type ParsedEmail = {
  messageId: string;
  from: string;
  subject: string;
  body: string;
  receivedAt: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getImapConfig() {
  const port = Number(requiredEnv("IMAP_PORT"));
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("IMAP_PORT must be a positive number");
  }

  return {
    host: requiredEnv("IMAP_HOST"),
    port,
    secure: true,
    auth: {
      user: requiredEnv("GMAIL_ADDRESS"),
      // Gmail App Passwords are often copied with spaces; IMAP rejects those.
      pass: requiredEnv("GMAIL_APP_PASSWORD").replace(/\s+/g, ""),
    },
    logger: false as const,
  };
}

function asText(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  return String(value);
}

/**
 * Connects to Gmail over IMAP and returns parsed unread INBOX messages.
 * Does not mark messages as seen.
 */
export async function fetchUnreadEmails(): Promise<ParsedEmail[]> {
  const client = new ImapFlow(getImapConfig());

  await client.connect();

  const emails: ParsedEmail[] = [];
  const lock = await client.getMailboxLock("INBOX");

  try {
    for await (const message of client.fetch(
      { seen: false },
      { source: true, envelope: true },
    )) {
      if (!message.source) {
        continue;
      }

      const parsed = await simpleParser(message.source);
      const fromAddress =
        parsed.from?.value?.[0]?.address || parsed.from?.text || "";
      const messageId =
        parsed.messageId ||
        message.envelope?.messageId ||
        `uid-${message.uid}`;

      emails.push({
        messageId,
        from: fromAddress,
        subject: asText(parsed.subject),
        body: parsed.text?.trim() || parsed.html || "",
        receivedAt: (parsed.date ?? new Date()).toISOString(),
      });
    }
  } finally {
    lock.release();
    await client.logout();
  }

  return emails;
}
