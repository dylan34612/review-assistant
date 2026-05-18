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
    "Write a complete, authentic product review based on the buyer's notes.",
    "Rules:",
    "- The buyer's notes are raw source material. Your job is to expand them into a well-developed review — never just reword or lightly paraphrase what the buyer wrote.",
    "- The final review must be meaningfully longer and more detailed than the buyer's notes. Aim for at least 4 to 6 sentences even if the notes are brief.",
    "- Develop the buyer's points: add context about how the item was used, what made it work well or poorly, how it fits into their situation, and why the rating makes sense.",
    "- You may make safe, reasonable inferences that follow naturally from what the buyer said (e.g. if they say 'fits well', note comfort or sizing reliability). Do not invent facts.",
    "- Preserve every concrete detail the buyer provided, including usage, fit, quantity, problems, positives, negatives, and uncertainty.",
    "- Do not invent usage claims, defects, benefits, comparisons, or durability details that are not supported by the notes.",
    "- It is okay to say there is not much to report when the buyer says the item is a standard part or worked as expected, but still expand to at least 3 sentences.",
    "- Keep the tone plain, specific, and natural — written as if the buyer wrote it themselves.",
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
        temperature: 0.7,
        topP: 0.9,
        maxOutputTokens: 1200
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
