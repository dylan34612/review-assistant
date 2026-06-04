import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { addDays, differenceInCalendarDays } from "date-fns";
import { query, transaction } from "@/lib/db";
import { markDueTasks, listReviewTasks, upsertPurchase } from "@/lib/repository";
import { draftReview } from "@/lib/gemini";
import { enrichProduct } from "@/lib/productEnrichment";
import { getAllSettings, setSetting } from "@/lib/settings";
import { normalizeMerchant } from "@/lib/normalize";
import { notifyDueTasks } from "@/lib/notifications";
import { scanMailbox } from "@/worker/imap";
import { getSetting } from "@/lib/settings";
import { ReviewTimingSettings, NotificationSettings, ReviewTaskRow } from "@/lib/types";

const bodySchema = z.object({
  tool: z.string(),
  args: z.record(z.unknown()).optional().default({})
});

export async function POST(request: NextRequest) {
  let tool: string;
  let args: Record<string, unknown>;

  try {
    const body = bodySchema.parse(await request.json());
    tool = body.tool;
    args = body.args;
  } catch (err) {
    return NextResponse.json({ error: "Invalid request body", detail: String(err) }, { status: 400 });
  }

  try {
    const result = await dispatch(tool, args);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

async function dispatch(tool: string, args: Record<string, unknown>): Promise<unknown> {
  switch (tool) {
    case "list_review_tasks": {
      const status = typeof args.status === "string" ? args.status : undefined;
      await markDueTasks();
      return listReviewTasks(status);
    }

    case "draft_review": {
      const id = requireString(args, "id");
      const userBlurb = requireString(args, "userBlurb");
      const rating = requireInt(args, "rating", 1, 5);

      const taskResult = await query<ReviewTaskRow>(
        `select rt.*, rs.id as subject_id, rs.merchant, rs.title, rs.brand, rs.image_url,
                rs.canonical_url, rs.product_snapshot, rs.reviewed_at
         from review_tasks rt
         join review_subjects rs on rs.id = rt.review_subject_id
         where rt.id = $1`,
        [id]
      );
      const task = taskResult.rows[0];
      if (!task) throw new Error(`Review task ${id} not found`);

      const delivery = await query<{ delivered_at: string }>(
        "select max(delivered_at) as delivered_at from purchases where review_subject_id = $1",
        [task.subject_id]
      );
      const deliveredAt = delivery.rows[0]?.delivered_at;

      const draft = await draftReview({
        product: task.product_snapshot,
        userBlurb,
        rating,
        daysSinceDelivery: deliveredAt
          ? differenceInCalendarDays(new Date(), new Date(deliveredAt))
          : undefined
      });

      await query(
        "update review_tasks set user_blurb=$1, rating=$2, generated_draft=$3, status='drafted', updated_at=now() where id=$4",
        [userBlurb, rating, draft, id]
      );

      return { draft };
    }

    case "complete_review": {
      const id = requireString(args, "id");
      const approvedReview = requireString(args, "approvedReview");
      const rating = requireInt(args, "rating", 1, 5);

      await transaction(async (client) => {
        const task = await client.query<{ review_subject_id: string }>(
          "select review_subject_id from review_tasks where id=$1",
          [id]
        );
        if (!task.rows[0]) throw new Error(`Review task ${id} not found`);
        await client.query(
          "update review_tasks set status='completed', approved_review=$1, rating=$2, approved_at=now(), updated_at=now() where id=$3",
          [approvedReview, rating, id]
        );
        await client.query(
          "update review_subjects set reviewed_at=now(), final_review=$1, final_rating=$2 where id=$3",
          [approvedReview, rating, task.rows[0].review_subject_id]
        );
      });

      return { ok: true };
    }

    case "skip_review": {
      const id = requireString(args, "id");
      await query("update review_tasks set status='skipped', updated_at=now() where id=$1", [id]);
      return { ok: true };
    }

    case "snooze_review": {
      const id = requireString(args, "id");
      const days = typeof args.days === "number" ? Math.round(args.days) : undefined;
      const settings = await getSetting<NotificationSettings>("notifications");
      const dueAt = addDays(new Date(), days ?? settings.defaultSnoozeDays);
      await query(
        "update review_tasks set status='snoozed', due_at=$1, updated_at=now() where id=$2",
        [dueAt.toISOString(), id]
      );
      return { ok: true, dueAt };
    }

    case "list_purchases": {
      const result = await query(
        `select p.*, rs.title as subject_title, rs.reviewed_at
         from purchases p
         join review_subjects rs on rs.id = p.review_subject_id
         order by p.created_at desc
         limit 200`
      );
      return result.rows;
    }

    case "add_purchase": {
      const merchant = normalizeMerchant(requireString(args, "merchant"));
      const title = requireString(args, "title");
      const productUrl = typeof args.productUrl === "string" ? args.productUrl : undefined;
      const price = typeof args.price === "number" ? args.price : undefined;
      const purchasedAt = typeof args.purchasedAt === "string" ? args.purchasedAt : new Date().toISOString();
      const deliveredAt = typeof args.deliveredAt === "string" ? args.deliveredAt : undefined;

      const item = { merchant, title, productUrl, price, currency: price ? "USD" : undefined, purchasedAt, deliveredAt, raw: { parser: "agent" } };
      const snapshot = await enrichProduct(item);
      const timing = await getSetting<ReviewTimingSettings>("reviewTiming");
      const subjectId = await upsertPurchase(item, snapshot, undefined, timing);

      return { ok: true, subjectId };
    }

    case "get_settings": {
      return getAllSettings();
    }

    case "update_settings": {
      const allowed = ["notifications", "privacy", "reviewTiming", "imap", "gemini", "openai"] as const;
      for (const key of allowed) {
        if (key in args && args[key] !== undefined) {
          await setSetting(key, args[key]);
        }
      }
      return getAllSettings();
    }

    case "get_logs": {
      const search = typeof args.q === "string" ? args.q.trim() : "";
      const limitParam = typeof args.limit === "number" ? Math.min(Math.max(Math.round(args.limit), 1), 2000) : 250;

      const params: (string | number)[] = [];
      let whereClause = "";
      if (search) {
        params.push(`%${search}%`);
        whereClause = `where (pm.subject ilike $1 or pm.sender ilike $1)`;
      }
      params.push(limitParam);
      const limitRef = `$${params.length}`;

      const result = await query(
        `select pm.id, pm.subject, pm.sender, pm.status, pm.error, pm.processed_at,
                count(distinct p.id)::int as item_count,
                coalesce(
                  json_agg(
                    json_build_object('id',pe.id,'level',pe.level,'message',pe.message,'details',pe.details,'created_at',pe.created_at)
                    order by pe.created_at
                  ) filter (where pe.id is not null),
                  '[]'
                ) as events
         from processed_messages pm
         left join purchases p on p.source_message_id = pm.id
         left join parser_events pe on pe.processed_message_id = pm.id
         ${whereClause}
         group by pm.id
         order by pm.processed_at desc
         limit ${limitRef}`,
        params
      );
      return result.rows;
    }

    case "trigger_worker_scan": {
      const scan = await scanMailbox();
      await markDueTasks();
      await notifyDueTasks();
      return { ok: true, scan };
    }

    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}

function requireString(args: Record<string, unknown>, key: string): string {
  const val = args[key];
  if (typeof val !== "string" || val.trim() === "") {
    throw new Error(`Missing or invalid required argument: ${key}`);
  }
  return val;
}

function requireInt(args: Record<string, unknown>, key: string, min: number, max: number): number {
  const val = args[key];
  const n = typeof val === "string" ? parseInt(val, 10) : Number(val);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`Argument '${key}' must be an integer between ${min} and ${max}`);
  }
  return n;
}
