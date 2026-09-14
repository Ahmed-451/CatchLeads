import { createClient, type Client, type Row } from "@libsql/client";

export type EmailStatus = "new" | "classified" | "pending_approval" | "sent" | "ignored";
export type EmailCategory = "sales_lead" | "support" | "spam" | "newsletter" | "personal" | "other";

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

export type NewEmail = Pick<EmailRow, "message_id" | "from_address" | "subject" | "body_snippet" | "received_at">;
export type EmailClassification = Pick<EmailRow, "category" | "confidence" | "lead_score" | "company_name" | "intent_summary" | "reasoning"> & { category: EmailCategory; confidence: number; lead_score: number; reasoning: string };

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

let client: Client | null = null;
let schemaInitialization: Promise<void> | null = null;

function requiredEnv(name: "TURSO_DATABASE_URL" | "TURSO_AUTH_TOKEN"): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function getClient(): Client {
  if (!client) {
    client = createClient({ url: requiredEnv("TURSO_DATABASE_URL"), authToken: requiredEnv("TURSO_AUTH_TOKEN") });
  }
  return client;
}

/**
 * All database operations await this one shared initialization promise. If the
 * first network attempt fails, clear the cached rejection so a later request
 * can retry instead of leaving this server process permanently unusable.
 */
function ensureSchema(): Promise<void> {
  if (!schemaInitialization) {
    const initialization = getClient().execute(CREATE_EMAILS_TABLE).then(() => undefined);
    schemaInitialization = initialization;
    void initialization.catch(() => {
      if (schemaInitialization === initialization) schemaInitialization = null;
    });
  }
  return schemaInitialization;
}

function asString(value: unknown): string { return typeof value === "string" ? value : ""; }
function asNullableString(value: unknown): string | null { return typeof value === "string" ? value : null; }
function asNullableNumber(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }

/** Converts libSQL's generic row values into the app's strongly typed row. */
function toEmailRow(row: Row): EmailRow {
  const value = row as Record<string, unknown>;
  return {
    id: asNullableNumber(value.id) ?? 0,
    message_id: asString(value.message_id), from_address: asString(value.from_address),
    subject: asString(value.subject), body_snippet: asString(value.body_snippet), received_at: asString(value.received_at),
    category: asNullableString(value.category) as EmailCategory | null,
    confidence: asNullableNumber(value.confidence), lead_score: asNullableNumber(value.lead_score),
    company_name: asNullableString(value.company_name), intent_summary: asNullableString(value.intent_summary),
    reasoning: asNullableString(value.reasoning), draft_reply: asNullableString(value.draft_reply),
    status: asString(value.status) as EmailStatus,
  };
}

async function getEmailByMessageId(messageId: string): Promise<EmailRow | undefined> {
  await ensureSchema();
  const result = await getClient().execute({ sql: "SELECT * FROM emails WHERE message_id = ?", args: [messageId] });
  return result.rows[0] ? toEmailRow(result.rows[0]) : undefined;
}

/** Inserts with `new` status; message_id uniqueness makes repeat syncs idempotent. */
export async function insertEmail(email: NewEmail): Promise<{ row: EmailRow; inserted: boolean }> {
  await ensureSchema();
  const result = await getClient().execute({
    sql: "INSERT OR IGNORE INTO emails (message_id, from_address, subject, body_snippet, received_at, status) VALUES (?, ?, ?, ?, ?, 'new')",
    args: [email.message_id, email.from_address, email.subject, email.body_snippet, email.received_at],
  });
  const row = await getEmailByMessageId(email.message_id);
  if (!row) throw new Error(`Failed to insert email ${email.message_id}`);
  return { row, inserted: result.rowsAffected > 0 };
}

export async function updateEmailClassification(id: number, classification: EmailClassification): Promise<EmailRow> {
  await ensureSchema();
  const result = await getClient().execute({
    sql: "UPDATE emails SET category = ?, confidence = ?, lead_score = ?, company_name = ?, intent_summary = ?, reasoning = ?, status = 'classified' WHERE id = ?",
    args: [classification.category, classification.confidence, classification.lead_score, classification.company_name, classification.intent_summary, classification.reasoning, id],
  });
  if (result.rowsAffected === 0) throw new Error(`No email found with id ${id}`);
  const row = await getEmailById(id);
  if (!row) throw new Error(`No email found with id ${id}`);
  return row;
}

export async function updateEmailDraft(id: number, draftReply: string): Promise<EmailRow> {
  await ensureSchema();
  const result = await getClient().execute({ sql: "UPDATE emails SET draft_reply = ? WHERE id = ?", args: [draftReply, id] });
  if (result.rowsAffected === 0) throw new Error(`No email found with id ${id}`);
  const row = await getEmailById(id);
  if (!row) throw new Error(`No email found with id ${id}`);
  return row;
}

export async function updateEmailStatus(id: number, status: EmailStatus): Promise<EmailRow> {
  await ensureSchema();
  const result = await getClient().execute({ sql: "UPDATE emails SET status = ? WHERE id = ?", args: [status, id] });
  if (result.rowsAffected === 0) throw new Error(`No email found with id ${id}`);
  const row = await getEmailById(id);
  if (!row) throw new Error(`No email found with id ${id}`);
  return row;
}

/** Permanently removes an email row. This operation cannot be undone. */
export async function deleteEmail(id: number): Promise<void> {
  await ensureSchema();
  const result = await getClient().execute({
    sql: "DELETE FROM emails WHERE id = ?",
    args: [id],
  });
  if (result.rowsAffected === 0) throw new Error(`No email found with id ${id}`);
}

export async function getAllEmails(): Promise<EmailRow[]> {
  await ensureSchema();
  const result = await getClient().execute("SELECT * FROM emails ORDER BY received_at DESC, id DESC");
  return result.rows.map(toEmailRow);
}

export async function getEmailById(id: number): Promise<EmailRow | undefined> {
  await ensureSchema();
  const result = await getClient().execute({ sql: "SELECT * FROM emails WHERE id = ?", args: [id] });
  return result.rows[0] ? toEmailRow(result.rows[0]) : undefined;
}
