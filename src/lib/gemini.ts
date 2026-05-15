import { ProductSnapshot } from "@/lib/types";

export async function draftReview(input: {
  product: ProductSnapshot;
  userBlurb: string;
  rating: number;
  daysSinceDelivery?: number;
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required to draft reviews");
  }
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
  const prompt = [
    "Write a complete, authentic product review from the buyer's own notes.",
    "Rules:",
    "- The buyer's notes are source material, not the final review. Do not simply repeat them back.",
    "- If the notes are short, expand them into a useful 2 to 5 sentence review using only safe inferences from the notes and neutral product identity from the listing.",
    "- Do not make the review shorter than the buyer's notes unless you are only removing labels, repeated text, or obvious filler.",
    "- Preserve every concrete detail the buyer provided, including usage, fit, quantity, problems, positives, negatives, and uncertainty.",
    "- Do not invent usage claims, defects, benefits, comparisons, or durability details.",
    "- It is okay to say there is not much to report when the buyer says the item is a standard part or worked as expected.",
    "- Keep the tone plain, specific, and natural.",
    "- Preserve mixed or negative feedback.",
    "- Use listing context only for neutral product identification.",
    "- Do not mention that AI helped write it.",
    "- Return only the review text.",
    "",
    `Rating: ${input.rating}/5`,
    input.daysSinceDelivery ? `Days since delivery: ${input.daysSinceDelivery}` : "",
    `Buyer notes: ${input.userBlurb}`,
    `Product title: ${input.product.title}`,
    input.product.brand ? `Brand: ${input.product.brand}` : "",
    input.product.description ? `Listing description: ${input.product.description}` : "",
    input.product.bullets?.length ? `Listing bullets: ${input.product.bullets.join(" | ")}` : ""
  ]
    .filter(Boolean)
    .join("\n");

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.55,
        topP: 0.9,
        maxOutputTokens: 900
      }
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini request failed: ${response.status} ${body}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (!text) throw new Error("Gemini returned an empty draft");
  return text;
}
