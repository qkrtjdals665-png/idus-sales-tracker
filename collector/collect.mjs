import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { dateKeyKst, parseSalesCount, trimSnapshots } from "./lib.mjs";

const root = path.resolve(import.meta.dirname, "..");
const configPath = path.join(root, "collector", "config.json");
const dataPath = path.join(root, "data", "tracker.json");
const config = JSON.parse(await fs.readFile(configPath, "utf8"));

async function readTracker() {
  try {
    return JSON.parse(await fs.readFile(dataPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return { version: 1, updatedAt: null, keywords: {} };
  }
}

async function fetchSales(url) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "text/html",
          "Accept-Language": "ko-KR,ko;q=0.9",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
            "AppleWebKit/537.36 Chrome/136 Safari/537.36"
        }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const count = parseSalesCount(await response.text());
      if (Number.isFinite(count)) return count;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
  return null;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker)
  );
  return results;
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  locale: "ko-KR",
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 Chrome/136 Safari/537.36"
});
const tracker = await readTracker();
const today = dateKeyKst();

try {
  for (const target of config.keywords) {
    await page.goto(target.url, {
      waitUntil: "domcontentloaded",
      timeout: 60_000
    });
    await page
      .locator('a[href*="/v2/product/"] .BaseProductCardImage')
      .first()
      .waitFor({ timeout: 30_000 });

    const products = await page.evaluate(() => {
      const result = {};
      const seen = new Set();
      let organicRank = 0;
      let pagePosition = 0;

      for (const link of document.querySelectorAll('a[href*="/v2/product/"]')) {
        if (!link.querySelector(".BaseProductCardImage")) continue;
        const id = link.href.match(/\/v2\/product\/([a-f0-9-]+)/i)?.[1];
        if (!id) continue;

        pagePosition += 1;
        const advertised = Boolean(link.querySelector(".BaseBadgeAd"));
        if (!advertised) organicRank += 1;

        const existing = result[id];
        const reviewText =
          link.querySelector(".BaseRating__labelAppned")?.textContent || "";
        const item = {
          id,
          url: new URL(`/v2/product/${id}`, location.origin).href,
          title:
            link
              .querySelector(".BaseProductCardVerticalContents__productName")
              ?.textContent?.trim() || "",
          artist:
            link
              .querySelector(".BaseProductCardVerticalContents__artistName span")
              ?.textContent?.trim() || "",
          reviews: Number(reviewText.replace(/[^\d]/g, "")) || 0,
          advertised,
          pagePosition,
          organicRank: advertised ? null : organicRank
        };

        if (!seen.has(id)) {
          result[id] = item;
          seen.add(id);
        } else {
          existing.advertised ||= advertised;
          if (!advertised && !Number.isFinite(existing.organicRank)) {
            existing.organicRank = organicRank;
            existing.pagePosition = pagePosition;
          }
        }
      }
      return Object.values(result);
    });

    const salesCounts = await mapWithConcurrency(
      products,
      4,
      async (product) => {
        try {
          return await fetchSales(product.url);
        } catch (error) {
          console.warn(`판매량 확인 실패: ${product.id}`, error.message);
          return null;
        }
      }
    );

    const productMap = Object.fromEntries(
      products.map((product, index) => [
        product.id,
        { ...product, totalSales: salesCounts[index] }
      ])
    );
    const previous = tracker.keywords[target.keyword] || {
      searchUrl: target.url,
      snapshots: {}
    };

    tracker.keywords[target.keyword] = {
      searchUrl: target.url,
      snapshots: {
        ...trimSnapshots(
          previous.snapshots,
          Number(config.retentionDays) || 40
        ),
        [today]: {
          capturedAt: new Date().toISOString(),
          products: productMap
        }
      }
    };
    console.log(
      `${target.keyword}: ${products.length}개 상품, ` +
        `${products.filter((item) => item.advertised).length}개 광고 제외 순위 저장`
    );
  }
} finally {
  await browser.close();
}

tracker.version = 1;
tracker.updatedAt = new Date().toISOString();
await fs.mkdir(path.dirname(dataPath), { recursive: true });
await fs.writeFile(dataPath, `${JSON.stringify(tracker, null, 2)}\n`, "utf8");
