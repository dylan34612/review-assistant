import { NextRequest, NextResponse } from "next/server";
import { getAllSettings, setSetting } from "@/lib/settings";

export async function GET() {
  return NextResponse.json(await getAllSettings());
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const allowed = ["notifications", "privacy", "reviewTiming", "imap"];
  for (const key of allowed) {
    if (key in body) await setSetting(key, body[key]);
  }
  return NextResponse.json(await getAllSettings());
}
