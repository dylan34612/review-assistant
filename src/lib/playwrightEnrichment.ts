import { ProductSnapshot } from "@/lib/types";
import { normalizeWhitespace } from "@/lib/normalize";

// Patched into every page to strip common bot-detection signals.
const STEALTH_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  window.chrome = { runtime: {} };
`;

export async function enrichWithPlaywright(
  url: string,
  merchant: string,
  base: ProductSnapshot
): Promise<ProductSnapshot> {
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.log(`[enrichment] playwright not available, falling back to HTTP for ${url}`);
    return base;
  }

  // PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH lets Alpine-based images use the
  // system Chromium from apk instead of a downloaded browser binary.
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
      ],
    });
  } catch (err) {
    console.log(`[enrichment] browser launch failed (${err instanceof Error ? err.message : err}), falling back to HTTP for ${url}`);
    return base;
  }

  try {
    console.log(`[enrichment] playwright fetching ${url}`);
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      locale: "en-US",
      timezoneId: "America/New_York",
    });
    const page = await ctx.newPage();
    await page.addInitScript(STEALTH_SCRIPT);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });

    if (merchant === "amazon") return extractAmazon(page, base);
    if (merchant === "walmart") return extractWalmart(page, base);
    return base;
  } catch (err) {
    console.log(`[enrichment] page fetch failed (${err instanceof Error ? err.message : err}), falling back to HTTP for ${url}`);
    return base;
  } finally {
    await browser.close();
  }
}

async function extractAmazon(page: Awaited<ReturnType<import("playwright").Browser["newPage"]>>, base: ProductSnapshot): Promise<ProductSnapshot> {
  const data = await page.evaluate(() => {
    const q = (sel: string) => document.querySelector(sel)?.textContent?.trim() ?? "";
    const qs = (sel: string) => Array.from(document.querySelectorAll(sel));

    const title = q("#productTitle") || q("[data-feature-name='title'] span");

    const rawBrand = q("#bylineInfo");
    const brand = rawBrand.replace(/^(Visit the |Brand:\s*|by\s+)/i, "").split(" Store")[0].trim();

    const bullets = qs("#feature-bullets .a-list-item")
      .map((el) => el.textContent?.trim() ?? "")
      .filter((l) => l.length > 5 && l.length < 250 && !/^\s*$/.test(l))
      .slice(0, 8);

    const imageUrl =
      (document.querySelector("#landingImage") as HTMLImageElement)?.src ||
      (document.querySelector("#imgBlkFront") as HTMLImageElement)?.src || "";

    const ratingText = q(".a-icon-alt");
    const rating = ratingText.match(/^([\d.]+)/)?.[1] ?? "";

    const reviewCount = q("#acrCustomerReviewText").replace(/[^0-9]/g, "");

    const category = qs(
      "#wayfinding-breadcrumbs_feature_div li a, .a-breadcrumb li a"
    )
      .map((el) => el.textContent?.trim() ?? "")
      .filter(Boolean)
      .join(" > ");

    const details: Record<string, string> = {};
    qs(
      "#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 li"
    ).forEach((el) => {
      const label = el.querySelector("th, .a-text-bold")?.textContent?.replace(/\W+$/, "").trim();
      const value = el.querySelector("td, .a-text-normal")?.textContent?.trim();
      if (label && value && label.length < 50) details[label] = value;
    });

    return { title, brand, bullets, imageUrl, rating, reviewCount, category, details };
  });

  return {
    ...base,
    title: normalizeWhitespace(data.title) || base.title,
    brand: normalizeWhitespace(data.brand) || base.brand,
    bullets: data.bullets.length ? data.bullets : base.bullets,
    imageUrl: data.imageUrl || base.imageUrl,
    category: data.category || base.category,
    details: Object.keys(data.details).length ? data.details : base.details,
    rating: data.rating ? parseFloat(data.rating) : base.rating,
    reviewCount: data.reviewCount ? parseInt(data.reviewCount, 10) : base.reviewCount,
    source: "metadata",
  };
}

async function extractWalmart(page: Awaited<ReturnType<import("playwright").Browser["newPage"]>>, base: ProductSnapshot): Promise<ProductSnapshot> {
  const data = await page.evaluate(() => {
    const q = (sel: string) => document.querySelector(sel)?.textContent?.trim() ?? "";
    const qs = (sel: string) => Array.from(document.querySelectorAll(sel));

    const title =
      q('[itemprop="name"]') ||
      q("h1") ||
      q('[data-automation-id="product-title"]');

    const brand =
      q('[itemprop="brand"]') ||
      q('[data-automation-id="product-brand"]');

    const bullets = qs(
      "[data-testid='product-highlights'] li, .about-this-item li"
    )
      .map((el) => el.textContent?.trim() ?? "")
      .filter((l) => l.length > 5 && l.length < 250)
      .slice(0, 8);

    const imageUrl =
      (document.querySelector('[data-testid="hero-image-container"] img') as HTMLImageElement)?.src ||
      (document.querySelector('[data-testid="main-image"] img') as HTMLImageElement)?.src || "";

    const category = qs("[aria-label='breadcrumb'] a, nav[aria-label='breadcrumb'] a")
      .map((el) => el.textContent?.trim() ?? "")
      .filter(Boolean)
      .join(" > ");

    return { title, brand, bullets, imageUrl, category };
  });

  return {
    ...base,
    title: normalizeWhitespace(data.title) || base.title,
    brand: normalizeWhitespace(data.brand) || base.brand,
    bullets: data.bullets.length ? data.bullets : base.bullets,
    imageUrl: data.imageUrl || base.imageUrl,
    category: data.category || base.category,
    source: "metadata",
  };
}
