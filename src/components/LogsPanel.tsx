"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw, Search } from "lucide-react";

type ParserEvent = {
  id: string;
  level: "info" | "warn" | "error";
  message: string;
  details: Record<string, unknown>;
  created_at: string;
};

type MessageLog = {
  id: string;
  subject: string;
  sender: string;
  status: string;
  error: string | null;
  processed_at: string;
  item_count: number;
  events: ParserEvent[];
};

const STATUS_LABELS: Record<string, string> = {
  processed: "processed",
  "no-items": "no items",
  ignored: "ignored",
  error: "error",
  processing: "processing",
};

const LEVEL_CLASS: Record<string, string> = {
  info: "log-info",
  warn: "log-warn",
  error: "log-error",
};

function timeSince(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function LogsPanel() {
  const [logs, setLogs] = useState<MessageLog[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function load(q = "") {
    setLoading(true);
    const params = new URLSearchParams({ limit: "500" });
    if (q) params.set("q", q);
    const response = await fetch(`/api/logs?${params}`);
    setLogs(await response.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function onSearchChange(value: string) {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(value), 400);
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const nonIgnored = logs.filter((m) => m.status !== "ignored");
  const ignored = logs.filter((m) => m.status === "ignored");

  return (
    <section className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Diagnostics</p>
          <h1>Parser logs</h1>
        </div>
        <button className="button secondary" onClick={() => load(search)} disabled={loading}>
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      <div className="panel">
        <div className="log-search-row">
          <Search size={16} className="log-search-icon" />
          <input
            className="log-search-input"
            type="search"
            placeholder="Filter by subject or sender…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        <p className="muted" style={{ marginBottom: "1rem" }}>
          Showing up to 500 emails{search ? ` matching "${search}"` : ""}. Click any row to expand parser events.
          {" "}<strong>{nonIgnored.length}</strong> receipt(s), <strong>{ignored.length}</strong> ignored.
        </p>

        {loading && <p className="muted">Loading…</p>}

        {!loading && logs.length === 0 && (
          <p className="muted">No emails processed yet. Run a scan from Settings or Dashboard.</p>
        )}

        <div className="log-table">
          {nonIgnored.map((msg) => (
            <div key={msg.id} className="log-row">
              <button className="log-row-head" onClick={() => toggle(msg.id)}>
                <span className={`status-badge status-${msg.status.replace("-", "")}`}>
                  {STATUS_LABELS[msg.status] ?? msg.status}
                </span>
                <span className="log-subject">{msg.subject ?? "(no subject)"}</span>
                <span className="log-meta">
                  {msg.item_count > 0 && <strong>{msg.item_count} item{msg.item_count !== 1 ? "s" : ""}</strong>}
                  {msg.item_count === 0 && msg.status === "processed" && <span>0 items</span>}
                  <span>{timeSince(msg.processed_at)}</span>
                </span>
              </button>

              {expanded.has(msg.id) && (
                <div className="log-detail">
                  <p className="log-sender">{msg.sender}</p>
                  {msg.error && <p className="error-text">{msg.error}</p>}
                  {msg.events.length === 0 && (
                    <p className="muted">No parser events recorded. This email may have been processed before logging was added — re-scan to capture events.</p>
                  )}
                  {msg.events.map((ev) => (
                    <div key={ev.id} className={`log-event ${LEVEL_CLASS[ev.level] ?? ""}`}>
                      <span className="log-event-level">{ev.level}</span>
                      <span className="log-event-msg">{ev.message}</span>
                      {Object.keys(ev.details).length > 0 && (
                        <pre className="log-event-details">{JSON.stringify(ev.details, null, 2)}</pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {ignored.length > 0 && (
            <details className="log-ignored">
              <summary className="muted">{ignored.length} ignored (not recognized as receipts)</summary>
              {ignored.map((msg) => (
                <div key={msg.id} className="log-row log-row-ignored">
                  <span className="log-subject muted">{msg.subject ?? "(no subject)"}</span>
                  <span className="log-meta muted">{msg.sender} · {timeSince(msg.processed_at)}</span>
                </div>
              ))}
            </details>
          )}
        </div>
      </div>
    </section>
  );
}
