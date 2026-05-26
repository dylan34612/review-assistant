import * as cheerio from "cheerio";
import { ParsedMail } from "mailparser";
import {
  canonicalizeProductUrl,
  extractAmazonAsin,
  extractDomain,
  extractWalmartItemId,
  moneyToNumber,
  normalizeMerchant,
  normalizeWhitespace
} from "@/lib/normalize";
import { ExtractedItem } from "@/lib/types";
import { LogFn } from "@/lib/parseLog";

const merchantHints = [
  "amazon",
  "walmart",
  "target",
  "bestbuy",
  "best buy",
  "costco",
  "etsy",
  "ebay",
  "homedepot",
  "home depot",
  "lowes",
  "chewy",
  "newegg"
];

const receiptSubjectPatterns = [
  /order/i,
  /receipt/i,
  /shipped/i,
  /delivered/i,
  /purchase/i,
  /invoice/i,
  /confirmation/i
];

export function isLikelyReceipt(mail: Pick<ParsedMail, "from" | "subject">) {
  const sender = mail.from?.text ?? "";
  const domain = extractDomain(sender);
  const subject = mail.subject ?? "";
  const hasMerchant = merchantHints.some((hint) => domain.includes(hint.replace(/\s/g, "")) || sender.toLowerCase().includes(hint));
  const hasReceiptSubject = receiptSubjectPatterns.some((pattern) => pattern.test(subject));
  return hasMerchant && hasReceiptSubject;
}

export function parseReceipt(mail: ParsedMail, log?: LogFn): ExtractedItem[] {
  const sender = mail.from?.text ?? "";
  const subject = mail.subject ?? "";
  const merchant = normalizeMerchant(`${sender} ${subject}`);
  log?.("info", `merchant detected: ${merchant}`, { sender, subject });
  if (merchant === "amazon") return parseAmazon(mail, merchant, log);
  if (merchant === "walmart") return parseWalmart(mail, merchant, log);
  if (merchant === "lowes") return parseLowes(mail, merchant, log);
  return parseGenericReceipt(mail, merchant, log);
}

function loadHtml(html: string) {
  const $ = cheerio.load(html || "");
  // Remove style/script so their content doesn't bleed into text() calls
  $("style, script").remove();
  return $;
}

