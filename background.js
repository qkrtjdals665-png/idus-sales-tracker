const STORAGE_KEY = "idusSalesTrackerProducts";
const CLOUD_URL_KEY = "idusSalesTrackerCloudUrl";
const DEFAULT_CLOUD_URL =
  "https://raw.githubusercontent.com/qkrtjdals665-png/idus-sales-tracker/main/data/tracker.json";
const ALARM_NAME = "idus-sales-midnight-snapshot";
const CACHE_MS = 5 * 60 * 1000;
const FETCH_CONCURRENCY = 4;
let cloudCache = { url: "", fetchedAt: 0, data: null };

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateKeyDaysAgo(days) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return localDateKey(date);
}

async function readProducts() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return stored[STORAGE_KEY] || {};
}

async function writeProducts(products) {
  await chrome.storage.local.set({ [STORAGE_KEY]: products });
}

function parseSalesCount(html) {
  const normalized = html
    .replace(/&nbsp;/g, " ")
    .replace(/&#33;/g, "!")
    .replace(/\\u0021/g, "!");
  const match =
    normalized.match(/([\d,]+)\s*명의\s*고객님들이\s*구매했어요!/) ||
    normalized.match(/([\d,]+)명의 고객님들이 구매했어요/);
  return match ? Number(match[1].replaceAll(",", "")) : null;
}

async function fetchSalesCount(url) {
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "text/html" }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return parseSalesCount(await response.text());
}

function trimHistory(history) {
  const cutoff = dateKeyDaysAgo(40);
  return Object.fromEntries(
    Object.entries(history || {}).filter(([date]) => date >= cutoff)
  );
}

function makeResult(product) {
  const today = localDateKey();
  const sevenDaysAgo = dateKeyDaysAgo(7);
  const todayBaseline = product.history?.[today];
  const weekBaseline = product.history?.[sevenDaysAgo];

  return {
    id: product.id,
    total: product.lastCount ?? null,
    today: Number.isFinite(todayBaseline) && Number.isFinite(product.lastCount)
      ? Math.max(0, product.lastCount - todayBaseline)
      : null,
    sevenDays: Number.isFinite(weekBaseline) && Number.isFinite(product.lastCount)
      ? Math.max(0, product.lastCount - weekBaseline)
      : null,
    checkedAt: product.lastChecked || null,
    error: product.error || null
  };
}

function getCloudProduct(cloudData, keyword, date, id) {
  return cloudData?.keywords?.[keyword]?.snapshots?.[date]?.products?.[id] || null;
}

function makeCombinedResult(product, incoming, cloudData) {
  const localResult = makeResult(product);
  const today = localDateKey();
  const yesterday = dateKeyDaysAgo(1);
  const sevenDaysAgo = dateKeyDaysAgo(7);
  const cloudToday = getCloudProduct(
    cloudData,
    incoming.keyword,
    today,
    incoming.id
  );
  const cloudYesterday = getCloudProduct(
    cloudData,
    incoming.keyword,
    yesterday,
    incoming.id
  );
  const cloudWeek = getCloudProduct(
    cloudData,
    incoming.keyword,
    sevenDaysAgo,
    incoming.id
  );
  const localReviewBaseline = product.reviewHistory?.[yesterday];
  const localPreviousRank =
    product.rankHistory?.[incoming.keyword]?.[yesterday] ?? null;

  const todaySales =
    Number.isFinite(cloudToday?.totalSales) &&
    Number.isFinite(product.lastCount)
      ? Math.max(0, product.lastCount - cloudToday.totalSales)
      : localResult.today;
  const sevenDays =
    Number.isFinite(cloudWeek?.totalSales) &&
    Number.isFinite(product.lastCount)
      ? Math.max(0, product.lastCount - cloudWeek.totalSales)
      : localResult.sevenDays;
  const reviewBaseline = Number.isFinite(cloudYesterday?.reviews)
    ? cloudYesterday.reviews
    : localReviewBaseline;
  const previousRank = Number.isFinite(cloudYesterday?.organicRank)
    ? cloudYesterday.organicRank
    : localPreviousRank;

  return {
    ...localResult,
    today: todaySales,
    sevenDays,
    reviews: Number.isFinite(incoming.reviews) ? incoming.reviews : null,
    reviewToday:
      Number.isFinite(reviewBaseline) && Number.isFinite(incoming.reviews)
        ? Math.max(0, incoming.reviews - reviewBaseline)
        : null,
    organicRank: Number.isFinite(incoming.organicRank)
      ? incoming.organicRank
      : null,
    rankChange:
      Number.isFinite(previousRank) && Number.isFinite(incoming.organicRank)
        ? previousRank - incoming.organicRank
        : null,
    advertised: Boolean(incoming.advertised),
    cloudConnected: Boolean(cloudData)
  };
}

