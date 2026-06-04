import { NextResponse } from "next/server";
import { markDueTasks, listReviewTasks } from "@/lib/repository";
import { computeReviewUrl } from "@/lib/normalize";

export async function GET() {
  await markDueTasks();
  const tasks = await listReviewTasks();
  const withUrls = tasks.map((t) => ({
    ...t,
    review_url: computeReviewUrl(t.merchant, t.product_snapshot?.externalId, t.canonical_url)
  }));
  return NextResponse.json(withUrls);
}
