import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { markDueTasks } from "@/lib/repository";
import { notifyDueTasks } from "@/lib/notifications";
import { scanMailbox } from "@/worker/imap";

// Clears emails that produced no items or errored out, then rescans.
// Leaves successfully-processed emails and all review data untouched,
// so completed reviews and purchases are not duplicated.
export async function POST() {
  const deleted = await query<{ count: string }>(
    "delete from processed_messages where status in ('no-items', 'error') returning id"
  );
  const scan = await scanMailbox();
  await markDueTasks();
  await notifyDueTasks();
  return NextResponse.json({ ok: true, cleared: deleted.rowCount, scan });
}
