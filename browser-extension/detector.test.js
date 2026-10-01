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
