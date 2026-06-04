export function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeMerchant(input: string) {
  const value = input.toLowerCase();
  if (value.includes("amazon")) return "amazon";
  if (value.includes("walmart")) return "walmart";
  if (value.includes("target")) return "target";
  if (value.includes("best buy") || value.includes("bestbuy")) return "bestbuy";
  if (value.includes("costco")) return "costco";
  if (value.includes("etsy")) return "etsy";
  if (value.includes("ebay")) return "ebay";
  if (value.includes("lowe's") || value.includes("lowes")) return "lowes";
  if (value.includes("home depot") || value.includes("homedepot")) return "homedepot";
  if (value.includes("chewy")) return "chewy";
  if (value.includes("newegg")) return "newegg";
  return normalizeWhitespace(value.replace(/[^a-z0-9]+/g, " ")).replaceAll(" ", "-") || "unknown";
}

export function extractDomain(emailOrUrl: string) {
  const emailMatch = emailOrUrl.match(/@([A-Za-z0-9.-]+)/);
  if (emailMatch) return emailMatch[1].toLowerCase();
  try {
    return new URL(emailOrUrl).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return emailOrUrl.toLowerCase();
  }
}

export function extractAmazonAsin(urlOrText: string) {
  const patterns = [
    /\/dp\/([A-Z0-9]{10})(?:[/?]|$)/i,
    /\/gp\/product\/([A-Z0-9]{10})(?:[/?]|$)/i,
    /(?:asin=|ASIN[:\s])([A-Z0-9]{10})/i
  ];
  for (const pattern of patterns) {
    const match = urlOrText.match(pattern);
    if (match) return match[1].toUpperCase();
  }
  return undefined;
}

export function extractWalmartItemId(urlOrText: string) {
  const patterns = [/\/ip\/[^/]+\/(\d+)(?:[/?]|$)/i, /\/ip\/(\d+)(?:[/?]|$)/i, /[?&]itemId=(\d+)/i];
  for (const pattern of patterns) {
    const match = urlOrText.match(pattern);
    if (match) return match[1];
  }
  return undefined;
}

export function canonicalizeProductUrl(input?: string) {
  if (!input) return undefined;
  try {
    const url = new URL(input);
    url.hash = "";
    const keepParams = new Set(["asin", "itemId", "skuId"]);
    for (const key of Array.from(url.searchParams.keys())) {
      if (!keepParams.has(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

export function normalizedProductKey(args: {
  merchant: string;
  externalId?: string;
  canonicalUrl?: string;
  title: string;
  brand?: string;
}) {
  if (args.externalId) return `${args.merchant}:${args.externalId.toLowerCase()}`;
  if (args.canonicalUrl) return `${args.merchant}:${args.canonicalUrl.toLowerCase()}`;
  const text = `${args.brand ?? ""} ${args.title}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|and|with|for|new|pack|set|of|a|an)\b/g, " ");
  return `${args.merchant}:${normalizeWhitespace(text).slice(0, 180)}`;
}

export function computeReviewUrl(merchant: string, externalId?: string | null, canonicalUrl?: string | null): string | undefined {
  if (merchant === "amazon" && externalId) {
    return `https://www.amazon.com/review/create-review/?asin=${externalId}`;
  }
  if (merchant === "walmart" && externalId) {
    return `https://www.walmart.com/reviews/product/${externalId}`;
  }
  return canonicalUrl ?? undefined;
}


  if (!value) return undefined;
  const match = value.replace(/,/g, "").match(/([0-9]+(?:\.[0-9]{1,2})?)/);
  return match ? Number(match[1]) : undefined;
}
