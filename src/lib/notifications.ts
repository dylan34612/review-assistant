import nodemailer from "nodemailer";
import webpush, { PushSubscription } from "web-push";
import { query } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { NotificationSettings, ReviewTaskRow } from "@/lib/types";

export async function savePushSubscription(input: { endpoint: string; keys: { p256dh: string; auth: string }; userAgent?: string }) {
  await query(
    `insert into notification_subscriptions(endpoint, p256dh, auth, user_agent, enabled, updated_at)
     values ($1,$2,$3,$4,true,now())
     on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, enabled = true, updated_at = now()`,
    [input.endpoint, input.keys.p256dh, input.keys.auth, input.userAgent]
  );
}

export async function disablePushSubscription(endpoint: string) {
  await query("update notification_subscriptions set enabled = false, updated_at = now() where endpoint = $1", [endpoint]);
}

export async function notifyDueTasks() {
  const settings = await getSetting<NotificationSettings>("notifications");
  const tasks = await query<ReviewTaskRow>(
    `select rt.*, rs.id as subject_id, rs.merchant, rs.title, rs.brand, rs.image_url, rs.canonical_url, rs.product_snapshot, rs.reviewed_at
     from review_tasks rt
     join review_subjects rs on rs.id = rt.review_subject_id
     where rt.status = 'due'
       and rt.reminder_count < $1
       and (rt.last_notified_at is null or rt.last_notified_at <= now() - ($2::int || ' days')::interval)
     order by rt.due_at asc
     limit 25`,
    [settings.maxRemindersPerItem, settings.reminderIntervalDays]
  );

  for (const task of tasks.rows) {
    await notifyTask(task, settings);
  }
}

async function notifyTask(task: ReviewTaskRow, settings: NotificationSettings) {
  const title = "Review ready";
  const body = `${task.title} is ready for a quick review.`;
  const url = `${process.env.APP_BASE_URL || "http://localhost:3000"}/reviews?task=${task.id}`;
  const channel = await chooseChannel(settings);

  if (!channel) return;

  try {
    if (channel === "push") {
      await sendPush({ title, body, url, taskId: task.id });
    } else {
      await sendEmail({ subject: title, body: `${body}\n\nOpen Review Assistant: ${url}` });
    }
    await query(
      `update review_tasks set last_notified_at = now(), reminder_count = reminder_count + 1, updated_at = now() where id = $1`,
      [task.id]
    );
    await query("insert into notification_deliveries(review_task_id, channel, status) values ($1,$2,'sent')", [task.id, channel]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await query("insert into notification_deliveries(review_task_id, channel, status, error) values ($1,$2,'failed',$3)", [
      task.id,
      channel,
      message
    ]);
    if (channel === "push" && settings.emailFallbackEnabled && settings.emailEnabled) {
      await sendEmail({ subject: title, body: `${body}\n\nOpen Review Assistant: ${url}` });
      await query("insert into notification_deliveries(review_task_id, channel, status) values ($1,'email','sent')", [task.id]);
    }
  }
}

async function chooseChannel(settings: NotificationSettings): Promise<"push" | "email" | null> {
  if (settings.pushEnabled) {
    const result = await query<{ count: string }>("select count(*) from notification_subscriptions where enabled = true");
    if (Number(result.rows[0]?.count ?? 0) > 0) return "push";
  }
  if (settings.emailEnabled) return "email";
  return null;
}

async function sendPush(payload: { title: string; body: string; url: string; taskId: string }) {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) throw new Error("VAPID keys are required for push notifications");
  webpush.setVapidDetails(subject, publicKey, privateKey);

  const subscriptions = await query<{ id: string; endpoint: string; p256dh: string; auth: string }>(
    "select id, endpoint, p256dh, auth from notification_subscriptions where enabled = true"
  );
  if (!subscriptions.rows.length) throw new Error("No enabled push subscriptions");

  for (const row of subscriptions.rows) {
    const subscription: PushSubscription = {
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth }
    };
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload));
    } catch (error: unknown) {
      const statusCode = typeof error === "object" && error && "statusCode" in error ? Number((error as { statusCode?: number }).statusCode) : 0;
      if (statusCode === 404 || statusCode === 410) {
        await query("update notification_subscriptions set enabled = false, updated_at = now() where id = $1", [row.id]);
      } else {
        throw error;
      }
    }
  }
}

async function sendEmail(input: { subject: string; body: string }) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM || user;
  if (!host || !user || !pass || !from) throw new Error("SMTP settings are required for email notifications");
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: String(process.env.SMTP_SECURE ?? "true") === "true",
    auth: { user, pass }
  });
  await transporter.sendMail({
    from,
    to: user,
    subject: input.subject,
    text: input.body
  });
}
