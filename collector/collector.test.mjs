import test from "node:test";
import assert from "node:assert/strict";
import { parseSalesCount, trimSnapshots } from "./lib.mjs";

test("누적 판매량 문구를 숫자로 변환한다", () => {
  assert.equal(
    parseSalesCount("<div>1,280명의 고객님들이 구매했어요!</div>"),
    1280
  );
});

test("보관 기간이 지난 스냅샷을 제거한다", () => {
  const result = trimSnapshots(
    {
      "2026-05-01": {},
      "2026-07-20": {},
      "2026-07-28": {}
    },
    40,
    new Date("2026-07-28T03:00:00Z")
  );
  assert.deepEqual(Object.keys(result), ["2026-07-20", "2026-07-28"]);
});
