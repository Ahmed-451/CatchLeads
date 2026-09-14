# CatchLeads

An AI-powered email triage system that connects to a mailbox, classifies incoming messages
with an LLM, and drafts responses for detected sales leads — with a human-in-the-loop
approval step before anything is actually sent.

Built as a sample project for ANM Tech's AI intern assessment.

**Live demo:** https://catchleads-3ad7.onrender.com

---

## What it does

1. Connects to a Gmail inbox via IMAP and fetches unread messages
2. Classifies each email using an LLM (category, confidence, lead score, extracted intent)
3. For detected sales leads (score ≥ 50), drafts a personalized reply referencing the
   sender's specific need
4. Surfaces everything in a dashboard where a human reviews, edits, and approves before any
   reply is actually sent

## Why it works this way

- **Human-in-the-loop sending, not full automation.** Auto-sending unreviewed AI replies to
  real leads is a real risk to a business's reputation. Drafts sit in a pending-approval
  queue instead of sending automatically, even for high-confidence leads.
- **Lead score decoupled from category.** The category label and the lead_score are
  independent — the score is the actual gate for action (draft generation, dashboard
  highlighting), so disagreements or edge cases in categorization don't affect behavior.
- **IMAP + App Password over Gmail OAuth.** Chosen for setup speed within the project
  timeline. Gmail API + OAuth with a proper consent screen is the natural next step for a
  production version.
- **Groq over Gemini for the LLM.** Started on Gemini; hit its free-tier daily quota
  (20 requests/day/model) mid-development, which made iterative testing impractical.
  Switched to Groq (30 req/min, 14,400 req/day free tier) after confirming via the actual
  error response that it was a hard quota limit, not a bug.
- **Turso over local SQLite for storage.** The app is deployed on Render, whose free tier
  has no persistent disk — a local SQLite file resets on every restart. Turso is
  SQLite-compatible but hosted, so the data layer is nearly unchanged while gaining real
  persistence.

## Tech stack

- Next.js 14 (App Router, TypeScript), Tailwind CSS
- `imapflow` + `mailparser` (read mail), `nodemailer` (send mail)
- Groq API (`openai/gpt-oss-120b`) for classification and draft generation
- Turso (libSQL) for persistent storage
- Deployed on Render

## Setup

1. Clone the repo, `npm install`
2. Copy `.env.example` to `.env.local` and fill in your own values
3. `npm run dev`

See `.env.example` for where to obtain each credential.

## What I'd do with more time

- Migrate from IMAP/App Password to Gmail API with proper OAuth
- Reply threading via In-Reply-To/References headers (partially implemented)
- Analytics: leads/day, average lead score, classification breakdown over time
- Configurable category list and polling interval from the UI
- Exponential backoff (not just a single delay) on rate-limit retries