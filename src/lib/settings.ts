import { query } from "@/lib/db";
import { GeminiSettings, NotificationSettings, PrivacySettings, ReviewTimingSettings } from "@/lib/types";

const defaults = {
  notifications: {
    pushEnabled: true,
    emailEnabled: false,
    emailFallbackEnabled: false,
    digestMode: "off",
    quietHoursStart: "22:00",
    quietHoursEnd: "08:00",
    maxRemindersPerItem: 3,
    reminderIntervalDays: 3,
    defaultSnoozeDays: 7
  } satisfies NotificationSettings,
  privacy: {
    llmReceiptFallback: "off",
    sendOrderIdsToLlm: false,
    sendEmailMetadataToLlm: false
  } satisfies PrivacySettings,
  reviewTiming: {
    defaultDelayDays: 14
  } satisfies ReviewTimingSettings,
  gemini: {
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash-lite"
  } satisfies GeminiSettings
};

export async function getSetting<T>(key: keyof typeof defaults): Promise<T> {
  const result = await query<{ value: T }>("select value from app_settings where key = $1", [key]);
  return result.rows[0]?.value ?? (defaults[key] as T);
}

export async function getAllSettings() {
  const rows = await query<{ key: string; value: unknown }>("select key, value from app_settings");
  const map = new Map(rows.rows.map((row) => [row.key, row.value]));
  return {
    notifications: (map.get("notifications") ?? defaults.notifications) as NotificationSettings,
    privacy: (map.get("privacy") ?? defaults.privacy) as PrivacySettings,
    reviewTiming: (map.get("reviewTiming") ?? defaults.reviewTiming) as ReviewTimingSettings,
    imap: (map.get("imap") ?? { enabled: true }) as { enabled: boolean },
    gemini: (map.get("gemini") ?? defaults.gemini) as GeminiSettings
  };
}

export async function setSetting(key: string, value: unknown) {
  await query(
    `insert into app_settings(key, value, updated_at)
     values ($1, $2, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, JSON.stringify(value)]
  );
}
