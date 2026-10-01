"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const detectorContext = vm.createContext({});
const detectorSource = fs.readFileSync(path.join(__dirname, "detector.js"), "utf8");
vm.runInContext(detectorSource, detectorContext, { filename: "detector.js" });

const detector = detectorContext.AIInputGatewayDetector;

// vm 컨텍스트에서 만들어진 값을 현재 컨텍스트의 평범한 객체로 바꿉니다.
// (deepEqual이 프로토타입까지 비교하므로 필요합니다.)
function findMatchesIn(text, options) {
  return Array.from(detector.findMatches(text, options)).map((match) => ({ ...match }));
}

test("탐지 결과가 PDP와 공유하는 범주 ID를 반환한다", () => {
  assert.deepEqual(
    Array.from(detector.inspect("테스트 주민번호형식: 000000-1000000")),
    ["government_id"],
  );
  assert.deepEqual(
    Array.from(detector.inspect("테스트 전화번호형식: 010-0000-0000")),
    ["phone_number"],
  );
  assert.deepEqual(
    Array.from(detector.inspect("테스트 키형식: sk-TESTTESTTESTTESTTEST")),
    ["api_key"],
  );
});

test("탐지 결과에는 원문이나 일치한 값이 들어가지 않는다", () => {
  const result = Array.from(
    detector.inspect("테스트 전화번호형식: 010-0000-0000"),
  );

  assert.deepEqual(result, ["phone_number"]);
  assert.equal(result.includes("010-0000-0000"), false);
});

test("일부 패턴과 일치하지 않는 문장은 빈 범주 목록을 반환한다", () => {
  assert.deepEqual(
    Array.from(detector.inspect("평범한 테스트 문장")),
    [],
  );
});

test("수동 마스킹은 탐지된 값을 유형별 자리표시자로 바꾼다", () => {
  assert.equal(
    detector.mask("테스트 전화번호형식: 010-0000-0000"),
    "테스트 전화번호형식: [전화번호]",
  );
  assert.equal(
    detector.mask("테스트 이메일형식: test.user@example.com"),
    "테스트 이메일형식: [이메일]",
  );
});

test("전각 표기 변형도 탐지 범주로 잡힌다", () => {
  assert.deepEqual(
    Array.from(detector.inspect("테스트 전각전화: ０１０-００００-００００")),
    ["phone_number"],
  );
});

test("마스킹 문자열은 줄바꿈과 감지되지 않은 문장을 유지한다", () => {
  const input = [
    "가짜 주민번호 000000-1000000",
    "가짜 전화번호 010-0000-0000",
    "가짜 키 sk-TESTTESTTESTTESTTEST",
    "그대로 남아야 할 문장",
  ].join("\n");

  const expected = [
    "가짜 주민번호 [주민등록번호]",
    "가짜 전화번호 [전화번호]",
    "가짜 키 [API 키/토큰]",
    "그대로 남아야 할 문장",
  ].join("\n");

  assert.equal(detector.mask(input), expected);
});

test("설정에서 끈 범주는 탐지와 마스킹에서 모두 제외된다", () => {
  const options = { disabledCategories: ["email"] };

  assert.deepEqual(
    Array.from(detector.inspect("테스트 이메일형식: test.user@example.com", options)),
    [],
  );
  assert.equal(
    detector.mask("테스트 이메일형식: test.user@example.com", options),
    "테스트 이메일형식: test.user@example.com",
  );
  // 옵션을 주지 않으면 기존과 같이 이메일이 잡힌다.
  assert.deepEqual(
    Array.from(detector.inspect("테스트 이메일형식: test.user@example.com")),
    ["email"],
  );
});

test("옵션이 비어 있으면 기존 4종 동작을 그대로 유지한다", () => {
  assert.deepEqual(
    Array.from(detector.inspect("테스트 키형식: sk-TESTTESTTESTTESTTEST", {})),
    ["api_key"],
  );
  assert.equal(
    detector.mask("테스트 전화번호형식: 010-0000-0000", { disabledCategories: [] }),
    "테스트 전화번호형식: [전화번호]",
  );
});

test("findMatches는 일치 구간의 위치와 범주만 돌려준다", () => {
  const text = "전화번호: 010-0000-0000";

  assert.deepEqual(findMatchesIn(text), [
    { categoryId: "phone_number", label: "전화번호", start: 6, end: 19 },
  ]);
  assert.equal(text.slice(6, 19), "010-0000-0000");

  // 일치한 문자열은 결과에 담기지 않는다.
  assert.equal(JSON.stringify(findMatchesIn(text)).includes("010-0000-0000"), false);
});

test("findMatches는 빈 입력과 일치하지 않는 문장에 빈 배열을 돌려준다", () => {
  assert.deepEqual(findMatchesIn(""), []);
  assert.deepEqual(findMatchesIn("평범한 테스트 문장"), []);
  assert.deepEqual(findMatchesIn(undefined), []);
});

test("findMatches는 설정에서 끈 범주를 제외한다", () => {
  assert.deepEqual(
    findMatchesIn("테스트 이메일형식: test.user@example.com", {
      disabledCategories: ["email"],
    }),
    [],
  );
});

test("applyMatches(findMatches(x)) 결과가 mask(x)와 같다", () => {
  const samples = [
    "테스트 전화번호형식: 010-0000-0000",
    "가짜 주민번호 000000-1000000",
    "010-0000-0000\n000000-1000000",
    "가짜 주민번호 000000-1000000\n가짜 전화번호 010-0000-0000\n가짜 키 sk-TESTTESTTESTTESTTEST\n그대로 남아야 할 문장",
    "010-0000-0000\r\n000000-1000000",
    "email+key sk-TESTTESTTESTTESTTEST@example.com",
    "test.user@example.com",
    "sk-TESTTESTTESTTESTTEST",
    "같은 줄 두 값: 010-0000-0000 과 010-1111-2222",
    "평범한 테스트 문장",
    "",
  ];

  for (const sample of samples) {
    const matches = detector.findMatches(sample);
    assert.equal(
      detector.applyMatches(sample, matches),
      detector.mask(sample),
      `mask와 위치 기반 치환이 다릅니다: ${JSON.stringify(sample)}`,
    );
  }
});

test("전각 표기만 있는 입력은 findMatches가 비어 mask()의 정규화 치환과 구분된다", () => {
  const fullWidth = "테스트 전각전화: ０１０-００００-００００";

  // 위치를 알 수 없으므로 위치 기반 치환 대상이 아니다.
  assert.deepEqual(findMatchesIn(fullWidth), []);
  assert.equal(detector.applyMatches(fullWidth, []), fullWidth);
  // mask()는 정규화된 보기로 치환하므로 변형 표기만 있는 경우를 구분할 수 있다.
  assert.notEqual(detector.mask(fullWidth), fullWidth);
});

test("추가된 API는 원문을 담지 않고 인수 없이도 안전하게 동작한다", () => {
  assert.equal(detector.applyMatches(undefined, []), "");
  assert.equal(detector.applyMatches("그대로", undefined), "그대로");
  assert.deepEqual(
    findMatchesIn("테스트 전화번호형식: 010-0000-0000", { disabledCategories: ["phone_number"] }),
    [],
  );
});
