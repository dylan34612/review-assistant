import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { savePushSubscription } from "@/lib/notifications";

const schema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() })
});

export async function POST(request: NextRequest) {
  const subscription = schema.parse(await request.json());
  await savePushSubscription({ ...subscription, userAgent: request.headers.get("user-agent") ?? undefined });
  return NextResponse.json({ ok: true });
}
