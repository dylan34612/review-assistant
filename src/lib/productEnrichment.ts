import * as cheerio from "cheerio";
import {
  canonicalizeProductUrl,
  extractAmazonAsin,
  extractWalmartItemId,
  normalizedProductKey,
  normalizeWhitespace
} from "@/lib/normalize";
import { enrichWithPlaywright } from "@/lib/playwrightEnrichment";
import { ExtractedItem, ProductSnapshot } from "@/lib/types";

export async function enrichProduct(item: ExtractedItem): Promise<ProductSnapshot> {
  const canonicalUrl = canonicalizeProductUrl(item.productUrl);
  const externalId = item.externalId || (canonicalUrl ? extractAmazonAsin(canonicalUrl) || extractWalmartItemId(canonicalUrl) : undefined);
  const base: ProductSnapshot = {
    title: item.title,
    merchant: item.merchant,
    canonicalUrl,
    externalId,
    brand: item.brand,
    imageUrl: item.imageUrl,
    price: item.price,
    currency: item.currency,
    source: "email"
  };

  if (!canonicalUrl) return base;

  // Use Playwright for Amazon and Walmart — it handles JS-rendered pages and
  // extracts structured data (bullets, details table, ratings) that plain HTTP misses.
  // Falls back to HTTP+Cheerio if Playwright is unavailable or the launch fails.
  if (item.merchant === "amazon" || item.merchant === "walmart") {
    try {
      const result = await enrichWithPlaywright(canonicalUrl, item.merchant, base);
      if (result.source === "metadata") return result;
    } catch (err) {
      console.log(`[enrichment] playwright threw unexpectedly for ${canonicalUrl}: ${err instanceof Error ? err.message : err}`);
    }
  }

  return enrichWithHttp(canonicalUrl, base, item);
}

async function enrichWithHttp(canonicalUrl: string, base: ProductSnapshot, item: ExtractedItem): Promise<ProductSnapshot> {
  try {
    const response = await fetch(canonicalUrl, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml"
      },
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) return base;
    const html = await response.text();
    const $ = cheerio.load(html);
    const rawTitle = normalizeWhitespace(
      meta($, "og:title") ||
      meta($, "twitter:title") ||
      $("title").first().text()
    ).replace(/\s*[-|]\s*Amazon\.com.*$/i, "").replace(/^Amazon\.com[:\s]*/i, "");
    // Treat a bare "Amazon.com" result as empty — it means a CAPTCHA or home page, not a product
    const title = /^amazon\.com$/i.test(rawTitle.trim()) ? "" : rawTitle;
    const imageUrl = meta($, "og:image") || meta($, "twitter:image") || item.imageUrl;
    const description = meta($, "og:description") || meta($, "description");
    const brand = $('[itemprop="brand"]').first().text() || item.brand;
    const bullets = $("#feature-bullets li, [data-testid='product-highlights'] li, .about-this-item li")
      .map((_, element) => normalizeWhitespace($(element).text()))
      .get()
      .filter((line) => line.length > 0 && line.length < 240)
      .slice(0, 8);
    return {
      ...base,
      title: title || base.title,
      imageUrl,
      description,
      brand: normalizeWhitespace(brand || "") || base.brand,
      bullets,
      source: "metadata"
    };
  } catch {
    return base;
  }
}

function meta($: cheerio.CheerioAPI, name: string) {
  return normalizeWhitespace(
    $(`meta[property="${name}"]`).attr("content") ||
      $(`meta[name="${name}"]`).attr("content") ||
      ""
  );
}

export function productIdentity(item: ExtractedItem, snapshot: ProductSnapshot) {
  const externalId = snapshot.externalId || item.externalId;
  const canonicalUrl = snapshot.canonicalUrl || canonicalizeProductUrl(item.productUrl);
  return {
    externalId,
    canonicalUrl,
    normalizedKey: normalizedProductKey({
      merchant: item.merchant,
      externalId,
      canonicalUrl,
      title: snapshot.title || item.title,
      brand: snapshot.brand || item.brand
    })
  };
}
