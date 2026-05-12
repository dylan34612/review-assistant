import { ProductSnapshot } from "@/lib/types";

type Timing = {
  category: string;
  delayDays: number;
  confidence: number;
};

const rules: Array<{ category: string; delayDays: number; confidence: number; patterns: RegExp[] }> = [
  { category: "consumable", delayDays: 7, confidence: 0.82, patterns: [/food|snack|coffee|tea|vitamin|supplement|cleaner|detergent|soap|shampoo|toothpaste|paper towel|diaper/i] },
  { category: "apparel", delayDays: 14, confidence: 0.8, patterns: [/shirt|pants|jeans|shoe|sneaker|sock|jacket|dress|hoodie|size|apparel|clothing/i] },
  { category: "beauty", delayDays: 14, confidence: 0.78, patterns: [/makeup|moisturizer|serum|lotion|skincare|conditioner|fragrance|cosmetic/i] },
  { category: "electronics", delayDays: 21, confidence: 0.76, patterns: [/battery|charger|cable|usb|bluetooth|camera|monitor|keyboard|mouse|headphone|speaker|phone|tablet|laptop/i] },
  { category: "tool", delayDays: 21, confidence: 0.74, patterns: [/tool|drill|saw|wrench|screwdriver|bit set|blade|garage|workshop/i] },
  { category: "appliance", delayDays: 30, confidence: 0.74, patterns: [/vacuum|microwave|air fryer|refrigerator|washer|dryer|appliance|humidifier|dehumidifier/i] },
  { category: "furniture", delayDays: 35, confidence: 0.78, patterns: [/chair|desk|table|sofa|mattress|bed frame|cabinet|shelf|dresser|furniture/i] }
];

export function inferReviewTiming(snapshot: ProductSnapshot, defaultDelayDays: number): Timing {
  const haystack = [snapshot.title, snapshot.brand, snapshot.description, snapshot.category, ...(snapshot.bullets ?? [])]
    .filter(Boolean)
    .join(" ");
  for (const rule of rules) {
    if (rule.patterns.some((pattern) => pattern.test(haystack))) {
      return { category: rule.category, delayDays: rule.delayDays, confidence: rule.confidence };
    }
  }
  return { category: "general", delayDays: defaultDelayDays, confidence: 0.45 };
}
