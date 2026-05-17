"use client";

import { useEffect, useState } from "react";

type Settings = {
  notifications: {
    pushEnabled: boolean;
    emailEnabled: boolean;
    emailFallbackEnabled: boolean;
    digestMode: "off" | "daily" | "weekly";
    quietHoursStart: string;
    quietHoursEnd: string;
    maxRemindersPerItem: number;
    reminderIntervalDays: number;
    defaultSnoozeDays: number;
  };
  privacy: {
    llmReceiptFallback: "off" | "per-message" | "known-merchants";
    sendOrderIdsToLlm: boolean;
    sendEmailMetadataToLlm: boolean;
  };
  reviewTiming: { defaultDelayDays: number };
  imap: { enabled: boolean };
};

export function SettingsPanel() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [pushState, setPushState] = useState("Not subscribed");
  const [rescanState, setRescanState] = useState<"idle" | "busy" | "done" | "error">("idle");

  useEffect(() => {
    fetch("/api/settings").then((response) => response.json()).then(setSettings);
  }, []);

  async function save(next: Settings) {
    setSettings(next);
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next)
    });
    setSettings(await response.json());
  }

  async function rescanEmails() {
    setRescanState("busy");
    try {
      const response = await fetch("/api/worker/rescan", { method: "POST" });
      if (!response.ok) throw new Error("Rescan failed");
      setRescanState("done");
    } catch {
      setRescanState("error");
    }
  }

  async function subscribePush() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPushState("Push is not supported by this browser");
      return;
    }
    const registration = await navigator.serviceWorker.register("/sw.js");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setPushState("Permission was not granted");
      return;
    }
    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidPublicKey) {
      setPushState("NEXT_PUBLIC_VAPID_PUBLIC_KEY is not configured");
      return;
    }
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
    });
    await fetch("/api/notifications/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(subscription)
    });
    setPushState("Subscribed");
  }

  if (!settings) return <section className="panel"><p className="muted">Loading settings...</p></section>;

  return (
    <section className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Controls</p>
          <h1>Settings</h1>
        </div>
      </div>

      <div className="panel settings-grid">
        <h2>Notifications</h2>
        <Toggle label="Push notifications" checked={settings.notifications.pushEnabled} onChange={(value) => save({ ...settings, notifications: { ...settings.notifications, pushEnabled: value } })} />
        <Toggle label="Email reminders" checked={settings.notifications.emailEnabled} onChange={(value) => save({ ...settings, notifications: { ...settings.notifications, emailEnabled: value } })} />
        <Toggle label="Email fallback if push fails" checked={settings.notifications.emailFallbackEnabled} onChange={(value) => save({ ...settings, notifications: { ...settings.notifications, emailFallbackEnabled: value } })} />
        <label>
          Max reminders per item
          <input type="number" min={1} max={20} value={settings.notifications.maxRemindersPerItem} onChange={(event) => save({ ...settings, notifications: { ...settings.notifications, maxRemindersPerItem: Number(event.target.value) } })} />
        </label>
        <label>
          Reminder interval days
          <input type="number" min={1} max={30} value={settings.notifications.reminderIntervalDays} onChange={(event) => save({ ...settings, notifications: { ...settings.notifications, reminderIntervalDays: Number(event.target.value) } })} />
        </label>
        <button className="button secondary" onClick={subscribePush}>Enable this device for push</button>
        <p className="muted">{pushState}</p>
      </div>

      <div className="panel settings-grid">
        <h2>Privacy</h2>
        <label>
          LLM receipt fallback
          <select value={settings.privacy.llmReceiptFallback} onChange={(event) => save({ ...settings, privacy: { ...settings.privacy, llmReceiptFallback: event.target.value as Settings["privacy"]["llmReceiptFallback"] } })}>
            <option value="off">Off</option>
            <option value="per-message">Ask per message</option>
            <option value="known-merchants">Known merchants only</option>
          </select>
        </label>
        <Toggle label="Allow order IDs in LLM payloads" checked={settings.privacy.sendOrderIdsToLlm} onChange={(value) => save({ ...settings, privacy: { ...settings.privacy, sendOrderIdsToLlm: value } })} />
        <Toggle label="Allow email metadata in LLM payloads" checked={settings.privacy.sendEmailMetadataToLlm} onChange={(value) => save({ ...settings, privacy: { ...settings.privacy, sendEmailMetadataToLlm: value } })} />
      </div>

      <div className="panel settings-grid">
        <h2>Automation</h2>
        <Toggle label="IMAP ingestion" checked={settings.imap.enabled} onChange={(value) => save({ ...settings, imap: { enabled: value } })} />
        <label>
          Default review delay days
          <input type="number" min={1} max={90} value={settings.reviewTiming.defaultDelayDays} onChange={(event) => save({ ...settings, reviewTiming: { defaultDelayDays: Number(event.target.value) } })} />
        </label>
        <div>
          <button className="button secondary" onClick={rescanEmails} disabled={rescanState === "busy"}>
            {rescanState === "busy" ? "Scanning…" : "Re-scan emails"}
          </button>
          {rescanState === "done" && <p className="muted" style={{ marginTop: "0.5rem" }}>Done — check the review queue for new items.</p>}
          {rescanState === "error" && <p className="error-text" style={{ marginTop: "0.5rem" }}>Rescan failed. Check server logs.</p>}
          <p className="muted" style={{ marginTop: "0.25rem" }}>Retries emails that previously found no products, without affecting completed reviews.</p>
        </div>
      </div>
    </section>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}
