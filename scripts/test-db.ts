import {
  getAllEmails,
  getEmailById,
  insertEmail,
  updateEmailClassification,
  updateEmailDraft,
  updateEmailStatus,
} from "../lib/db";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const messageId = `<stage2-test-${Date.now()}@catchleads.local>`;

  const first = insertEmail({
    message_id: messageId,
    from_address: "lead@example.com",
    subject: "Interested in a demo",
    body_snippet: "We want to buy CatchLeads for our sales team.",
    received_at: new Date().toISOString(),
  });

  assert(first.inserted, "first insert should create a row");
  assert(first.row.status === "new", "new emails start as status new");
  assert(first.row.category === null, "classification fields start empty");

  const duplicate = insertEmail({
    message_id: messageId,
    from_address: "other@example.com",
    subject: "This should be ignored",
    body_snippet: "duplicate",
    received_at: new Date().toISOString(),
  });

  assert(!duplicate.inserted, "duplicate message_id should be skipped");
  assert(duplicate.row.id === first.row.id, "skip should return the original row");
  assert(
    duplicate.row.subject === "Interested in a demo",
    "duplicate insert must not overwrite the original",
  );

  const classified = updateEmailClassification(first.row.id, {
    category: "sales_lead",
    confidence: 0.91,
    lead_score: 78,
    company_name: "Example Co",
    intent_summary: "Wants a product demo for the sales team",
    reasoning: "Specific buying intent and team context",
  });
  assert(classified.status === "classified", "classification sets status classified");
  assert(classified.lead_score === 78, "lead_score should persist");

  const withDraft = updateEmailDraft(
    first.row.id,
    "Thanks for reaching out — happy to schedule a demo.\n\n[Your name]",
  );
  assert(withDraft.draft_reply?.includes("[Your name]"), "draft_reply should persist");

  const pending = updateEmailStatus(first.row.id, "pending_approval");
  assert(pending.status === "pending_approval", "status update should persist");

  const byId = getEmailById(first.row.id);
  assert(byId?.message_id === messageId, "getEmailById should find the row");

  const all = getAllEmails();
  assert(
    all.some((email) => email.id === first.row.id),
    "getAllEmails should include the inserted row",
  );

  console.log("Stage 2 database checks passed.");
  console.log(
    JSON.stringify(
      {
        insertedId: first.row.id,
        duplicateSkipped: !duplicate.inserted,
        status: pending.status,
        category: classified.category,
        lead_score: classified.lead_score,
        allCount: all.length,
      },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (error) {
  console.error("DB test failed:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
