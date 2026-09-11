import Database from "better-sqlite3";
import path from "node:path";

export type EmailStatus =
  | "new"
  | "classified"
  | "pending_approval"
  | "sent"
  | "ignored";

export type EmailCategory =
  | "sales_lead"
  | "support"
  | "spam"
  | "newsletter"
  | "personal"
  | "other";

export type EmailRow = {
  id: number;
  message_id: string;
  from_address: string;
  subject: string;
  body_snippet: string;
  received_at: string;
  category: EmailCategory | null;
  confidence: number | null;
  lead_score: number | null;
  company_name: string | null;
  intent_summary: string | null;
  reasoning: string | null;
  draft_reply: string | null;
  status: EmailStatus;
};

export type NewEmail = {
  message_id: string;
  from_address: string;
  subject: string;
  body_snippet: string;
  received_at: string;
};

export type EmailClassification = {
  category: EmailCategory;
  confidence: number;
  lead_score: number;
  company_name: string | null;
  intent_summary: string | null;
  reasoning: string;
};

const CREATE_EMAILS_TABLE = `
  CREATE TABLE IF NOT EXISTS emails (
    id INTEGER PRIMARY KEY,
    message_id TEXT UNIQUE,
    from_address TEXT,
    subject TEXT,
    body_snippet TEXT,
    received_at TEXT,
    category TEXT,
    confidence REAL,
    lead_score INTEGER,
    company_name TEXT,
    intent_summary TEXT,
    reasoning TEXT,
    draft_reply TEXT,
    status TEXT
  )
`;

let db: Database.Database | null = null;

function dbPath(): string {
  return process.env.SQLITE_PATH ?? path.join(process.cwd(), "db.sqlite");
}

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(dbPath());
    db.pragma("journal_mode = WAL");
    db.exec(CREATE_EMAILS_TABLE);
  }
  return db;
}

function getEmailByMessageId(messageId: string): EmailRow | undefined {
  return getDb()
    .prepare("SELECT * FROM emails WHERE message_id = ?")
    .get(messageId) as EmailRow | undefined;
}

/**
 * Inserts a new email with status `new`.
 * If `message_id` already exists, the existing row is returned unchanged.
 */
export function insertEmail(email: NewEmail): { row: EmailRow; inserted: boolean } {
  const existing = getEmailByMessageId(email.message_id);
  if (existing) {
    return { row: existing, inserted: false };
  }

  getDb()
    .prepare(
      `
      INSERT INTO emails (
        message_id, from_address, subject, body_snippet, received_at, status
      ) VALUES (?, ?, ?, ?, ?, 'new')
    `,
    )
    .run(
      email.message_id,
      email.from_address,
      email.subject,
      email.body_snippet,
      email.received_at,
    );

  const row = getEmailByMessageId(email.message_id);
  if (!row) {
    throw new Error(`Failed to insert email ${email.message_id}`);
  }
  return { row, inserted: true };
}

export function updateEmailClassification(
  id: number,
  classification: EmailClassification,
): EmailRow {
  const result = getDb()
    .prepare(
      `
      UPDATE emails
      SET
        category = ?,
        confidence = ?,
        lead_score = ?,
        company_name = ?,
        intent_summary = ?,
        reasoning = ?,
        status = 'classified'
      WHERE id = ?
    `,
    )
    .run(
      classification.category,
      classification.confidence,
      classification.lead_score,
      classification.company_name,
      classification.intent_summary,
      classification.reasoning,
      id,
    );

  if (result.changes === 0) {
    throw new Error(`No email found with id ${id}`);
  }

  const row = getEmailById(id);
  if (!row) {
    throw new Error(`No email found with id ${id}`);
  }
  return row;
}

export function updateEmailDraft(id: number, draftReply: string): EmailRow {
  const result = getDb()
    .prepare("UPDATE emails SET draft_reply = ? WHERE id = ?")
    .run(draftReply, id);

  if (result.changes === 0) {
    throw new Error(`No email found with id ${id}`);
  }

  const row = getEmailById(id);
  if (!row) {
    throw new Error(`No email found with id ${id}`);
  }
  return row;
}

export function updateEmailStatus(id: number, status: EmailStatus): EmailRow {
  const result = getDb()
    .prepare("UPDATE emails SET status = ? WHERE id = ?")
    .run(status, id);

  if (result.changes === 0) {
    throw new Error(`No email found with id ${id}`);
  }

  const row = getEmailById(id);
  if (!row) {
    throw new Error(`No email found with id ${id}`);
  }
  return row;
}

export function getAllEmails(): EmailRow[] {
  return getDb()
    .prepare("SELECT * FROM emails ORDER BY received_at DESC, id DESC")
    .all() as EmailRow[];
}

export function getEmailById(id: number): EmailRow | undefined {
  return getDb().prepare("SELECT * FROM emails WHERE id = ?").get(id) as
    | EmailRow
    | undefined;
}
