import { describe, expect, it } from "vitest";
import { CATEGORY_IDS } from "./categories.ts";
import {
  coerceEnabled,
  coerceFeatures,
  coerceSettings,
  DEFAULT_FEATURES,
  normalizeHistory,
} from "./settings.ts";

describe("coerceFeatures", () => {
  it("저장값이 없으면 기본값을 돌려준다", () => {
    expect(coerceFeatures(undefined)).toEqual(DEFAULT_FEATURES);
    expect(coerceFeatures(null)).toEqual(DEFAULT_FEATURES);
    expect(coerceFeatures("x")).toEqual(DEFAULT_FEATURES);
  });

  it("기본값은 막는 기능이 모두 꺼져 있다", () => {
    const features = coerceFeatures({});
    expect(features.enforcePolicy).toBe(false);
    expect(features.blockSend).toBe(false);
    expect(features.requireConfirm).toBe(false);
    expect(features.auditLog).toBe(false);
  });

  it("불리언은 정확히 true일 때만 켜진다", () => {
    const features = coerceFeatures({ blockSend: "true", auditLog: 1, undoButton: false });
    expect(features.blockSend).toBe(false);
    expect(features.auditLog).toBe(false);
    expect(features.undoButton).toBe(false);
  });

  it("숫자·문자열 타입이 틀리면 기본값으로 되돌린다", () => {
    expect(coerceFeatures({ resultAutoHideMs: -5 }).resultAutoHideMs).toBe(8000);
    expect(coerceFeatures({ resultAutoHideMs: "abc" }).resultAutoHideMs).toBe(8000);
    expect(coerceFeatures({ resultAutoHideMs: 3000 }).resultAutoHideMs).toBe(3000);
    expect(coerceFeatures({ noticePosition: 7 }).noticePosition).toBe("top-right");
  });

  it("모르는 키는 버린다", () => {
    expect(coerceFeatures({ nope: true })).not.toHaveProperty("nope");
  });
});

describe("coerceEnabled / coerceSettings", () => {
  it("없는 범주는 켜짐으로 채운다", () => {
    expect(coerceEnabled({ email: false })).toEqual({
      ...Object.fromEntries(CATEGORY_IDS.map((id) => [id, true])),
      email: false,
    });
    // 새 범주가 생기기 전에 저장된 설정(4개 키)도 새 범주는 켜진 채로 읽힌다.
    const legacy = coerceEnabled({ government_id: true, phone_number: true, email: true, api_key: false });
    expect(legacy.credit_card).toBe(true);
    expect(legacy.password).toBe(true);
    expect(legacy.api_key).toBe(false);
  });

  it("빈 저장소는 기본 설정이 된다", () => {
    const settings = coerceSettings({});
    expect(settings.maskStyle).toBe("placeholder");
    expect(settings.features).toEqual(DEFAULT_FEATURES);
    expect(Object.values(settings.enabled).every(Boolean)).toBe(true);
  });
});

describe("normalizeHistory", () => {
  it("최신순으로 돌려주고 이상한 항목은 걸러낸다", () => {
    const rows = normalizeHistory([
      { at: 1, action: "MASK", categories: ["email"] },
      null,
      "x",
      { at: 2, action: "BLOCK", categories: ["api_key", 3] },
    ]);
    expect(rows.map((r) => r.at)).toEqual([2, 1]);
    expect(rows[0]?.categories).toEqual(["api_key"]);
  });

  it("배열이 아니면 빈 목록이다", () => {
    expect(normalizeHistory(undefined)).toEqual([]);
    expect(normalizeHistory({})).toEqual([]);
  });
});
