import { OpenAISettings, ProductSnapshot } from "@/lib/types";

export async function draftWithOpenAI(
  input: {
    product: ProductSnapshot;
    userBlurb: string;
    rating: number;
    daysSinceDelivery?: number;
  },
  settings: OpenAISettings,
  prompt: string
) {
  const baseUrl = settings.baseUrl.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model: settings.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: settings.maxTokens || 1200,
      temperature: 0.7,
      top_p: 0.9
    })
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${response.status} ${body}`);
  }

  let data: { choices?: Array<{ message?: { content?: string } }> };
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(`OpenAI returned non-JSON response: ${body.slice(0, 200)}`);
  }

  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error("OpenAI returned an empty response");
  }
  return text;
}
