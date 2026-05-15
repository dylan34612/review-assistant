import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { markDueTasks } from "@/lib/repository";
import { notifyDueTasks } from "@/lib/notifications";
import { scanMailbox } from "@/worker/imap";

export async function POST() {
  await query(`
    truncate table
      notification_deliveries,
      parser_events,
      review_tasks,
      purchases,
      review_subjects,
      processed_messages
    restart identity cascade
  `);
  const scan = await scanMailbox();
  await markDueTasks();
  await notifyDueTasks();
  return NextResponse.json({ ok: true, scan });
}
