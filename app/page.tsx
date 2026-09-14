"use client";

import { IBM_Plex_Sans, Newsreader } from "next/font/google";
import { Trash2 } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

const plexSans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const newsreader = Newsreader({ subsets: ["latin"], weight: ["400", "500"] });

type EmailCategory = "sales_lead" | "support" | "spam" | "newsletter" | "personal" | "other";
type EmailStatus = "new" | "classified" | "pending_approval" | "sent" | "ignored";
type Filter = "all" | "needs_review" | "leads" | "sent" | "ignored";

type EmailRow = {
  id: number;
  from_address: string;
  subject: string;
  received_at: string;
  category: EmailCategory | null;
  lead_score: number | null;
  intent_summary: string | null;
  reasoning: string | null;
  draft_reply: string | null;
  status: EmailStatus;
};

type SyncSummary = { fetched: number; classified: number; leadsFound: number };

const filters: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs_review", label: "Needs review" },
  { id: "leads", label: "Leads" },
  { id: "sent", label: "Sent" },
  { id: "ignored", label: "Ignored" },
];

const dotClasses: Record<EmailCategory, string> = {
  sales_lead: "bg-[#47605D]",
  support: "bg-[#65718A]",
  spam: "bg-[#A45852]",
  newsletter: "bg-[#949080]",
  personal: "bg-[#806B96]",
  other: "bg-[#8A8E96]",
};

function relativeTime(dateString: string): string {
  const timestamp = new Date(dateString).getTime();
  if (Number.isNaN(timestamp)) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000));
  if (seconds < 60) return "just now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d ago`;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(timestamp));
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string; reason?: string };
    return data.reason || data.error || "Something went wrong. Please try again.";
  } catch {
    return "Something went wrong. Please try again.";
  }
}

function Category({ category }: { category: EmailCategory | null }) {
  if (!category) return <span className="text-[var(--slate)]">—</span>;
  return (
    <span className="inline-flex items-center gap-2 text-[var(--ink)]">
      <span className={`h-1.5 w-1.5 rounded-full ${dotClasses[category]}`} />
      {category.replace("_", " ")}
    </span>
  );
}

function matchesFilter(email: EmailRow, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "needs_review") return email.status === "pending_approval";
  if (filter === "leads") return email.category === "sales_lead";
  return email.status === filter;
}

