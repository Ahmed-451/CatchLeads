import { existsSync, readFileSync } from "node:fs";
import { fetchUnreadEmails } from "../lib/imap";

function loadLocalEnv() {
  const envPath = ".env.local";
  if (!existsSync(envPath)) {
    throw new Error(
      "Create .env.local from .env.example and set GMAIL_ADDRESS, GMAIL_APP_PASSWORD, IMAP_HOST, and IMAP_PORT.",
    );
  }

  const text = readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

async function main() {
  loadLocalEnv();

  console.log("Connecting to IMAP and fetching unread INBOX messages...");

  const emails = await fetchUnreadEmails();

  console.log(`Unread emails found: ${emails.length}`);
  console.log(JSON.stringify(emails, null, 2));
}

main().catch((error) => {
  console.error("IMAP test failed:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
