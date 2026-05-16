"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, Save, Send, Sparkles } from "lucide-react";

type Task = {
  id: string;
  status: string;
  due_at: string;
  title: string;
  merchant: string;
  canonical_url?: string;
  brand?: string;
  image_url?: string;
  category: string;
  user_blurb?: string;
  rating?: number;
  generated_draft?: string;
  approved_review?: string;
};

const contextPrompts = [
  "What did you use it for?",
  "Did it work as expected?",
  "How was the fit, size, or compatibility?",
  "How was the quality or finish?",
  "Anything annoying or disappointing?",
  "Would you buy it again?"
];

function reviewSubmitUrl(task: Task): string | undefined {
  if (task.merchant === "amazon" && task.canonical_url) {
    const asin = task.canonical_url.match(/\/dp\/([A-Z0-9]{10})/i)?.[1];
    if (asin) return `https://www.amazon.com/review/create-review?asin=${asin}`;
  }
  if (task.merchant === "walmart" && task.canonical_url) {
    const itemId = task.canonical_url.match(/\/ip\/(?:[^/]+\/)?(\d+)/i)?.[1];
    if (itemId) return `https://www.walmart.com/reviews/product/${itemId}`;
  }
  return task.canonical_url;
}

function relativeDue(dateStr: string) {
  const due = new Date(dateStr);
  const diffDays = Math.round((due.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (diffDays < -1) return `${Math.abs(diffDays)}d overdue`;
  if (diffDays === -1) return "yesterday";
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "tomorrow";
  if (diffDays <= 14) return `in ${diffDays}d`;
  return due.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ReviewWorkbench() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [blurb, setBlurb] = useState("");
  const [rating, setRating] = useState(5);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  async function load() {
    const response = await fetch("/api/review-tasks");
    const data = await response.json();
    setTasks(data);
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("task");
    const first = data.find((task: Task) => task.id === requested) || data.find((task: Task) => ["due", "drafted"].includes(task.status)) || data[0];
    if (first) selectTask(first);
  }

  useEffect(() => {
    load();
  }, []);

  const selected = useMemo(() => tasks.find((task) => task.id === selectedId), [tasks, selectedId]);

  function selectTask(task: Task) {
    setSelectedId(task.id);
    setBlurb(task.user_blurb || "");
    setRating(task.rating || 5);
    setDraft(task.generated_draft || task.approved_review || "");
    setError("");
    setSubmitted(false);
  }

  function addPrompt(question: string) {
    setBlurb((current) => {
      const nextLine = `${question} `;
      if (!current.trim()) return nextLine;
      if (current.includes(question)) return current;
      return `${current.trim()}\n${nextLine}`;
    });
  }

  async function generateDraft() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/review-tasks/${selected.id}/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userBlurb: blurb, rating })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Draft failed");
      setDraft(data.draft);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Draft failed");
    } finally {
      setBusy(false);
    }
  }

  async function complete() {
    if (!selected) return;
    await fetch(`/api/review-tasks/${selected.id}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approvedReview: draft, rating })
    });
    await navigator.clipboard.writeText(draft);
    await load();
  }

  async function openSubmitPage() {
    if (!selected) return;
    const url = reviewSubmitUrl(selected);
    if (!url) return;
    await navigator.clipboard.writeText(draft);
    window.open(url, "_blank", "noopener,noreferrer");
    setSubmitted(true);
  }

  async function snooze(days: number) {
    if (!selected) return;
    await fetch(`/api/review-tasks/${selected.id}/snooze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ days })
    });
    await load();
  }

  async function skip() {
    if (!selected) return;
    await fetch(`/api/review-tasks/${selected.id}/skip`, { method: "POST" });
    await load();
  }

  const submitUrl = selected ? reviewSubmitUrl(selected) : undefined;
  const isApproved = selected?.status === "completed";

  return (
    <section className="workbench">
      <div className="task-list panel">
        <div className="panel-head">
          <h2>Review queue</h2>
        </div>
        <p className="muted">Pick a product, add a short note, draft, then approve and copy.</p>
        <div className="task-scroll">
          {tasks.map((task) => (
            <button className={`task-button ${task.id === selectedId ? "active" : ""}`} key={task.id} onClick={() => selectTask(task)}>
              <div className="task-button-inner">
                {task.image_url ? (
                  <img src={task.image_url} alt="" width={36} height={36} className="task-thumb" />
                ) : (
                  <div className="task-thumb task-thumb-placeholder" />
                )}
                <div>
                  <strong>{task.title.length > 60 ? task.title.slice(0, 57) + "…" : task.title}</strong>
                  <span>{task.status} · {relativeDue(task.due_at)}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="panel review-editor">
        {selected ? (
          <>
            <div className="product-head">
              {selected.image_url ? <img src={selected.image_url} alt="" /> : null}
              <div>
                <p className="eyebrow">{selected.merchant}{selected.category && selected.category !== "unknown" ? ` / ${selected.category}` : ""}</p>
                <h1>{selected.title}</h1>
                {selected.brand ? <p className="muted">{selected.brand}</p> : null}
                {selected.canonical_url ? (
                  <a className="inline-link" href={selected.canonical_url} target="_blank" rel="noopener noreferrer">
                    Open product <ExternalLink size={14} />
                  </a>
                ) : null}
              </div>
            </div>

            <div className="review-step">
              <div>
                <p className="eyebrow">Step 1</p>
                <h2>Your experience</h2>
              </div>
              <div className="review-form">
                <label className="rating-row">
                  Star rating
                  <select value={rating} onChange={(event) => setRating(Number(event.target.value))}>
                    {[5, 4, 3, 2, 1].map((value) => (
                      <option key={value} value={value}>{value} stars</option>
                    ))}
                  </select>
                </label>
                <label>
                  Your notes
                  <textarea value={blurb} onChange={(event) => setBlurb(event.target.value)} placeholder="What worked, what didn't, how long you used it, and anything future buyers should know." />
                </label>
                <div className="context-prompts" aria-label="Review context prompts">
                  <span>Need ideas?</span>
                  {contextPrompts.map((question) => (
                    <button className="prompt-chip" type="button" key={question} onClick={() => addPrompt(question)}>
                      {question}
                    </button>
                  ))}
                </div>
              </div>
              <div className="action-row">
                <button className="button" onClick={generateDraft} disabled={busy || blurb.trim().length < 3}>
                  <Sparkles size={16} /> {busy ? "Drafting" : "Draft with Gemini"}
                </button>
                <button className="button secondary" onClick={() => snooze(7)}>Snooze</button>
                <button className="button secondary" onClick={skip}>Skip</button>
              </div>
              {error ? <p className="error-text">{error}</p> : null}
            </div>

            <div className="review-step">
              <div>
                <p className="eyebrow">Step 2</p>
                <h2>Approve review</h2>
              </div>
              <label>
                Final review
                <textarea className="draft-box" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Draft will appear here. You can edit it before approving." />
              </label>
              <div className="action-row">
                <button className="button" onClick={complete} disabled={draft.trim().length < 3}>
                  <Save size={16} /> Approve and copy
                </button>
                <button className="button secondary" onClick={() => navigator.clipboard.writeText(draft)} disabled={!draft}>
                  <Copy size={16} /> Copy
                </button>
              </div>
            </div>

            {submitUrl && (isApproved || draft.trim().length >= 3) ? (
              <div className="review-step">
                <div>
                  <p className="eyebrow">Step 3</p>
                  <h2>Submit your review</h2>
                </div>
                <p className="muted">
                  Opens the {selected.merchant} review form in a new tab and copies your review text to the clipboard. You paste and submit — nothing is sent automatically.
                </p>
                <div className="action-row">
                  <button className="button" onClick={openSubmitPage} disabled={draft.trim().length < 3}>
                    <Send size={16} /> Open {selected.merchant} review form
                  </button>
                </div>
                {submitted ? (
                  <p className="submit-hint">
                    Review copied to clipboard — paste it in the tab that just opened, then click Submit.
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        ) : (
          <p className="muted">No review task selected.</p>
        )}
      </div>
    </section>
  );
}
