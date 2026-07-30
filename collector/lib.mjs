export function dateKeyKst(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function parseSalesCount(html) {
  const normalized = html
    .replace(/&nbsp;/g, " ")
    .replace(/&#33;/g, "!")
    .replace(/\\u0021/g, "!");
  const match =
    normalized.match(/([\d,]+)\s*명의\s*고객님들이\s*구매했어요!/) ||
    normalized.match(/([\d,]+)명의 고객님들이 구매했어요/);
  return match ? Number(match[1].replaceAll(",", "")) : null;
}

export function trimSnapshots(snapshots, retentionDays, now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
  const cutoffKey = dateKeyKst(cutoff);
  return Object.fromEntries(
    Object.entries(snapshots || {}).filter(([date]) => date >= cutoffKey)
  );
}
