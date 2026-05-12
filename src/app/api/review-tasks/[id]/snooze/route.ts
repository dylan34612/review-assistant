import { NextRequest, NextResponse } from "next/server";
import { addDays } from "date-fns";
import { z } from "zod";
import { query } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { NotificationSettings } from "@/lib/types";

const schema = z.object({ days: z.coerce.number().int().min(1).max(90).optional() });

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const input = schema.parse(await request.json());
  const settings = await getSetting<NotificationSettings>("notifications");
  const dueAt = addDays(new Date(), input.days ?? settings.defaultSnoozeDays);
  await query("update review_tasks set status = 'snoozed', due_at = $1, updated_at = now() where id = $2", [dueAt.toISOString(), id]);
  return NextResponse.json({ ok: true, dueAt });
}
