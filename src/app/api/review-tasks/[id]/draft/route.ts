import { NextRequest, NextResponse } from "next/server";
import { differenceInCalendarDays } from "date-fns";
import { z } from "zod";
import { query } from "@/lib/db";
import { draftReview } from "@/lib/gemini";
import { ReviewTaskRow } from "@/lib/types";

const draftSchema = z.object({
  userBlurb: z.string().min(3),
  rating: z.coerce.number().int().min(1).max(5)
});

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const input = draftSchema.parse(await request.json());
    const result = await query<ReviewTaskRow>(
      `select rt.*, rs.id as subject_id, rs.merchant, rs.title, rs.brand, rs.image_url, rs.canonical_url, rs.product_snapshot, rs.reviewed_at
       from review_tasks rt
       join review_subjects rs on rs.id = rt.review_subject_id
       where rt.id = $1`,
      [id]
    );
    const task = result.rows[0];
    if (!task) return NextResponse.json({ error: "Review task not found" }, { status: 404 });
    const delivery = await query<{ delivered_at: string }>(
      "select max(delivered_at) as delivered_at from purchases where review_subject_id = $1",
      [task.subject_id]
    );
    const deliveredAt = delivery.rows[0]?.delivered_at;
    const draft = await draftReview({
      product: task.product_snapshot,
      userBlurb: input.userBlurb,
      rating: input.rating,
      daysSinceDelivery: deliveredAt ? differenceInCalendarDays(new Date(), new Date(deliveredAt)) : undefined
    });
    await query(
      "update review_tasks set user_blurb = $1, rating = $2, generated_draft = $3, status = 'drafted', updated_at = now() where id = $4",
      [input.userBlurb, input.rating, draft, id]
    );
    return NextResponse.json({ draft });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Draft failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