async function loadCloudData(force = false) {
  const stored = await chrome.storage.local.get(CLOUD_URL_KEY);
  const url = String(stored[CLOUD_URL_KEY] || DEFAULT_CLOUD_URL).trim();
  if (!url) return null;

  if (
    !force &&
    cloudCache.url === url &&
    Date.now() - cloudCache.fetchedAt < CACHE_MS
  ) {
    return cloudCache.data;
  }

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    cloudCache = { url, fetchedAt: Date.now(), data };
    return data;
  } catch {
    cloudCache = { url, fetchedAt: Date.now(), data: null };
    return null;
  }
}

async function refreshOne(products, incoming, cloudData, force = false) {
  const previous = products[incoming.id] || {
    id: incoming.id,
    history: {}
  };
  const product = {
    ...previous,
    id: incoming.id,
    url: incoming.url,
    title: incoming.title || previous.title || "",
    history: trimHistory(previous.history),
    reviewHistory: trimHistory(previous.reviewHistory),
    rankHistory: previous.rankHistory || {}
  };
  const today = localDateKey();
  if (
    Number.isFinite(incoming.reviews) &&
    !Number.isFinite(product.reviewHistory[today])
  ) {
    product.reviewHistory[today] = incoming.reviews;
  }
  if (incoming.keyword) {
    product.rankHistory[incoming.keyword] = trimHistory(
      product.rankHistory[incoming.keyword]
    );
    if (
      Number.isFinite(incoming.organicRank) &&
      !Number.isFinite(product.rankHistory[incoming.keyword][today])
    ) {
      product.rankHistory[incoming.keyword][today] = incoming.organicRank;
    }
  }

  const cacheIsFresh =
    product.lastChecked &&
    Date.now() - new Date(product.lastChecked).getTime() < CACHE_MS;

  if (cacheIsFresh && !force) {
    products[incoming.id] = product;
    return makeCombinedResult(product, incoming, cloudData);
  }

  try {
    const count = await fetchSalesCount(incoming.url);
    if (!Number.isFinite(count)) {
      throw new Error("구매 수치를 찾지 못했습니다");
    }

    const today = localDateKey();
    if (!Number.isFinite(product.history[today])) {
      product.history[today] = count;
    }
    product.lastCount = count;
    product.lastChecked = new Date().toISOString();
    product.error = null;
  } catch (error) {
    product.lastChecked = new Date().toISOString();
    product.error = error instanceof Error ? error.message : String(error);
  }

  products[incoming.id] = product;
  return makeCombinedResult(product, incoming, cloudData);
}

async function refreshProducts(incomingProducts, force = false) {
  const products = await readProducts();
  const cloudData = await loadCloudData(force);
  const results = [];
  let cursor = 0;

  async function worker() {
    while (cursor < incomingProducts.length) {
      const index = cursor++;
      results[index] = await refreshOne(
        products,
        incomingProducts[index],
        cloudData,
        force
      );
    }
  }

  const workerCount = Math.min(FETCH_CONCURRENCY, incomingProducts.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  await writeProducts(products);
  return results;
}

async function refreshAllTracked() {
  const products = await readProducts();
  const incoming = Object.values(products).map(({ id, url, title }) => ({
    id,
    url,
    title
  }));
  if (incoming.length) {
    await refreshProducts(incoming, true);
  }
}

function scheduleMidnightAlarm() {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  next.setHours(0, 1, 0, 0);
  chrome.alarms.create(ALARM_NAME, {
    when: next.getTime(),
    periodInMinutes: 24 * 60
  });
}

chrome.runtime.onInstalled.addListener(() => {
  scheduleMidnightAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  scheduleMidnightAlarm();
  refreshAllTracked();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    refreshAllTracked();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "IDUS_TRACK_PRODUCTS") {
    refreshProducts(message.products || [], Boolean(message.force))
      .then((results) => sendResponse({ ok: true, results }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "IDUS_GET_SUMMARY") {
    Promise.all([
      readProducts(),
      chrome.storage.local.get(CLOUD_URL_KEY),
      loadCloudData()
    ])
      .then(([products, config, cloudData]) => {
        const values = Object.values(products);
        sendResponse({
          ok: true,
          tracked: values.length,
          checked: values.filter((item) => Number.isFinite(item.lastCount)).length,
          lastChecked: values
            .map((item) => item.lastChecked)
            .filter(Boolean)
            .sort()
            .at(-1) || null,
          cloudUrl: config[CLOUD_URL_KEY] || DEFAULT_CLOUD_URL,
          cloudConnected: Boolean(cloudData),
          cloudUpdatedAt: cloudData?.updatedAt || null
        });
      })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "IDUS_SET_CLOUD_URL") {
    const url = String(message.url || "").trim();
    chrome.storage.local
      .set({ [CLOUD_URL_KEY]: url })
      .then(async () => {
        cloudCache = { url: "", fetchedAt: 0, data: null };
        const data = await loadCloudData(true);
        sendResponse({
          ok: true,
          connected: !url || Boolean(data),
          cloudUpdatedAt: data?.updatedAt || null
        });
      })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
});
