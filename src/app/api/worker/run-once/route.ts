import { NextResponse } from "next/server";
import { markDueTasks } from "@/lib/repository";
import { notifyDueTasks } from "@/lib/notifications";
import { scanMailbox } from "@/worker/imap";

export async function POST() {
  const scan = await scanMailbox();
  await markDueTasks();
  await notifyDueTasks();
  return NextResponse.json({ ok: true, scan });
}