function parseAmazon(mail: ParsedMail, merchant: string, log?: LogFn): ExtractedItem[] {
  const $ = loadHtml(mail.html || "");
  const allHrefs = $("a[href]").map((_, el) => $(el).attr("href") ?? "").get();
  const resolvedHrefs = allHrefs.map((h) => absoluteUrl(h)).filter(Boolean) as string[];
  const links = productLinks($, ["amazon.com"]);
  log?.("info", `amazon parser: ${allHrefs.length} hrefs → ${resolvedHrefs.length} resolved → ${links.length} product links`, {
    sampleResolved: resolvedHrefs.slice(0, 5),
    productLinks: links.slice(0, 5)
  });

  const titles = new Map<string, string>();
  $("a").each((_, element) => {
    const href = absoluteUrl($(element).attr("href"));
    const asin = href ? extractAmazonAsin(href) : undefined;
    const label = normalizeWhitespace($(element).text());
    if (asin && label.length > 4 && !/order|tracking|account|view/i.test(label)) titles.set(asin, label);
  });
  const orderId = findFirst(`${mail.subject ?? ""}\n${mail.text ?? ""}`, /order(?:\s|#| number)*([0-9-]{10,})/i);
  const date = mail.date?.toISOString();
  const deliveredAt = /delivered/i.test(mail.subject ?? "") ? date : undefined;
  const purchasedAt = /order|confirmation|receipt/i.test(mail.subject ?? "") ? date : undefined;
  // Amazon delivery/shipped emails put the product name in the subject: Delivered: "Product Name"
  const subjectTitle = findFirst(mail.subject ?? "", /(?:delivered|shipped)[^"]*"([^"]{4,})"/i);

  const items = links
    .map((url) => {
      const externalId = extractAmazonAsin(url);
      const title =
        (externalId && titles.get(externalId)) ||
        nearbyLinkText($, url) ||
        titleFromUrl(url) ||
        (links.length === 1 ? subjectTitle : undefined) ||
        "Amazon item";
      return buildItem({ merchant, orderId, title, url, externalId, purchasedAt, deliveredAt, raw: { parser: "amazon" } });
    })
    .filter(uniqueByKey);

  const noTitle = items.filter((i) => i.title === "Amazon item");
  if (noTitle.length) {
    log?.("warn", `${noTitle.length} item(s) have no extractable title`, { asins: noTitle.map((i) => i.externalId) });
  }
  if (!items.length) {
    log?.("warn", "amazon parser found no product links, falling back to generic parser");
    return parseGenericReceipt(mail, merchant, log);
  }
  return items;
}

function parseWalmart(mail: ParsedMail, merchant: string, log?: LogFn): ExtractedItem[] {
  const $ = loadHtml(mail.html || "");
  const links = productLinks($, ["walmart.com"]);
  log?.("info", `walmart parser: ${links.length} product links`);
  const orderId = findFirst(`${mail.subject ?? ""}\n${mail.text ?? ""}`, /order(?:\s|#| number)*([0-9-]{6,})/i);
  const date = mail.date?.toISOString();
  const deliveredAt = /delivered/i.test(mail.subject ?? "") ? date : undefined;
  const purchasedAt = /order|confirmation|receipt/i.test(mail.subject ?? "") ? date : undefined;
  const items = links
    .map((url) => {
      const externalId = extractWalmartItemId(url);
      const title = nearbyLinkText($, url) || titleFromUrl(url) || "Walmart item";
      return buildItem({ merchant, orderId, title, url, externalId, purchasedAt, deliveredAt, raw: { parser: "walmart" } });
    })
    .filter(uniqueByKey);
  if (!items.length) {
    log?.("warn", "walmart parser found no product links, falling back to generic parser");
    return parseGenericReceipt(mail, merchant, log);
  }
  return items;
}

function parseLowes(mail: ParsedMail, merchant: string, log?: LogFn): ExtractedItem[] {
  const $ = loadHtml(mail.html || "");
  const links = productLinks($, ["lowes.com"]);
  log?.("info", `lowes parser: ${links.length} product links`);
  const orderId = findFirst(`${mail.subject ?? ""}\n${mail.text ?? ""}`, /order(?:\s|#| number)*([0-9-]{6,})/i);
  const date = mail.date?.toISOString();
  const deliveredAt = /delivered/i.test(mail.subject ?? "") ? date : undefined;
  const purchasedAt = /order|confirmation|receipt/i.test(mail.subject ?? "") ? date : undefined;
  const items = links
    .map((url) => {
      const externalId = extractLowesItemId(url);
      const title = nearbyLinkText($, url) || titleFromUrl(url) || "Lowe's item";
      return buildItem({ merchant, orderId, title, url, externalId, purchasedAt, deliveredAt, raw: { parser: "lowes" } });
    })
    .filter(uniqueByKey);
  if (!items.length) {
    log?.("warn", "lowes parser found no product links, falling back to generic parser");
    return parseGenericReceipt(mail, merchant, log);
  }
  return items;
}

function parseGenericReceipt(mail: ParsedMail, merchant: string, log?: LogFn): ExtractedItem[] {
  const $ = loadHtml(mail.html || "");
  const allText = normalizeWhitespace(`${mail.subject ?? ""} ${$("body").text() || mail.text || ""}`);
  const orderId = findFirst(allText, /(?:order|invoice|confirmation)(?:\s|#| number| id)*[:\s#-]*([A-Z0-9-]{5,})/i);
  const purchasedAt = mail.date?.toISOString();
  const deliveredAt = /delivered/i.test(mail.subject ?? "") ? purchasedAt : undefined;
  const links = productLinks($, []);

  const linkedItems = links
    .map((url) => {
      const title = nearbyLinkText($, url) || titleFromUrl(url);
      if (!title || !isLikelyProductTitle(title)) return null;
      return buildItem({ merchant, orderId, title, url, purchasedAt, deliveredAt, raw: { parser: "generic-link" } });
    })
    .filter((item): item is ExtractedItem => Boolean(item))
    .filter(uniqueByKey);

  if (linkedItems.length) {
    log?.("info", `generic parser: ${linkedItems.length} linked item(s)`);
    return linkedItems.slice(0, 20);
  }

  const textLines = (mail.text || "").split(/\r?\n/).map(normalizeWhitespace);
  const lineItems = textLines
    .map(cleanProductTitle)
    .filter(isLikelyProductTitle)
    .slice(0, 10)
    .map((line) =>
      buildItem({
        merchant,
        orderId,
        title: line.replace(/\s+\$[0-9,.]+$/, ""),
        price: moneyToNumber(line),
        purchasedAt,
        deliveredAt,
        raw: { parser: "generic-text" }
      })
    );

  log?.("info", `generic parser: 0 linked items, ${lineItems.length} text item(s) from ${textLines.length} lines`, {
    sampleLines: textLines.filter((l) => l.length > 8).slice(0, 10)
  });

  return lineItems;
}

function buildItem(args: {
  merchant: string;
  orderId?: string;
  title: string;
  url?: string;
  imageUrl?: string;
  price?: number;
  purchasedAt?: string;
  deliveredAt?: string;
  externalId?: string;
  raw: Record<string, unknown>;
}): ExtractedItem {
  return {
    merchant: args.merchant,
    orderId: args.orderId,
    title: normalizeWhitespace(args.title),
    productUrl: canonicalizeProductUrl(args.url),
    imageUrl: args.imageUrl,
    price: args.price,
    currency: args.price ? "USD" : undefined,
    quantity: 1,
    purchasedAt: args.purchasedAt,
    deliveredAt: args.deliveredAt,
    externalId: args.externalId,
    raw: args.raw
  };
}

function productLinks($: cheerio.CheerioAPI, domains: string[]) {
  const urls = new Set<string>();
  $("a[href]").each((_, element) => {
    const href = absoluteUrl($(element).attr("href"));
    if (!href) return;
    const lower = href.toLowerCase();
    const domainOk = domains.length === 0 || domains.some((domain) => lower.includes(domain));
    const looksProduct = (
      /\/dp\/|\/gp\/product\/|\/ip\/|\/pd\/|\/pdp\/|\/products?\//i.test(lower) ||
      /asin=|itemid=|skuid=/i.test(lower)
    ) && !/\/progress-tracker\/|\/gp\/css\/|\/gp\/buyagain|\/your-account/i.test(lower)
      && !lower.includes("agh3col"); // Amazon "You might also like" / deals section
    if (domainOk && looksProduct) urls.add(href);
  });
  return Array.from(urls);
}

function nearbyLinkText($: cheerio.CheerioAPI, href: string) {
  let best = "";
  $("a[href]").each((_, element) => {
    const candidate = absoluteUrl($(element).attr("href"));
    if (candidate !== href) return;
    const text = cleanProductTitle($(element).text() || $(element).parent().text());
    if (isLikelyProductTitle(text) && text.length > best.length && text.length < 220) best = text;
  });
  return best || undefined;
}

function absoluteUrl(value?: string) {
  if (!value) return undefined;
  try {
    const decoded = value.startsWith("http") ? value : `https://${value.replace(/^\/\//, "")}`;
    const url = new URL(decoded);
    // Amazon email links use uppercase "U"; other mailers use "url" or "u"
    const redirect = url.searchParams.get("U") || url.searchParams.get("url") || url.searchParams.get("u");
    if (redirect?.startsWith("http")) return redirect;
    return url.toString();
  } catch {
    return undefined;
  }
}

function extractLowesItemId(url: string) {
  const match = url.match(/\/pd\/[^/]+\/(\d+)(?:[/?]|$)/i) || url.match(/\/pd\/(\d+)(?:[/?]|$)/i);
  return match?.[1];
}

function titleFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const candidate = parts.find((part) => {
      if (part.length <= 8) return false;
      if (/^(dp|gp|product|ip|pd|pdp)$/i.test(part)) return false;
      // Reject bare ASINs (B + 9 alphanumeric) and pure numeric IDs
      if (/^B[0-9A-Z]{9}$/i.test(part)) return false;
      if (/^\d+$/.test(part)) return false;
      if (!/[a-z]/i.test(part)) return false;
      return true;
    });
    return candidate ? normalizeWhitespace(decodeURIComponent(candidate).replace(/[-_]+/g, " ")) : undefined;
  } catch {
    return undefined;
  }
}

function findFirst(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  return match?.[1];
}

function uniqueByKey(item: ExtractedItem, index: number, array: ExtractedItem[]) {
  const key = item.externalId || item.productUrl || item.title.toLowerCase();
  return array.findIndex((candidate) => (candidate.externalId || candidate.productUrl || candidate.title.toLowerCase()) === key) === index;
}

function cleanProductTitle(value: string) {
  return normalizeWhitespace(
    value
      .replace(/^\*+\s*/, "")
      // Strip quantity-1 prefix that cheerio concatenates without a space: "1Tidy Cats" → "Tidy Cats"
      .replace(/^1([A-Z])/, "$1")
      // Strip delivery status prefix concatenated without a space: "DeliveredCat Chow" → "Cat Chow"
      .replace(/^(delivered|shipped)\s*/i, "")
      .replace(/\s+\$[0-9,.]+(?:\s*USD)?$/i, "")
      .replace(/\s+Quantity:\s*\d+$/i, "")
      .replace(/\s+Qty:\s*\d+$/i, "")
  );
}

function isLikelyProductTitle(value: string) {
  const line = cleanProductTitle(value);
  if (line.length < 12 || line.length > 220) return false;
  if (!/[a-z]/i.test(line)) return false;
  if (/^\$?\d+(?:\.\d{1,2})?\s*(?:usd)?$/i.test(line)) return false;
  if (/^quantity\s*:\s*\d+$/i.test(line)) return false;
  if (/^(delivered|out for delivery|arriving today|arriving tomorrow|track package|your package has shipped|view order|order details|buy it again)$/i.test(line)) return false;
  if (/^(return or replace|your package|your shipment|your delivery|delivery update|delivery notification|package has been)/i.test(line)) return false;
  if (/\breturn or (replace|exchange)\b/i.test(line)) return false;
  if (/\b(order|orders|subtotal|total|tax|shipping|payment|address|tracking|unsubscribe|return window|invoice|gift card|amazon\.com)\b/i.test(line)) return false;
  if (/\b(back porch|front door|front porch|back door|left at your|left near|package was|near the)\b/i.test(line)) return false;
  if (/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+20\d{2}\b/i.test(line)) return false;
  if (/\b(estimated delivery|delivery date|order placed|placed on|placed april|placed jan|placed feb|placed mar|placed may|placed jun|placed jul|placed aug|placed sep|placed oct|placed nov|placed dec)\b/i.test(line)) return false;
  if (/\b(fulfilled|subject to terms|terms &|terms and conditions|program subject)\b/i.test(line)) return false;
  if (/\b(rewards credit|rewards card|mylowe|everyday when|earn \d|estimate earned)\b/i.test(line)) return false;
  if (/©/.test(line)) return false;
  if (/all rights reserved/i.test(line)) return false;
  if (/update you every step/i.test(line)) return false;
  if (/we'll get started/i.test(line)) return false;
  if (/within [\d*]+ (hours|days) of|within \d+\*/i.test(line)) return false;
  if (/\bdo not reply\b/i.test(line)) return false;
  if (/\bopt out\b|\bunsubscribe\b/i.test(line)) return false;
  if (/\bprivacy policy\b|\bterms of use\b/i.test(line)) return false;
  if (/,\s*[A-Z]{2}\s+\d{5}/.test(line)) return false;
  if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s*-\s*[A-Z\s]+,?\s+[A-Z]{2}$/i.test(line)) return false;
  if (/^\d{1,5}\s+[A-Za-z0-9 .'-]+(?:street|st|road|rd|drive|dr|lane|ln|avenue|ave|court|ct|circle|cir)\b/i.test(line)) return false;
  // Line ends with a bare comma — address fragment
  if (/,$/.test(line)) return false;
  // CSS code leaked from <style> blocks
  if (/[{}]|!important\b|mso-[a-z]|font-size:|padding[-:]|margin[-:]|@media\b/i.test(line)) return false;
  // Raw HTML entities not decoded (e.g. &zwnj; &amp; &#x200F;)
  if (/&[a-z]{2,8};|&#\d+;|&#x[0-9a-f]+;/i.test(line)) return false;
  // Line contains a URL — not a product name
  if (/https?:\/\/\S{10,}/.test(line)) return false;
  // UUID / email message reference IDs
  if (/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(line)) return false;
  if (/\bemail message reference\b/i.test(line)) return false;
  // Sentence fragments starting with a conjunction
  if (/^(and|or|but)\s+/i.test(line)) return false;
  // Lines starting with a day-of-week — date strings without a year
  if (/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)[a-z]*[,.]?\s/i.test(line)) return false;
  // Boilerplate phrases from Lowe's, Amazon, Chewy, and other retailer emails
  if (/registered trademark/i.test(line)) return false;
  if (/credit approval|credit card/i.test(line)) return false;
  if (/subject to (credit|change|availability)/i.test(line)) return false;
  if (/thanks (again )?for (shopping|your (purchase|order|business))/i.test(line)) return false;
  if (/thank you for (shopping|your (purchase|order|business))/i.test(line)) return false;
  if (/want to hear from you|hear about your (experience|visit)/i.test(line)) return false;
  if (/tell us (about|how|what)/i.test(line)) return false;
  if (/\bneed help\b.*\b(24\/7|call|chat|contact)\b|\bneed help\?/i.test(line)) return false;
  if (/we're here for you|here for you 24\/7/i.test(line)) return false;
  if (/connect with (a |your |our )?vet\b|chat with (a |our )/i.test(line)) return false;
  if (/\bshipment\b|\bdelivery experience\b/i.test(line)) return false;
  if (/^delivery\s+day\b/i.test(line)) return false;
  // "X More Item(s) in Your Order" — Amazon order-summary links
  if (/^\d+\s+more items?\s+in\s+your\b/i.test(line)) return false;
  // "Yay!" / "You're all set" — marketing/notification boilerplate
  if (/^yay[!.]/i.test(line)) return false;
  if (/\byou'?re all set\b/i.test(line)) return false;
  // "itAdd" — cheerio concatenation artifact from Amazon Add-on/Subscribe UI elements
  if (/\bitAdd\b/.test(line)) return false;
  if (/purchase date|return (policy|window)|days (to|for) return/i.test(line)) return false;
  // Return / refund / replacement links
  if (/\d+\s*hours? to return|\breturns? must be (initiated|started|completed)/i.test(line)) return false;
  if (/appliance returns?|initiated within \d+/i.test(line)) return false;
  if (/\bstart a return\b|\breturn\/replacement\b/i.test(line)) return false;
  // Promotional discount text — starts with "X% off" or "$X off"
  if (/^\d+%\s*off\b|^\$\d+(\.\d+)?\s*off\b/i.test(line)) return false;
  if (/\d+%\s*off\s+(all|eligible|select)\b/i.test(line)) return false;
  // "for X days" at start of line — marketing guarantee text (strip word boundary: "daysVisit" still matches)
  if (/^for \d+ days/i.test(line)) return false;
  // SKU / Internet catalog number lines
  if (/\bSKU\s*#\d+\b|\bInternet\s*#\d+\b/i.test(line)) return false;
  // SMS / text marketing
  if (/\btext\s+['"]?\w+['"]?\s+to\s+\d+|\[sms:/i.test(line)) return false;
  // Email template section identifiers (e.g. Chewy "Recommendation Pod 2", "Sponsored Pod 3")
  if (/^(recommendation|sponsored) pod\b/i.test(line)) return false;
  // Social media follow prompts
  if (/\bon tiktok\b|\bon instagram\b|\bon facebook\b|\bfollow us on\b/i.test(line)) return false;
  // Legal boilerplate with parenthetical clause expansions
  if (/\(such as but not limited to\)/i.test(line)) return false;
  // "programs (such as..." type legal sentences
  if (/\bprograms?\s+\(/i.test(line)) return false;

  const words = line.split(/\s+/);
  if (words.length < 3) return false;

  const productSignals = [
    /\b(pack|set|kit|pcs|pc|oz|fl oz|lb|mg|ml|g\b|kg|count|size|stainless|steel|cotton|usb|charger|battery|replacement (filter|part|pad|brush|blade|cartridge|battery|bulb|head)|tool|adapter|cable|filter|thread|bolt|screw|valve|pump|motor|bracket|panel|sensor|switch|gauge|drill|saw|wrench|plier)\b/i,
    /\b(cream|spray|shirt|case|cover|lotion|serum|gel|foam|powder|shampoo|conditioner|balm|oil\b|wipe|patch)\b/i,
    /\b(formula|vitamin|supplement|probiotic|capsule|tablet|softgel|chewable|gummy|gummies)\b/i,
    /\b(treat|treats|kibble|wet food|dry food|cat litter|litter|clumping|unscented|grain.free)\b/i,
    /\b(organic|natural|ultra|premium|advanced|original|classic|deluxe|pro\b|plus\b)\b/i,
    /\b[A-Z0-9]{2,}[-/][A-Z0-9]{2,}\b/,
    /\d/
  ];

  return productSignals.some((pattern) => pattern.test(line));
}
