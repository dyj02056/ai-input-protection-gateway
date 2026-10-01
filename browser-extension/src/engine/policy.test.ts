// 같은 케이스를 TS 모듈과 빌드 산출물(dist-ext/policy.js)에 모두 돌립니다.
// 브라우저 엔진과 PDP(policy.py)가 함께 쓰는 공용 케이스 표(tools/policy_cases.json)를 사용합니다.
// 같은 표를 py tools/policy_parity.py에서 Python 엔진으로 다시 확인합니다.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadArtifactGlobal, REPO_ROOT, throwsTypeError } from "../test/artifact.ts";
import { policy as modulePolicy, type Policy } from "./policy.ts";

interface SharedCase {
  name: string;
  categories: string[];
  action: string;
  reasonCodes: string[];
}

const SHARED_CASES = (
  JSON.parse(readFileSync(resolve(REPO_ROOT, "tools", "policy_cases.json"), "utf8")) as {
    cases: SharedCase[];
  }
).cases;

const subjects: Array<[string, () => Policy]> = [
  ["TS 모듈", () => modulePolicy],
  [
    "빌드 산출물 dist-ext/policy.js",
    () => loadArtifactGlobal<Policy>("policy.js", "AIInputGatewayPolicy"),
  ],
];

describe.each(subjects)("policy (%s)", (_name, load) => {
  const policy = load();
  // vm 렐름에서 만들어진 값을 평범한 객체로 바꿉니다.
  const decideIn = (categories: unknown, options?: object) => {
    const decision = policy.decide(categories, options as never);
    return { action: decision.action, reasonCodes: Array.from(decision.reasonCodes) };
  };

  it("policy.py와 같은 케이스 표에서 동일한 조치를 낸다", () => {
    for (const item of SHARED_CASES) {
      const actual = decideIn(item.categories);
      expect(actual.action, `${item.name}: 조치`).toBe(item.action);
      expect(actual.reasonCodes, `${item.name}: 이유 코드`).toEqual(item.reasonCodes);
    }
  });

  it("공용 케이스 표가 비어 있지 않다", () => {
    // 표를 잘못 읽어 검사가 무의미해지는 것을 막습니다.
    expect(SHARED_CASES.length).toBeGreaterThanOrEqual(10);
  });

  it("가장 엄격한 조치를 고른다 (BLOCK > REQUIRE_APPROVAL > MASK > ALLOW)", () => {
    expect(decideIn(["email"]).action).toBe("MASK");
    expect(decideIn(["email", "passport_number"]).action).toBe("REQUIRE_APPROVAL");
    expect(decideIn(["passport_number", "api_key"]).action).toBe("BLOCK");
    expect(decideIn(["api_key", "email", "passport_number"]).action).toBe("BLOCK");
  });

  it("미등록 범주가 있으면 UNKNOWN_CATEGORY_PRESENT를 더한다", () => {
    expect(decideIn(["email"]).reasonCodes).toEqual(["MASK_POLICY_MATCHED"]);
    expect(decideIn(["email", "passport_number"]).reasonCodes).toEqual([
      "APPROVAL_POLICY_MATCHED",
      "UNKNOWN_CATEGORY_PRESENT",
    ]);
  });

  it("탐지 범주가 없으면 ALLOW", () => {
    const allow = { action: "ALLOW", reasonCodes: ["NO_DETECTED_CATEGORY"] };
    expect(decideIn([])).toEqual(allow);
    expect(decideIn(null)).toEqual(allow);
    expect(decideIn(undefined)).toEqual(allow);
  });

  it("원문 문자열을 범주 목록으로 받지 않는다", () => {
    // 원문이 실수로 정책 엔진에 들어가는 것을 막는 안전장치입니다.
    expect(throwsTypeError(() => policy.decide("010-0000-0000"))).toBe(true);
    expect(throwsTypeError(() => policy.decide({ phone_number: true }))).toBe(true);
    expect(throwsTypeError(() => policy.decide([""]))).toBe(true);
    expect(throwsTypeError(() => policy.decide([" phone_number"]))).toBe(true);
    expect(throwsTypeError(() => policy.decide([123]))).toBe(true);
  });

  it("결과에 원문이나 일치한 문자열이 들어가지 않는다", () => {
    const serialized = JSON.stringify(decideIn(["phone_number", "government_id"]));
    expect(serialized.includes("010-")).toBe(false);
    expect(serialized.includes("000000-")).toBe(false);
    expect(serialized).toBe('{"action":"MASK","reasonCodes":["MASK_POLICY_MATCHED"]}');
  });

  it("정책을 넘기면 조치를 바꿀 수 있다", () => {
    const custom = {
      categoryActions: { api_key: "MASK", email: "REQUIRE_APPROVAL" },
      unknownCategoryAction: "BLOCK",
    };
    expect(decideIn(["api_key"], custom).action).toBe("MASK");
    expect(decideIn(["email"], custom).action).toBe("REQUIRE_APPROVAL");
    expect(decideIn(["passport_number"], custom).action).toBe("BLOCK");
    expect(decideIn(["email", "api_key"], custom).action).toBe("REQUIRE_APPROVAL");
  });

  it("알 수 없는 조치 이름은 오류로 알린다", () => {
    expect(
      throwsTypeError(() => policy.decide(["email"], { categoryActions: { email: "DELETE" } })),
    ).toBe(true);
  });

  it("기본 정책 매핑이 detector의 범주 ID와 일치한다", () => {
    expect(Object.keys(policy.DEFAULT_CATEGORY_ACTIONS).sort()).toEqual([
      "api_key",
      "email",
      "government_id",
      "phone_number",
    ]);
    expect(policy.DEFAULT_CATEGORY_ACTIONS.api_key).toBe("BLOCK");
    expect(policy.UNKNOWN_CATEGORY_ACTION).toBe("REQUIRE_APPROVAL");
  });

  it("공개 API가 얼려 있어 바꿀 수 없다", () => {
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.DEFAULT_CATEGORY_ACTIONS)).toBe(true);
  });
});
