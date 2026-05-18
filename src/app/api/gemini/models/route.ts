import { NextResponse } from "next/server";

type GeminiModel = {
  name: string;
  displayName: string;
  supportedGenerationMethods: string[];
};

export async function GET() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ models: [], error: "GEMINI_API_KEY is not configured" });
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=100`
  );

  if (!response.ok) {
    const body = await response.text();
    return NextResponse.json({ models: [], error: `Failed to fetch models: ${response.status} ${body.slice(0, 200)}` }, { status: response.status });
  }

  const data: { models?: GeminiModel[] } = await response.json();
  const models = (data.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => ({
      id: m.name.replace(/^models\//, ""),
      displayName: m.displayName || m.name.replace(/^models\//, "")
    }));

  return NextResponse.json({ models });
}
