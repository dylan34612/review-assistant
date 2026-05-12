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

export function parseReceipt(mail: ParsedMail): ExtractedItem[] {
  const sender = mail.from?.text ?? "";
  const subject = mail.subject ?? "";
  const html = mail.html || "";
  const text = mail.text || "";
  const merchant = normalizeMerchant(`${sender} ${subject}`);
  if (merchant === "amazon") return parseAmazon(mail, merchant);
  if (merchant === "walmart") return parseWalmart(mail, merchant);
  return parseGenericReceipt(mail, merchant);
}

function parseAmazon(mail: ParsedMail, merchant: string): ExtractedItem[] {
  const $ = cheerio.load(mail.html || "");
  const links = productLinks($, ["amazon.com"]);
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

  const items = links
    .map((url) => {
      const externalId = extractAmazonAsin(url);
      const title = (externalId && titles.get(externalId)) || titleFromUrl(url) || "Amazon item";
      return buildItem({ merchant, orderId, title, url, externalId, purchasedAt, deliveredAt, raw: { parser: "amazon" } });
    })
    .filter(uniqueByKey);

  return items.length ? items : parseGenericReceipt(mail, merchant);
}

function parseWalmart(mail: ParsedMail, merchant: string): ExtractedItem[] {
  const $ = cheerio.load(mail.html || "");
  const links = productLinks($, ["walmart.com"]);
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
  return items.length ? items : parseGenericReceipt(mail, merchant);
}

function parseGenericReceipt(mail: ParsedMail, merchant: string): ExtractedItem[] {
  const $ = cheerio.load(mail.html || "");
  const allText = normalizeWhitespace(`${mail.subject ?? ""} ${$("body").text() || mail.text || ""}`);
  const orderId = findFirst(allText, /(?:order|invoice|confirmation)(?:\s|#| number| id)*[:\s#-]*([A-Z0-9-]{5,})/i);
  const purchasedAt = mail.date?.toISOString();
  const deliveredAt = /delivered/i.test(mail.subject ?? "") ? purchasedAt : undefined;
  const links = productLinks($, []);

  const linkedItems = links
    .map((url) => {
      const title = nearbyLinkText($, url) || titleFromUrl(url);
      if (!title || title.length < 4) return null;
      return buildItem({ merchant, orderId, title, url, purchasedAt, deliveredAt, raw: { parser: "generic-link" } });
    })
    .filter((item): item is ExtractedItem => Boolean(item))
    .filter(uniqueByKey);

  if (linkedItems.length) return linkedItems.slice(0, 20);

  const lineItems = (mail.text || "")
    .split(/\r?\n/)
    .map(normalizeWhitespace)
    .filter((line) => line.length >= 8 && line.length <= 180)
    .filter((line) => !/order|subtotal|total|tax|shipping|payment|address|tracking|unsubscribe/i.test(line))
    .filter((line) => /[a-z]/i.test(line))
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
    const looksProduct = /\/dp\/|\/gp\/product\/|\/ip\/|\/products?\//i.test(lower) || /asin=|itemid=|skuid=/i.test(lower);
    if (domainOk && looksProduct) urls.add(href);
  });
  return Array.from(urls);
}

function nearbyLinkText($: cheerio.CheerioAPI, href: string) {
  let best = "";
  $("a[href]").each((_, element) => {
    const candidate = absoluteUrl($(element).attr("href"));
    if (candidate !== href) return;
    const text = normalizeWhitespace($(element).text() || $(element).parent().text());
    if (text.length > best.length && text.length < 220) best = text;
  });
  return best || undefined;
}

function absoluteUrl(value?: string) {
  if (!value) return undefined;
  try {
    const decoded = value.startsWith("http") ? value : `https://${value.replace(/^\/\//, "")}`;
    const url = new URL(decoded);
    const redirect = url.searchParams.get("url") || url.searchParams.get("u");
    if (redirect?.startsWith("http")) return redirect;
    return url.toString();
  } catch {
    return undefined;
  }
}

function titleFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const candidate = parts.find((part) => part.length > 8 && !/^(dp|gp|product|ip)$/i.test(part));
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
