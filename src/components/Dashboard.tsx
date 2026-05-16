"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, RefreshCcw, RotateCcw, ShoppingBag } from "lucide-react";

type Task = {
  id: string;
  status: string;
  due_at: string;
  title: string;
  brand: string | null;
  merchant: string;
  image_url?: string;
  category: string;
};

type Purchase = {
  id: string;
  merchant: string;
  product_title: string;
  purchased_at?: string;
  delivered_at?: string;
  reviewed_at?: string;
};

function relativeDue(dateStr: string) {
  const due = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.round((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < -1) return `${Math.abs(diffDays)}d overdue`;
  if (diffDays === -1) return "yesterday";
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "tomorrow";
  if (diffDays <= 14) return `in ${diffDays}d`;
  return due.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function shortTitle(title: string) {
  if (title.length <= 72) return title;
  return title.slice(0, 69) + "…";
}

export function Dashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    const [taskResponse, purchaseResponse] = await Promise.all([fetch("/api/review-tasks"), fetch("/api/purchases")]);
    setTasks(await taskResponse.json());
    setPurchases(await purchaseResponse.json());
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const counts = useMemo(
    () => ({
      due: tasks.filter((task) => task.status === "due" || task.status === "drafted").length,
      upcoming: tasks.filter((task) => task.status === "pending" || task.status === "snoozed").length,
      completed: tasks.filter((task) => task.status === "completed").length,
      purchases: purchases.length
    }),
    [tasks, purchases]
  );

  async function runSync() {
    setRunning(true);
    try {
      await fetch("/api/worker/run-once", { method: "POST" });
      await load();
    } finally {
      setRunning(false);
    }
  }

  async function refreshData() {
    const confirmed = window.confirm(
      "This will delete all detected purchases and review tasks, then rescan your mailbox with the current parser. Settings and notification subscriptions are kept. Continue?"
    );
    if (!confirmed) return;
    setRefreshing(true);
    try {
      await fetch("/api/worker/refresh", { method: "POST" });
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <section className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Self-hosted queue</p>
          <h1>Purchase reviews</h1>
        </div>
        <div className="action-row">
          <button className="button secondary" onClick={runSync} disabled={running || refreshing}>
            <RefreshCcw size={16} /> {running ? "Scanning" : "Scan mailbox"}
          </button>
          <button className="button danger" onClick={refreshData} disabled={running || refreshing}>
            <RotateCcw size={16} /> {refreshing ? "Refreshing" : "Clear and rescan"}
          </button>
        </div>
      </div>

      <div className="stat-grid">
        <Stat icon={<BellIcon />} label="Ready" value={counts.due} />
        <Stat icon={<CalendarClock />} label="Upcoming" value={counts.upcoming} />
        <Stat icon={<ShoppingBag />} label="Purchases" value={counts.purchases} />
        <Stat icon={<CheckCircle2 />} label="Completed" value={counts.completed} />
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Next reviews</h2>
          <a className="inline-link" href="/reviews">Open review workspace</a>
        </div>
        {loading ? (
          <p className="muted">Loading queue...</p>
        ) : tasks.length ? (
          <div className="table">
            {tasks.slice(0, 12).map((task) => (
              <a className="row" href={`/reviews?task=${task.id}`} key={task.id}>
                <div className="row-thumb">
                  {task.image_url ? (
                    <img src={task.image_url} alt="" width={40} height={40} />
                  ) : (
                    <div className="thumb-placeholder" />
                  )}
                </div>
                <div className="row-body">
                  <strong>{shortTitle(task.title)}</strong>
                  <span>{task.brand ? `${task.brand} · ` : ""}{task.merchant}{task.category && task.category !== "unknown" ? ` · ${task.category}` : ""}</span>
                </div>
                <div className="row-meta">
                  <strong className={`status-badge status-${task.status}`}>{task.status}</strong>
                  <span>{relativeDue(task.due_at)}</span>
                </div>
              </a>
            ))}
          </div>
        ) : (
          <p className="muted">No review tasks yet. The worker will add them as receipts arrive, or you can add a backup purchase below.</p>
        )}
      </div>

      <ManualPurchaseForm onCreated={load} />
    </section>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="stat">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function BellIcon() {
  return <CalendarClock size={20} />;
}

function ManualPurchaseForm({ onCreated }: { onCreated: () => void }) {
  const [saving, setSaving] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      await fetch("/api/purchases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form.entries()))
      });
      event.currentTarget.reset();
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="panel form-grid" onSubmit={submit}>
      <div className="panel-head full">
        <h2>Backup manual entry</h2>
      </div>
      <label>
        Merchant
        <input name="merchant" placeholder="Amazon, Walmart, Target" required />
      </label>
      <label>
        Product title
        <input name="title" required />
      </label>
      <label className="wide">
        Product URL
        <input name="productUrl" type="url" />
      </label>
      <label>
        Purchase date
        <input name="purchasedAt" type="date" />
      </label>
      <label>
        Delivered date
        <input name="deliveredAt" type="date" />
      </label>
      <button className="button" disabled={saving}>{saving ? "Adding" : "Add purchase"}</button>
    </form>
  );
}
