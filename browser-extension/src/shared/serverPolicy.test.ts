import { describe, expect, it } from "vitest";
import {
  checkServerUrl,
  isPlausibleApiKey,
  parseServerPolicy,
  PolicyValidationError,
  readServerConfig,
  readStoredPolicy,
  readSyncStatus,
  toEngineOptions,
} from "./serverPolicy.ts";

const valid = () => ({
  policy_id: "default",
  version: 3,
  description: "기본",
  category_actions: { email: "MASK", api_key: "BLOCK" },
  unknown_category_action: "REQUIRE_APPROVAL",
  bulk_record_threshold: 100,
});

describe("parseServerPolicy", () => {
  it("올바른 정책을 읽고, 알 수 없는 최상위 항목은 무시한다", () => {
    const policy = parseServerPolicy({ ...valid(), future_field: { x: 1 } }, 123, '"abc"');
    expect(policy).toMatchObject({
      policyId: "default",
      version: 3,
      unknownCategoryAction: "REQUIRE_APPROVAL",
      bulkRecordThreshold: 100,
      fetchedAt: 123,
      etag: '"abc"',
    });
    expect(policy.categoryActions).toEqual({ email: "MASK", api_key: "BLOCK" });
    expect(toEngineOptions(policy)).toEqual({
      categoryActions: policy.categoryActions,
      unknownCategoryAction: "REQUIRE_APPROVAL",
    });
  });

  it("결과는 얼려 있어 나중에 바뀌지 않는다", () => {
    const policy = parseServerPolicy(valid(), 0);
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.categoryActions)).toBe(true);
  });

  it.each([
    ["객체가 아님", null],
    ["배열", []],
    ["문자열", "policy"],
    ["policy_id 없음", { ...valid(), policy_id: undefined }],
    ["policy_id 형식", { ...valid(), policy_id: "Bad Id" }],
    ["version 0", { ...valid(), version: 0 }],
    ["version 소수", { ...valid(), version: 1.5 }],
    ["version 문자열", { ...valid(), version: "3" }],
    ["version 너무 큼", { ...valid(), version: 2_000_000_000 }],
    ["category_actions 없음", { ...valid(), category_actions: undefined }],
    ["category_actions 배열", { ...valid(), category_actions: [] }],
    ["category_actions 비어 있음", { ...valid(), category_actions: {} }],
    ["모르는 조치 이름", { ...valid(), category_actions: { email: "DELETE" } }],
    ["조치가 문자열이 아님", { ...valid(), category_actions: { email: 3 } }],
    ["범주 ID 대문자", { ...valid(), category_actions: { Email: "MASK" } }],
    ["범주 ID __proto__", JSON.parse('{"policy_id":"p","version":1,"category_actions":{"__proto__":"MASK"},"unknown_category_action":"BLOCK","bulk_record_threshold":10}')],
    ["unknown 조치 이상", { ...valid(), unknown_category_action: "NOPE" }],
    ["threshold 0", { ...valid(), bulk_record_threshold: 0 }],
    ["threshold 소수", { ...valid(), bulk_record_threshold: 2.5 }],
    ["threshold 너무 큼", { ...valid(), bulk_record_threshold: 10_000_000 }],
    ["threshold 없음", { ...valid(), bulk_record_threshold: undefined }],
  ])("거부: %s", (_name, input) => {
    expect(() => parseServerPolicy(input, 0)).toThrow(PolicyValidationError);
  });

  it("범주 항목이 64개를 넘으면 거부한다", () => {
    const many = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`c${i}`, "MASK"]));
    expect(() => parseServerPolicy({ ...valid(), category_actions: many }, 0)).toThrow(PolicyValidationError);
  });

  it("긴 설명은 잘라 낸다", () => {
    expect(parseServerPolicy({ ...valid(), description: "가".repeat(900) }, 0).description).toHaveLength(500);
  });
});

describe("readStoredPolicy", () => {
  it("저장된 값을 다시 검사해 읽고, 망가졌으면 null이다", () => {
    const policy = parseServerPolicy(valid(), 99, '"e"');
    expect(readStoredPolicy(JSON.parse(JSON.stringify(policy)))).toMatchObject({ version: 3, fetchedAt: 99, etag: '"e"' });
    expect(readStoredPolicy(null)).toBeNull();
    expect(readStoredPolicy("x")).toBeNull();
    expect(readStoredPolicy({ ...policy, categoryActions: { email: "DELETE" } })).toBeNull();
    expect(readStoredPolicy({ ...policy, version: -1 })).toBeNull();
  });
});

describe("checkServerUrl", () => {
  it.each([
    ["https://pdp.example.com", "https://pdp.example.com"],
    ["  https://pdp.example.com/ ", "https://pdp.example.com"],
    ["https://pdp.example.com:8443", "https://pdp.example.com:8443"],
    ["http://localhost:8787", "http://localhost:8787"],
    ["http://127.0.0.1:8787/", "http://127.0.0.1:8787"],
  ])("허용: %s", (input, origin) => {
    expect(checkServerUrl(input)).toEqual({ ok: true, origin });
  });

  it.each([
    ["", "비어 있음"],
    ["pdp.example.com", "스킴 없음"],
    ["http://pdp.example.com", "원격 http"],
    ["ftp://pdp.example.com", "다른 스킴"],
    // 비밀 검사기가 오인하지 않도록 조각으로 이어 붙입니다.
    [["https://", "user", ":", "pass", "@pdp.example.com"].join(""), "인증 정보"],
    ["https://pdp.example.com/v1", "경로"],
    ["https://pdp.example.com/?a=1", "쿼리"],
    ["https://pdp.example.com/#x", "해시"],
    ["javascript:alert(1)", "javascript"],
  ])("거부: %s (%s)", (input) => {
    const result = checkServerUrl(input);
    expect(result.ok).toBe(false);
    expect(result.message).toBeTruthy();
  });
});

describe("저장 값 읽기 도우미", () => {
  it("serverConfig는 올바른 값만 켜진 것으로 본다", () => {
    expect(readServerConfig({ enabled: true, url: "https://a.example.com" })).toEqual({ enabled: true, url: "https://a.example.com" });
    expect(readServerConfig({ enabled: true, url: "http://a.example.com" }).enabled).toBe(false);
    expect(readServerConfig({ enabled: "yes", url: "https://a.example.com" }).enabled).toBe(false);
    expect(readServerConfig(undefined).enabled).toBe(false);
  });

  it("serverStatus는 모양이 맞을 때만 읽는다", () => {
    expect(readSyncStatus({ state: "ok", message: "m", at: 1, version: 2 })).toEqual({ state: "ok", message: "m", at: 1, version: 2 });
    expect(readSyncStatus({ state: "weird", message: "m", at: 1 })).toBeNull();
    expect(readSyncStatus({ state: "ok", message: 3, at: 1 })).toBeNull();
    expect(readSyncStatus(null)).toBeNull();
  });

  it("API 키는 헤더에 안전한 값만 받는다(형식은 서버가 정한다)", () => {
    expect(isPlausibleApiKey("a".repeat(16))).toBe(true);
    expect(isPlausibleApiKey("a".repeat(15))).toBe(false);
    expect(isPlausibleApiKey("a".repeat(257))).toBe(false);
    expect(isPlausibleApiKey(`${"a".repeat(16)} b`)).toBe(false);
    expect(isPlausibleApiKey(`${"a".repeat(16)}\r\nX: y`)).toBe(false);
    expect(isPlausibleApiKey(`${"a".repeat(16)}한글`)).toBe(false);
    expect(isPlausibleApiKey(undefined)).toBe(false);
  });
});
