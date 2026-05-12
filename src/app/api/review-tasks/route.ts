import { NextResponse } from "next/server";
import { markDueTasks, listReviewTasks } from "@/lib/repository";

export async function GET() {
  await markDueTasks();
  const tasks = await listReviewTasks();
  return NextResponse.json(tasks);
}
