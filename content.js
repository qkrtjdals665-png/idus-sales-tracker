const BADGE_CLASS = "idus-sales-tracker-badge";
const IMAGE_SELECTOR = ".BaseProductCardImage";
const PRODUCT_LINK_SELECTOR = 'a[href*="/v2/product/"]';

let scanTimer = null;
let lastSignature = "";
let forceNextScan = false;

function getProductId(url) {
  return url.match(/\/v2\/product\/([a-f0-9-]+)/i)?.[1] || null;
}

function formatNumber(value) {
  return Number(value).toLocaleString("ko-KR");
}

function findCards() {
  const seen = new Set();
  const cards = [];
  let organicRank = 0;

  for (const link of document.querySelectorAll(PRODUCT_LINK_SELECTOR)) {
    const id = getProductId(link.href);
    const imageArea = link.querySelector(IMAGE_SELECTOR);
    if (!id || !imageArea) continue;

    const advertised = Boolean(link.querySelector(".BaseBadgeAd"));
    if (!advertised) organicRank += 1;
    if (seen.has(id)) continue;

    seen.add(id);
    const title =
      link.querySelector(".BaseProductCardVerticalContents__productName")
        ?.textContent?.trim() || "";
    const reviewText =
      link.querySelector(".BaseRating__labelAppned")?.textContent || "";
    const reviews = Number(reviewText.replace(/[^\d]/g, "")) || 0;

    cards.push({
      id,
      url: new URL(`/v2/product/${id}`, location.origin).href,
      title,
      reviews,
      advertised,
      organicRank: advertised ? null : organicRank,
      link,
      imageArea
    });
  }
  return cards;
}

function loadingBadge(card) {
  let badge = card.imageArea.querySelector(`:scope > .${BADGE_CLASS}`);
  if (!badge) {
    badge = document.createElement("div");
    badge.className = BADGE_CLASS;
    badge.innerHTML = `
      <span class="idus-sales-pill idus-sales-pill--loading">
        판매량 확인 중
      </span>
    `;
    card.imageArea.appendChild(badge);
  }
  return badge;
}

function renderResult(card, result) {
  const badge = loadingBadge(card);

  if (!result || !Number.isFinite(result.total)) {
    badge.innerHTML = `
      <span class="idus-sales-pill idus-sales-pill--error"
            title="${result?.error || "구매 수치를 불러오지 못했습니다"}">
        판매량 확인 불가
      </span>
    `;
    return;
  }

  const todayText = Number.isFinite(result.today)
    ? `오늘 ${formatNumber(result.today)}`
    : "오늘 집계중";
  const weekText = Number.isFinite(result.sevenDays)
    ? `7일 ${formatNumber(result.sevenDays)}`
    : "7일 집계중";
  const reviewText = Number.isFinite(result.reviewToday)
    ? `리뷰 +${formatNumber(result.reviewToday)}`
    : "리뷰 집계중";
  let rankText = result.advertised
    ? "광고·자연순위 없음"
    : "자연순위 없음";
  if (Number.isFinite(result.organicRank)) {
    const movement =
      result.rankChange > 0
        ? ` ▲${result.rankChange}`
        : result.rankChange < 0
          ? ` ▼${Math.abs(result.rankChange)}`
          : Number.isFinite(result.rankChange)
            ? " -"
            : "";
    rankText = `자연 ${result.organicRank}위${movement}`;
  }

  badge.innerHTML = `
    <span class="idus-sales-pill idus-sales-pill--total">
      누적 ${formatNumber(result.total)}
    </span>
    <span class="idus-sales-pill idus-sales-pill--today">
      ${todayText}
    </span>
    <span class="idus-sales-pill idus-sales-pill--week">
      ${weekText}
    </span>
    <span class="idus-sales-pill idus-sales-pill--review">
      ${reviewText}
    </span>
    <span class="idus-sales-pill idus-sales-pill--rank">
      ${rankText}
    </span>
  `;
}

async function scan(force = false) {
  const cards = findCards();
  if (!cards.length) return;

  cards.forEach(loadingBadge);
  const signature = cards.map((card) => card.id).sort().join(",");
  if (signature === lastSignature && !force) return;
  lastSignature = signature;

  const response = await chrome.runtime.sendMessage({
    type: "IDUS_TRACK_PRODUCTS",
    force,
    products: cards.map(
      ({ id, url, title, reviews, advertised, organicRank }) => ({
        id,
        url,
        title,
        reviews,
        advertised,
        organicRank,
        keyword: new URLSearchParams(location.search).get("keyword") || ""
      })
    )
  });

  if (!response?.ok) return;
  const resultMap = new Map(response.results.map((item) => [item.id, item]));
  for (const card of findCards()) {
    renderResult(card, resultMap.get(card.id));
  }
}

function scheduleScan() {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(() => {
    const force = forceNextScan;
    forceNextScan = false;
    scan(force);
  }, 450);
}

const observer = new MutationObserver(scheduleScan);
observer.observe(document.documentElement, {
  childList: true,
  subtree: true
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "IDUS_FORCE_REFRESH") {
    forceNextScan = true;
    lastSignature = "";
    scheduleScan();
    sendResponse({ ok: true });
  }
});

scheduleScan();
