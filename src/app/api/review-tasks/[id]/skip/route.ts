import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  await query("update review_tasks set status = 'skipped', updated_at = now() where id = $1", [id]);
  return NextResponse.json({ ok: true });
}
