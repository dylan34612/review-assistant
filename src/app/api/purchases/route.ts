import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { enrichProduct } from "@/lib/productEnrichment";
import { upsertPurchase } from "@/lib/repository";
import { getSetting } from "@/lib/settings";
import { ReviewTimingSettings } from "@/lib/types";
import { normalizeMerchant } from "@/lib/normalize";

const manualPurchaseSchema = z.object({
  merchant: z.string().min(1),
  title: z.string().min(2),
  productUrl: z.string().url().optional().or(z.literal("")),
  price: z.coerce.number().optional(),
  purchasedAt: z.string().optional(),
  deliveredAt: z.string().optional()
});

export async function GET() {
  const result = await query(
    `select p.*, rs.title as subject_title, rs.reviewed_at
     from purchases p
     join review_subjects rs on rs.id = p.review_subject_id
     order by p.created_at desc
     limit 200`
  );
  return NextResponse.json(result.rows);
}

export async function POST(request: NextRequest) {
  const parsed = manualPurchaseSchema.parse(await request.json());
  const item = {
    merchant: normalizeMerchant(parsed.merchant),
    title: parsed.title,
    productUrl: parsed.productUrl || undefined,
    price: parsed.price,
    currency: parsed.price ? "USD" : undefined,
    purchasedAt: parsed.purchasedAt || new Date().toISOString(),
    deliveredAt: parsed.deliveredAt || undefined,
    raw: { parser: "manual" }
  };
  const snapshot = await enrichProduct(item);
  const timing = await getSetting<ReviewTimingSettings>("reviewTiming");
  const subjectId = await upsertPurchase(item, snapshot, undefined, timing);
  return NextResponse.json({ ok: true, subjectId });
}
