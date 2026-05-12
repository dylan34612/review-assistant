import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { query, transaction } from "@/lib/db";

const schema = z.object({
  approvedReview: z.string().min(3),
  rating: z.coerce.number().int().min(1).max(5)
});

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const input = schema.parse(await request.json());
  await transaction(async (client) => {
    const task = await client.query<{ review_subject_id: string }>("select review_subject_id from review_tasks where id = $1", [id]);
    if (!task.rows[0]) throw new Error("Review task not found");
    await client.query(
      "update review_tasks set status = 'completed', approved_review = $1, rating = $2, approved_at = now(), updated_at = now() where id = $3",
      [input.approvedReview, input.rating, id]
    );
    await client.query(
      "update review_subjects set reviewed_at = now(), final_review = $1, final_rating = $2 where id = $3",
      [input.approvedReview, input.rating, task.rows[0].review_subject_id]
    );
  });
  return NextResponse.json({ ok: true });
}
