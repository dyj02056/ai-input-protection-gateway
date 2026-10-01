import { describe, expect, it } from "vitest";
import {
  ALLOWLIST_MAX_ENTRIES,
  ALLOWLIST_MAX_LENGTH,
  coerceAllowlist,
  coerceSettings,
  DEFAULT_FEATURES,
  parseAllowlistText,
} from "./settings.ts";

describe("허용 목록 정리", () => {
  it("문자열만 받고 앞뒤 공백을 지운다", () => {
    expect(coerceAllowlist([" 02-123-4567 ", 7, null, { a: 1 }, "a@b.co"])).toEqual([
      "02-123-4567",
      "a@b.co",
    ]);
  });

  it("빈 줄과 중복은 버리고 처음 순서를 지킨다", () => {
    expect(coerceAllowlist(["a", "", "  ", "b", "a"])).toEqual(["a", "b"]);
  });

  it("배열이 아니면 빈 목록이다", () => {
    expect(coerceAllowlist(undefined)).toEqual([]);
    expect(coerceAllowlist("02-123-4567")).toEqual([]);
    expect(coerceAllowlist({})).toEqual([]);
  });

  it("개수와 길이에 한도가 있다", () => {
    const many = Array.from({ length: ALLOWLIST_MAX_ENTRIES + 50 }, (_, index) => `값${index}`);
    expect(coerceAllowlist(many)).toHaveLength(ALLOWLIST_MAX_ENTRIES);
    const [long] = coerceAllowlist(["x".repeat(ALLOWLIST_MAX_LENGTH + 40)]);
    expect(long).toHaveLength(ALLOWLIST_MAX_LENGTH);
  });

  it("입력란 텍스트는 줄 단위로 읽고 윈도우 줄바꿈도 처리한다", () => {
    expect(parseAllowlistText("02-123-4567\r\n\r\nsupport@example.com\n")).toEqual([
      "02-123-4567",
      "support@example.com",
    ]);
  });

  it("저장된 설정에서 읽고, 없으면 빈 목록이다", () => {
    expect(coerceSettings({ allowlist: ["a"] }).allowlist).toEqual(["a"]);
    expect(coerceSettings({}).allowlist).toEqual([]);
  });

  it("엄격 검증은 기본 꺼짐이다 (체험용 가짜 주민번호가 감지되도록)", () => {
    expect(DEFAULT_FEATURES.strictValidation).toBe(false);
  });
});
