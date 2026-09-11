import { loadEnvConfig } from "@next/env";
import { classifyEmail } from "../lib/llm";

// Standalone scripts do not automatically load Next.js environment files.
loadEnvConfig(process.cwd());

const samples = [
  {
    label: "strong sales lead",
    subject: "Demo request for our RevOps team",
    body: "Hi, I run RevOps at Northstar Labs. We receive around 300 inbound leads each week and need automated triage before our Q4 launch. Could we see a demo and discuss enterprise pricing this Friday?",
  },
  {
    label: "borderline weak lead",
    subject: "Question about your services",
    body: "Hey, saw your website. What do you guys do exactly? Might be interested at some point, just exploring options for now.",
  },
  {
    label: "support question",
    subject: "Cannot connect Gmail inbox",
    body: "Hello, our Gmail connection started showing an authentication error this morning. Could you help us reconnect the inbox?",
  },
  {
    label: "newsletter",
    subject: "Your weekly marketing roundup",
    body: "This week: five trends in email marketing. Read the full article and manage your subscription preferences here.",
  },
  {
    label: "obvious spam",
    subject: "URGENT: You have won $5,000,000",
    body: "Congratulations! Reply today with your bank details to claim your prize immediately.",
  },
  {
    label: "personal email",
    subject: "Lunch this weekend?",
    body: "Hey, are you free Saturday? I was thinking we could grab lunch at the new place near the station.",
  },
];

async function main() {
  for (const sample of samples) {
    const classification = await classifyEmail(sample.subject, sample.body);
    console.log(`\n${sample.label}:`);
    console.log(JSON.stringify(classification, null, 2));
  }
}

main().catch((error) => {
  console.error("LLM test failed:", error);
  process.exit(1);
});