export default function Home() {
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [draftBody, setDraftBody] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [isDark, setIsDark] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncSummary, setSyncSummary] = useState<SyncSummary | null>(null);

  const theme = {
    "--ink": isDark ? "#F1F0EC" : "#12151C",
    "--canvas": isDark ? "#1A1C21" : "#F6F5F1",
    "--line": isDark ? "#353841" : "#E3E1DA",
    "--signal": "#1D6F66",
    "--slate": isDark ? "#A8ADB7" : "#5B6270",
    "--surface": isDark ? "#252831" : "#FFFFFF",
  } as CSSProperties;

  const loadEmails = useCallback(async () => {
    try {
      const response = await fetch("/api/emails", { cache: "no-store" });
      if (!response.ok) throw new Error(await errorMessage(response));
      setEmails((await response.json()) as EmailRow[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load your mailbox.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void loadEmails(); }, [loadEmails]);

  const visibleEmails = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return emails.filter((email) => {
      const matchesSearch = !needle || [email.from_address, email.subject, email.intent_summary ?? ""].some((value) => value.toLowerCase().includes(needle));
      return matchesSearch && matchesFilter(email, filter);
    });
  }, [emails, filter, query]);

  function toggleExpanded(email: EmailRow) {
    if (email.status !== "pending_approval") return;
    if (expandedId === email.id) {
      setExpandedId(null);
      return;
    }
    setError(null);
    setSyncSummary(null);
    setDraftBody(email.draft_reply ?? "");
    setExpandedId(email.id);
  }

  async function checkInbox() {
    setError(null);
    setSyncSummary(null);
    setIsSyncing(true);
    try {
      const response = await fetch("/api/sync", { method: "POST" });
      if (!response.ok) throw new Error(await errorMessage(response));
      setSyncSummary((await response.json()) as SyncSummary);
      await loadEmails();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Could not check the inbox.");
    } finally {
      setIsSyncing(false);
    }
  }

  async function sendReply(id: number) {
    setError(null);
    setIsSending(true);
    try {
      const response = await fetch(`/api/send/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: draftBody }) });
      if (!response.ok) throw new Error(await errorMessage(response));
      setExpandedId(null);
      await loadEmails();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Could not send this reply.");
    } finally {
      setIsSending(false);
    }
  }

  async function dismissLead(id: number) {
    setError(null);
    setIsDismissing(true);
    try {
      const response = await fetch(`/api/emails/${id}/ignore`, { method: "POST" });
      if (!response.ok) throw new Error(await errorMessage(response));
      setExpandedId(null);
      await loadEmails();
    } catch (dismissError) {
      setError(dismissError instanceof Error ? dismissError.message : "Could not dismiss this lead.");
    } finally {
      setIsDismissing(false);
    }
  }

  async function deleteEmailRow(id: number) {
    if (!window.confirm("Delete this email permanently?")) return;

    setError(null);
    setDeletingId(id);
    try {
      const response = await fetch(`/api/emails/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await errorMessage(response));

      setEmails((current) => current.filter((email) => email.id !== id));
      if (expandedId === id) setExpandedId(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete this email.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <main style={theme} className={`${plexSans.className} min-h-screen bg-[var(--canvas)] text-[var(--ink)] transition-colors duration-200`}>
      <div className="sticky top-0 z-10 border-b border-[var(--line)] bg-[var(--canvas)]">
        <header className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-4 px-5 py-4 sm:grid-cols-[1fr_minmax(220px,420px)_1fr] sm:px-8">
          <h1 className={`${newsreader.className} text-3xl leading-none text-[var(--ink)]`}>CatchLeads</h1>
          <label className="relative block">
            <span className="sr-only">Search emails</span>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--slate)]"><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sender, subject, or intent" className="h-10 w-full border border-[var(--line)] bg-transparent pl-9 pr-3 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--slate)] focus:border-[var(--ink)]" />
          </label>
          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={() => setIsDark((value) => !value)} aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"} className="h-10 w-10 border border-[var(--line)] text-sm text-[var(--slate)] transition hover:text-[var(--ink)]">
              {isDark ? "☼" : "◐"}
            </button>
            <button type="button" onClick={() => void checkInbox()} disabled={isSyncing} className="inline-flex h-10 items-center gap-2 bg-[var(--signal)] px-4 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60">
              {isSyncing && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
              {isSyncing ? "Checking…" : "Check inbox now"}
            </button>
          </div>
        </header>
        <nav aria-label="Email filters" className="mx-auto flex max-w-7xl gap-5 overflow-x-auto px-5 sm:px-8">
          {filters.map((item) => (
            <button key={item.id} type="button" onClick={() => setFilter(item.id)} className={`whitespace-nowrap border-b-2 py-3 text-sm transition ${filter === item.id ? "border-[var(--signal)] text-[var(--ink)]" : "border-transparent text-[var(--slate)] hover:text-[var(--ink)]"}`}>
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="mx-auto max-w-7xl px-5 py-7 sm:px-8">
        {syncSummary && (
          <div className="mb-7 border-y border-[var(--line)] py-4">
            <p className={`${newsreader.className} text-2xl text-[var(--ink)]`}>{syncSummary.leadsFound} new lead{syncSummary.leadsFound === 1 ? "" : "s"} found</p>
            <p className="mt-1 text-sm text-[var(--slate)]">Fetched {syncSummary.fetched} email{syncSummary.fetched === 1 ? "" : "s"}; classified {syncSummary.classified}.</p>
          </div>
        )}

        {error && <div role="alert" className="mb-7 flex items-center justify-between border-y border-[var(--line)] py-3 text-sm text-[var(--ink)]"><span>{error}</span><button type="button" onClick={() => setError(null)} className="ml-4 text-[var(--slate)] hover:text-[var(--ink)]">Dismiss</button></div>}

        {isLoading ? (
          <div className="py-20 text-sm text-[var(--slate)]">Loading your mailbox…</div>
        ) : emails.length === 0 ? (
          <div className="py-20 text-sm text-[var(--slate)]">No emails yet — click Check inbox now to fetch your mailbox.</div>
        ) : visibleEmails.length === 0 ? (
          <div className="py-20 text-sm text-[var(--slate)]">No emails match this search or filter.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[900px] w-full border-collapse text-left text-sm">
              <thead className="border-b border-[var(--line)] text-[var(--slate)]"><tr><th className="px-2 py-3 font-medium">Sender</th><th className="px-2 py-3 font-medium">Subject</th><th className="px-2 py-3 font-medium">Category</th><th className="px-2 py-3 font-medium">Lead score</th><th className="px-2 py-3 font-medium">Status</th><th className="px-2 py-3 text-right font-medium">Received</th><th className="w-10 px-2 py-3"><span className="sr-only">Delete</span></th></tr></thead>
              <tbody>
                {visibleEmails.map((email) => {
                  const isExpanded = expandedId === email.id;
                  const isActionable = email.status === "pending_approval";
                  return (
                    <Fragment key={email.id}>
                      <tr onClick={() => toggleExpanded(email)} className={`border-b border-[var(--line)] ${isActionable ? "cursor-pointer transition hover:bg-black/[0.02]" : ""}`}>
                        <td className="max-w-48 truncate px-2 py-4 text-[var(--slate)]" title={email.from_address}>{email.from_address || "Unknown sender"}</td>
                        <td className="max-w-96 truncate px-2 py-4 font-medium text-[var(--ink)]" title={email.subject}>{email.subject || "(No subject)"}</td>
                        <td className="px-2 py-4"><Category category={email.category} /></td>
                        <td className={`px-2 py-4 font-medium ${email.category === "sales_lead" ? "text-[var(--signal)]" : "text-[var(--slate)]"}`}>{email.category === "sales_lead" ? email.lead_score ?? "—" : "—"}</td>
                        <td className="px-2 py-4 text-[var(--slate)]">{email.status.replace("_", " ")}</td>
                        <td className="whitespace-nowrap px-2 py-4 text-right text-[var(--slate)]">{relativeTime(email.received_at)}</td>
                        <td className="px-2 py-4 text-right">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void deleteEmailRow(email.id);
                            }}
                            disabled={deletingId === email.id}
                            aria-label={`Delete ${email.subject || "email"}`}
                            title="Delete permanently"
                            className="inline-flex h-7 w-7 items-center justify-center text-[var(--slate)] transition hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Trash2 className="h-4 w-4" strokeWidth={1.6} />
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="border-y border-[var(--line)] bg-[var(--surface)]"><td colSpan={7} className="px-6 py-6">
                          <div className="max-w-4xl space-y-6">
                            <div className="grid gap-5 sm:grid-cols-2"><div><p className="text-sm font-medium text-[var(--ink)]">Intent</p><p className="mt-1 text-sm leading-6 text-[var(--slate)]">{email.intent_summary || "No intent summary available."}</p></div><div><p className="text-sm font-medium text-[var(--ink)]">Reasoning</p><p className="mt-1 text-sm leading-6 text-[var(--slate)]">{email.reasoning || "No reasoning available."}</p></div></div>
                            <div><label htmlFor={`draft-${email.id}`} className="text-sm font-medium text-[var(--ink)]">Reply draft</label><textarea id={`draft-${email.id}`} value={draftBody} onChange={(event) => setDraftBody(event.target.value)} rows={8} className="mt-2 w-full border border-[var(--line)] bg-transparent px-3 py-3 text-sm leading-6 text-[var(--ink)] outline-none focus:border-[var(--ink)]" /></div>
                            <div className="flex gap-5"><button type="button" onClick={() => void sendReply(email.id)} disabled={isSending || isDismissing} className="text-sm font-medium text-[var(--ink)] underline decoration-[var(--line)] underline-offset-4 hover:decoration-[var(--ink)] disabled:opacity-50">{isSending ? "Sending…" : "Send reply"}</button><button type="button" onClick={() => void dismissLead(email.id)} disabled={isSending || isDismissing} className="text-sm text-[var(--slate)] underline decoration-[var(--line)] underline-offset-4 hover:text-[var(--ink)] hover:decoration-[var(--ink)] disabled:opacity-50">{isDismissing ? "Dismissing…" : "Dismiss"}</button></div>
                          </div>
                        </td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
