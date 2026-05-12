import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { disablePushSubscription } from "@/lib/notifications";

const schema = z.object({ endpoint: z.string().url() });

export async function POST(request: NextRequest) {
  const input = schema.parse(await request.json());
  await disablePushSubscription(input.endpoint);
  return NextResponse.json({ ok: true });
}
