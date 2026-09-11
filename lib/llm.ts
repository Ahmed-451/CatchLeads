import Groq from "groq-sdk";

export const EMAIL_CATEGORIES = [
  "sales_lead",
  "support",
  "spam",
  "newsletter",
  "personal",
  "other",
] as const;

export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];

export type EmailClassification = {
  category: EmailCategory;
  confidence: number;
  lead_score: number;
  company_name: string | null;
  intent_summary: string | null;
  reasoning: string;
};

export type EmailForReply = {
  from: string;
  subject: string;
  body: string;
};

const MODEL_NAME = "openai/gpt-oss-120b";

const FAILED_CLASSIFICATION: EmailClassification = {
  category: "other",
  confidence: 0,
  lead_score: 0,
  company_name: null,
  intent_summary: null,
  reasoning: "classification failed",
};

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getClient(): Groq {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Missing required environment variable: GROQ_API_KEY");
  }

  return new Groq({ apiKey });
}

/**
 * A configured sender name makes approved drafts ready to send. The placeholder
 * remains the safe default for environments that have not configured a name.
 */
function getSenderName(): string {
  return process.env.SENDER_NAME?.trim() || "[Your name]";
}

function removeCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;

  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function isCategory(value: unknown): value is EmailCategory {
  return typeof value === "string" && EMAIL_CATEGORIES.includes(value as EmailCategory);
}

/** Parses and validates every field we persist from an untrusted model response. */
function parseClassification(responseText: string): EmailClassification {
  const parsed: unknown = JSON.parse(removeCodeFence(responseText));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Classification response must be a JSON object");
  }

  const value = parsed as Record<string, unknown>;
  const hasRequiredFields = [
    "category",
    "confidence",
    "lead_score",
    "company_name",
    "intent_summary",
    "reasoning",
  ].every((field) => Object.prototype.hasOwnProperty.call(value, field));

  if (
    !hasRequiredFields ||
    !isCategory(value.category) ||
    typeof value.confidence !== "number" ||
    !Number.isFinite(value.confidence) ||
    value.confidence < 0 ||
    value.confidence > 1 ||
    typeof value.lead_score !== "number" ||
    !Number.isInteger(value.lead_score) ||
    value.lead_score < 0 ||
    value.lead_score > 100 ||
    (value.company_name !== null && typeof value.company_name !== "string") ||
    (value.intent_summary !== null && typeof value.intent_summary !== "string") ||
    typeof value.reasoning !== "string"
  ) {
    throw new Error("Classification response did not match the required schema");
  }

  return {
    category: value.category,
    confidence: value.confidence,
    lead_score: value.lead_score,
    company_name: value.company_name,
    intent_summary: value.intent_summary,
    reasoning: value.reasoning,
  };
}

function classificationPrompt(subject: string, body: string, stricter = false): string {
  return `You classify inbound business emails for CatchLeads.

Return exactly one JSON object${stricter ? ". Respond with ONLY valid JSON, nothing else." : ". Do not use Markdown code fences or add prose before or after the JSON."}

Required schema:
{
  "category": "sales_lead" | "support" | "spam" | "newsletter" | "personal" | "other",
  "confidence": number from 0 to 1,
  "lead_score": integer from 0 to 100,
  "company_name": string or null,
  "intent_summary": string or null,
  "reasoning": string
}

Score genuine buying intent, not isolated keywords. Raise a sales lead score for a specific need, urgency, a stated budget/timeline, decision-making role, or company/team context. A vague phrase such as "interested", "looking around", or "exploring options" by itself is not buying intent: it should receive a low score (generally below 30) when there is no concrete need, company context, or urgency.

Calibration examples:
- High-score sales_lead (90): "I lead RevOps at Acme. We need to automate 400 inbound leads per week before our November launch. Can you arrange a demo and enterprise pricing?"
- Medium-score sales_lead (58): "We are evaluating lead-routing tools for our five-person sales team. Could someone explain your integrations?"
- Low-score / not a sales lead (12): "I saw your site and might be interested someday. Please send general pricing." No company, timeline, or concrete use case.

Use null for company_name or intent_summary when the email does not provide enough information. Reasoning should be concise and mention the evidence used.

Email to classify:
Subject: ${subject}
Body:
${body}`;
}

function getHeader(error: unknown, headerName: string): string | null {
  if (!error || typeof error !== "object" || !("headers" in error)) return null;

  const headers = (error as { headers?: unknown }).headers;
  if (headers && typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(headerName);
  }
  if (headers && typeof headers === "object") {
    const value = (headers as Record<string, unknown>)[headerName];
    return typeof value === "string" ? value : null;
  }
  return null;
}

function retryDelayMs(error: unknown): number {
  const retryAfter = getHeader(error, "retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  }

  // Groq may return values such as "2s" in its rate-limit reset headers.
  const reset = getHeader(error, "x-ratelimit-reset-requests");
  const match = reset?.match(/^(\d+(?:\.\d+)?)s$/i);
  if (match) return Math.ceil(Number(match[1]) * 1_000);

  return 2_000;
}

function isRateLimitError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: unknown }).status === 429
  );
}

async function requestClassification(prompt: string): Promise<EmailClassification> {
  const completion = await getClient().chat.completions.create({
    model: MODEL_NAME,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0,
  });

  const content = completion.choices[0]?.message.content;
  if (!content) throw new Error("Groq returned an empty classification response");
  return parseClassification(content);
}

/**
 * Classifies an email with one schema-repair retry. A malformed response or an
 * API error returns a safe fallback so one email cannot stop the sync process.
 * For a 429, the retry honours Groq's retry-after/reset header when available.
 */
export async function classifyEmail(
  subject: string,
  body: string,
): Promise<EmailClassification> {
  try {
    return await requestClassification(classificationPrompt(subject, body));
  } catch (firstError) {
    console.warn("LLM classification attempt failed; retrying with strict JSON.", firstError);
    if (isRateLimitError(firstError)) {
      await wait(retryDelayMs(firstError));
    }

    try {
      return await requestClassification(classificationPrompt(subject, body, true));
    } catch (retryError) {
      console.error("LLM classification failed after retry.", retryError);
      return { ...FAILED_CLASSIFICATION };
    }
  }
}

/** Produces a human-review draft only for actionable sales leads. */
export async function draftReply(
  email: EmailForReply,
  classification: EmailClassification,
): Promise<string | null> {
  if (classification.category !== "sales_lead" || classification.lead_score < 50) {
    return null;
  }

  const senderName = getSenderName();

  const prompt = `Write a concise, professional reply draft to this prospective customer.

The reply must directly reference their stated need using the original email and intent summary below. Do not invent facts, pricing, product capabilities, meetings, or commitments. Do not use a generic template. End with exactly "${senderName}" as the signature. Return only the email body, without a subject line or Markdown.

Sender: ${email.from}
Original subject: ${email.subject}
Original body:
${email.body}

Classified intent summary: ${classification.intent_summary ?? "No summary available"}`;

  try {
    const completion = await getClient().chat.completions.create({
      model: MODEL_NAME,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    });
    const draft = completion.choices[0]?.message.content?.trim();
    if (!draft) throw new Error("Groq returned an empty draft");

    // Guarantee the configured signature even if the model omits it.
    return draft.endsWith(senderName) ? draft : `${draft}\n\n${senderName}`;
  } catch (error) {
    console.error("LLM draft generation failed.", error);
    return null;
  }
}
