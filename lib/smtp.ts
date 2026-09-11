import nodemailer from "nodemailer";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Creates a Gmail SMTP transport using the same app password used by IMAP.
 * SMTP_HOST and SMTP_PORT are optional so the local Gmail defaults work with
 * the existing project environment; they can be overridden for another SMTP
 * provider later.
 */
export function createSmtpTransport() {
  const port = Number(process.env.SMTP_PORT ?? "465");
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("SMTP_PORT must be a positive number");
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST?.trim() || "smtp.gmail.com",
    port,
    secure: port === 465,
    auth: {
      user: requiredEnv("GMAIL_ADDRESS"),
      // Gmail App Passwords are often copied with spaces; SMTP rejects those.
      pass: requiredEnv("GMAIL_APP_PASSWORD").replace(/\s+/g, ""),
    },
  });
}

export function getSenderAddress(): string {
  return requiredEnv("GMAIL_ADDRESS");
}
