import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { query } from "@/lib/db";
import { enrichProduct } from "@/lib/productEnrichment";
import { upsertPurchase } from "@/lib/repository";
import { isLikelyReceipt, parseReceipt } from "@/lib/receiptParser";
import { createLogCollector } from "@/lib/parseLog";
import { getAllSettings } from "@/lib/settings";

export async function scanMailbox() {
  const settings = await getAllSettings();
  if (!settings.imap.enabled) return { processed: 0, skipped: 0 };

  const host = process.env.IMAP_HOST;
  const user = process.env.IMAP_USER;
  const pass = process.env.IMAP_PASSWORD;
  if (!host || !user || !pass) throw new Error("IMAP_HOST, IMAP_USER, and IMAP_PASSWORD are required");

  const client = new ImapFlow({
    host,
    port: Number(process.env.IMAP_PORT || 993),
    secure: String(process.env.IMAP_SECURE ?? "true") === "true",
    auth: { user, pass },
    logger: false
  });

  let processed = 0;
  let skipped = 0;

  await client.connect();
  try {
    const mailboxName = process.env.IMAP_MAILBOX || "INBOX";
    const lock = await client.getMailboxLock(mailboxName);
    try {
      const since = new Date(Date.now() - Number(process.env.IMAP_LOOKBACK_DAYS || 45) * 24 * 60 * 60 * 1000);
      const mailbox = client.mailbox || undefined;
      const uidValidity = String(mailbox && "uidValidity" in mailbox ? mailbox.uidValidity : "");
      for await (const message of client.fetch({ since }, { uid: true, envelope: true, source: true })) {
        if (!message.uid || !message.source) continue;
        const uid = message.uid;
        const messageId = message.envelope?.messageId;
        const already = await query<{ id: string }>(
          "select id from processed_messages where (mailbox = $1 and uid_validity = $2 and uid = $3) or message_id = $4 limit 1",
          [mailboxName, uidValidity, uid, messageId]
        );
        if (already.rows.length) {
          skipped += 1;
          continue;
        }

        const parsed = await simpleParser(message.source);
        const sender = parsed.from?.text ?? "(no sender)";
        const subject = parsed.subject ?? "(no subject)";

        if (!isLikelyReceipt(parsed)) {
          await recordMessage({ mailboxName, uidValidity, uid, messageId, parsed, status: "ignored" });
          skipped += 1;
          continue;
        }

        const messageRow = await recordMessage({ mailboxName, uidValidity, uid, messageId, parsed, status: "processing" });
        const { log, entries } = createLogCollector();
        try {
          const items = parseReceipt(parsed, log);
          log("info", `parsed ${items.length} item(s)`, { items: items.map((i) => ({ merchant: i.merchant, title: i.title.slice(0, 60), url: i.productUrl })) });
          for (const item of items) {
            const snapshot = await enrichProduct(item);
            await upsertPurchase(item, snapshot, messageRow.id, settings.reviewTiming);
          }
          await query("update processed_messages set status = $1, error = null where id = $2", [items.length ? "processed" : "no-items", messageRow.id]);
          processed += 1;
        } catch (error) {
          const messageText = error instanceof Error ? error.message : String(error);
          log("error", messageText);
          await query("update processed_messages set status = 'error', error = $1 where id = $2", [messageText, messageRow.id]);
        } finally {
          if (entries.length && messageRow?.id) {
            try {
              for (const entry of entries) {
                await query(
                  `insert into parser_events(processed_message_id, level, message, details)
                   values ($1, $2, $3, $4::jsonb)`,
                  [messageRow.id, entry.level, entry.message, JSON.stringify(entry.details ?? {})]
                );
              }
            } catch (logErr) {
              console.error("[imap] failed to write parser_events:", logErr instanceof Error ? logErr.message : logErr);
            }
          }
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  return { processed, skipped };
}

async function recordMessage(args: {
  mailboxName: string;
  uidValidity: string;
  uid: number;
  messageId?: string;
  parsed: Awaited<ReturnType<typeof simpleParser>>;
  status: string;
}) {
  const result = await query<{ id: string }>(
    `insert into processed_messages(mailbox, uid_validity, uid, message_id, subject, sender, received_at, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict do nothing
     returning id`,
    [
      args.mailboxName,
      args.uidValidity,
      args.uid,
      args.messageId,
      args.parsed.subject,
      args.parsed.from?.text,
      args.parsed.date?.toISOString(),
      args.status
    ]
  );
  if (result.rows[0]) return result.rows[0];
  const existing = await query<{ id: string }>(
    "select id from processed_messages where (mailbox = $1 and uid_validity = $2 and uid = $3) or message_id = $4 limit 1",
    [args.mailboxName, args.uidValidity, args.uid, args.messageId]
  );
  return existing.rows[0];
}
