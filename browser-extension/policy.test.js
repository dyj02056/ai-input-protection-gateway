"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const policyContext = vm.createContext({});
const policySource = fs.readFileSync(path.join(__dirname, "policy.js"), "utf8");
vm.runInContext(policySource, policyContext, { filename: "policy.js" });

const policy = policyContext.AIInputGatewayPolicy;

// 브라우저 엔진과 PDP(policy.py)가 함께 쓰는 공용 케이스 표입니다.
// 같은 표를 py tools/policy_parity.py에서 Python 엔진으로 다시 확인합니다.
const SHARED_CASES = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "tools", "policy_cases.json"), "utf8"),
).cases;

// vm 컨텍스트에서 만들어진 값을 현재 컨텍스트의 평범한 객체로 바꿉니다.
// (deepEqual이 프로토타입까지 비교하므로 필요합니다.)
function decideIn(categories, options) {
  const decision = policy.decide(categories, options);
  return { action: decision.action, reasonCodes: Array.from(decision.reasonCodes) };
}

// vm 렐름의 TypeError는 호스트의 TypeError·Error와 다른 생성자입니다.
// instanceof는 두 렐름 사이에서 false가 되므로 이름과 형태만 확인합니다.
function isTypeError(error) {
  return (
    Boolean(error) &&
    typeof error === "object" &&
    error.name === "TypeError" &&
    Object.prototype.toString.call(error) === "[object Error]"
  );
}

test("policy.py와 같은 케이스 표에서 동일한 조치를 낸다", () => {
  for (const item of SHARED_CASES) {
    const actual = decideIn(item.categories);
    assert.equal(actual.action, item.action, `${item.name}: 조치`);
    assert.deepEqual(actual.reasonCodes, item.reasonCodes, `${item.name}: 이유 코드`);
  }
});

test("공용 케이스 표가 비어 있지 않다", () => {
  // 표를 잘못 읽어 검사가 무의미해지는 것을 막습니다.
  assert.ok(SHARED_CASES.length >= 10);
});

test("가장 엄격한 조치를 고른다 (BLOCK > REQUIRE_APPROVAL > MASK > ALLOW)", () => {
  assert.equal(decideIn(["email"]).action, "MASK");
  assert.equal(decideIn(["email", "passport_number"]).action, "REQUIRE_APPROVAL");
  assert.equal(decideIn(["passport_number", "api_key"]).action, "BLOCK");
  assert.equal(decideIn(["api_key", "email", "passport_number"]).action, "BLOCK");
});

test("미등록 범주가 있으면 UNKNOWN_CATEGORY_PRESENT를 더한다", () => {
  assert.deepEqual(decideIn(["email"]).reasonCodes, ["MASK_POLICY_MATCHED"]);
  assert.deepEqual(decideIn(["email", "passport_number"]).reasonCodes, [
    "APPROVAL_POLICY_MATCHED",
    "UNKNOWN_CATEGORY_PRESENT",
  ]);
});

test("탐지 범주가 없으면 ALLOW", () => {
  assert.deepEqual(decideIn([]), { action: "ALLOW", reasonCodes: ["NO_DETECTED_CATEGORY"] });
  assert.deepEqual(decideIn(null), { action: "ALLOW", reasonCodes: ["NO_DETECTED_CATEGORY"] });
  assert.deepEqual(decideIn(undefined), { action: "ALLOW", reasonCodes: ["NO_DETECTED_CATEGORY"] });
});

test("원문 문자열을 범주 목록으로 받지 않는다", () => {
  // 원문이 실수로 정책 엔진에 들어가는 것을 막는 안전장치입니다.
  assert.throws(() => policy.decide("010-0000-0000"), isTypeError);
  assert.throws(() => policy.decide({ phone_number: true }), isTypeError);
  assert.throws(() => policy.decide([""]), isTypeError);
  assert.throws(() => policy.decide([" phone_number"]), isTypeError);
  assert.throws(() => policy.decide([123]), isTypeError);
});

test("결과에 원문이나 일치한 문자열이 들어가지 않는다", () => {
  const serialized = JSON.stringify(decideIn(["phone_number", "government_id"]));
  assert.equal(serialized.includes("010-"), false);
  assert.equal(serialized.includes("000000-"), false);
  assert.equal(
    serialized,
    '{"action":"MASK","reasonCodes":["MASK_POLICY_MATCHED"]}',
  );
});

test("정책을 넘기면 조치를 바꿀 수 있다", () => {
  const custom = {
    categoryActions: { api_key: "MASK", email: "REQUIRE_APPROVAL" },
    unknownCategoryAction: "BLOCK",
  };

  assert.equal(decideIn(["api_key"], custom).action, "MASK");
  assert.equal(decideIn(["email"], custom).action, "REQUIRE_APPROVAL");
  assert.equal(decideIn(["passport_number"], custom).action, "BLOCK");
  assert.equal(decideIn(["email", "api_key"], custom).action, "REQUIRE_APPROVAL");
});

test("알 수 없는 조치 이름은 오류로 알린다", () => {
  assert.throws(
    () => policy.decide(["email"], { categoryActions: { email: "DELETE" } }),
    isTypeError,
  );
});

test("기본 정책 매핑이 detector의 범주 ID와 일치한다", () => {
  assert.deepEqual(Object.keys(policy.DEFAULT_CATEGORY_ACTIONS).sort(), [
    "api_key",
    "email",
    "government_id",
    "phone_number",
  ]);
  assert.equal(policy.DEFAULT_CATEGORY_ACTIONS.api_key, "BLOCK");
  assert.equal(policy.UNKNOWN_CATEGORY_ACTION, "REQUIRE_APPROVAL");
});
