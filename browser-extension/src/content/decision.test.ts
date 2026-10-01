import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installEngines, removeEngines } from "../test/contentEnv.ts";
import { alertKey, decideLocalAction, formatCategoryLabels } from "./decision.ts";

afterEach(() => removeEngines());

describe("decideLocalAction (정책 엔진이 있을 때)", () => {
  beforeEach(() => installEngines());

  it.each([
    [[], "ALLOW"],
    [["email"], "MASK"],
    [["email", "phone_number"], "MASK"],
    [["api_key"], "BLOCK"],
    [["email", "api_key"], "BLOCK"],
    [["unregistered_category"], "REQUIRE_APPROVAL"],
  ])("%j → %s", (categories, expected) => {
    expect(decideLocalAction(categories)).toBe(expected);
  });
});

describe("decideLocalAction (policy.js를 읽지 못해 폴백으로 계산할 때)", () => {
  // 엔진이 없을 때도 엔진과 같은 답을 내야 한다.
  it.each([
    [[], "ALLOW"],
    [["email"], "MASK"],
    [["government_id", "phone_number", "email"], "MASK"],
    [["api_key"], "BLOCK"],
    [["email", "api_key"], "BLOCK"],
    [["unregistered_category"], "REQUIRE_APPROVAL"],
    [["email", "unregistered_category"], "REQUIRE_APPROVAL"],
    [["credit_card"], "BLOCK"],
    [["password", "email"], "BLOCK"],
    [["bank_account", "passport_number", "driver_license"], "MASK"],
  ])("%j → %s", (categories, expected) => {
    removeEngines();
    const withoutEngine = decideLocalAction(categories);
    installEngines();
    const withEngine = decideLocalAction(categories);
    expect(withoutEngine).toBe(expected);
    expect(withoutEngine).toBe(withEngine);
  });

  it("엔진이 오류를 내는 입력이어도 폴백으로 답한다", () => {
    installEngines();
    // 범주 ID가 아닌 값이 섞이면 엔진은 TypeError를 낸다. 안내는 계속 떠야 한다.
    expect(() => decideLocalAction([" email"])).not.toThrow();
  });
});

describe("안내 문구 도우미", () => {
  beforeEach(() => installEngines());

  it("범주 ID를 사람이 읽는 이름으로 바꾸고, 모르는 ID는 가린다", () => {
    expect(formatCategoryLabels(["phone_number", "email"])).toBe("전화번호 형식 · 이메일 형식");
    expect(formatCategoryLabels(["mystery"])).toBe("알 수 없는 탐지 범주");
    // 프로토타입 이름이 라벨로 새지 않는다.
    expect(formatCategoryLabels(["constructor"])).toBe("알 수 없는 탐지 범주");
  });

  it("지문은 범주 순서와 무관하고 원문을 담지 않는다", () => {
    expect(alertKey(["email", "phone_number"])).toBe(alertKey(["phone_number", "email"]));
    expect(alertKey(["email"])).toBe("MASK|email");
    expect(alertKey(["api_key"])).not.toBe(alertKey(["email"]));
  });
});
