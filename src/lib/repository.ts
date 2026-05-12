import { addDays } from "date-fns";
import { query, transaction } from "@/lib/db";
import { inferReviewTiming } from "@/lib/categorize";
import { productIdentity } from "@/lib/productEnrichment";
import { ExtractedItem, ProductSnapshot, ReviewTimingSettings } from "@/lib/types";

export async function upsertPurchase(item: ExtractedItem, snapshot: ProductSnapshot, sourceMessageId?: string, timing?: ReviewTimingSettings) {
  const identity = productIdentity(item, snapshot);
  const reviewTiming = inferReviewTiming(snapshot, timing?.defaultDelayDays ?? 14);
  const anchor = item.deliveredAt || item.purchasedAt || new Date().toISOString();
  const dueAt = addDays(new Date(anchor), reviewTiming.delayDays);

  return transaction(async (client) => {
    const subjectResult = await client.query<{ id: string; reviewed_at: string | null }>(
      `insert into review_subjects(merchant, external_id, canonical_url, normalized_key, title, brand, image_url, product_snapshot, last_purchased_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (merchant, normalized_key) do update set
         external_id = coalesce(review_subjects.external_id, excluded.external_id),
         canonical_url = coalesce(review_subjects.canonical_url, excluded.canonical_url),
         title = excluded.title,
         brand = coalesce(excluded.brand, review_subjects.brand),
         image_url = coalesce(excluded.image_url, review_subjects.image_url),
         product_snapshot = excluded.product_snapshot,
         last_purchased_at = greatest(review_subjects.last_purchased_at, excluded.last_purchased_at)
       returning id, reviewed_at`,
      [
        item.merchant,
        identity.externalId,
        identity.canonicalUrl,
        identity.normalizedKey,
        snapshot.title,
        snapshot.brand,
        snapshot.imageUrl,
        JSON.stringify(snapshot),
        item.purchasedAt || item.deliveredAt || new Date().toISOString()
      ]
    );
    const subject = subjectResult.rows[0];

    await client.query(
      `insert into purchases(review_subject_id, merchant, order_id, product_title, product_url, image_url, price, currency, quantity, purchased_at, delivered_at, source, source_message_id, raw_extract)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        subject.id,
        item.merchant,
        item.orderId,
        item.title,
        item.productUrl,
        item.imageUrl,
        item.price,
        item.currency,
        item.quantity ?? 1,
        item.purchasedAt,
        item.deliveredAt,
        sourceMessageId ? "imap" : "manual",
        sourceMessageId,
        JSON.stringify(item.raw)
      ]
    );

    if (!subject.reviewed_at) {
      await client.query(
        `insert into review_tasks(review_subject_id, due_at, delay_days, category, category_confidence)
         values ($1,$2,$3,$4,$5)
         on conflict do nothing`,
        [subject.id, dueAt.toISOString(), reviewTiming.delayDays, reviewTiming.category, reviewTiming.confidence]
      );
    }

    return subject.id;
  });
}

export async function listReviewTasks(status?: string) {
  const filter = status ? "where rt.status = $1" : "";
  const values = status ? [status] : [];
  const result = await query(
    `select rt.*, rs.id as subject_id, rs.merchant, rs.title, rs.brand, rs.image_url, rs.canonical_url, rs.product_snapshot, rs.reviewed_at
     from review_tasks rt
     join review_subjects rs on rs.id = rt.review_subject_id
     ${filter}
     order by rt.due_at asc`,
    values
  );
  return result.rows;
}

export async function markDueTasks() {
  await query("update review_tasks set status = 'due', updated_at = now() where status in ('pending','snoozed') and due_at <= now()");
}
