import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CatchLeads",
  description: "Email triage and sales-lead auto-response",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
