// 조직 PDP 서버가 내려주는 정책의 모양과 검사입니다. 백그라운드(내려받기)·콘텐츠(적용)·설정 화면(표시)이 함께 씁니다.
//
// 서버 응답은 믿지 않고 적용 전에 엄격히 검사합니다. 하나라도 어긋나면 그 정책 전체를 버리고 이전 정책을 유지합니다.
// (모양은 gateway-core/server/policies.py의 to_public_dict()와 같습니다. 서버가 나중에 항목을 더해도
//  모르는 최상위 항목은 무시하므로 확장이 깨지지 않습니다.)
import type { PolicyOptions } from "../engine/policy.ts";
import type { ActionName } from "./categories.ts";

export interface ServerPolicy {
  readonly policyId: string;
  readonly version: number;
  readonly description: string;
  readonly categoryActions: Readonly<Record<string, ActionName>>;
  readonly unknownCategoryAction: ActionName;
  // 표에서 감지된 행이 이만큼 이상이면 BLOCK
  readonly bulkRecordThreshold: number;
  // 내려받은 시각(ms)과 서버가 준 ETag(다음 요청에 If-None-Match로 보냅니다)
  readonly fetchedAt: number;
  readonly etag?: string;
}

export class PolicyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyValidationError";
  }
}

const ACTIONS: ReadonlySet<string> = new Set(["ALLOW", "MASK", "REQUIRE_APPROVAL", "BLOCK"]);
const CATEGORY_ID = /^[a-z][a-z0-9_]{0,63}$/;
const POLICY_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const MAX_CATEGORIES = 64;
const MAX_BULK_THRESHOLD = 1_000_000;
const MAX_BODY_CHARS = 20_000; // 정책 응답이 이보다 크면 의심합니다

function isAction(value: unknown): value is ActionName {
  return typeof value === "string" && ACTIONS.has(value);
}

// 서버 응답(JSON을 파싱한 값)을 검사해 ServerPolicy로 바꿉니다. 올바르지 않으면 PolicyValidationError.
export function parseServerPolicy(raw: unknown, fetchedAt: number, etag?: string): ServerPolicy {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new PolicyValidationError("정책이 객체가 아닙니다.");
  }
  const data = raw as Record<string, unknown>;

  const policyId = data.policy_id;
  if (typeof policyId !== "string" || !POLICY_ID.test(policyId)) {
    throw new PolicyValidationError("policy_id가 올바르지 않습니다.");
  }

  const version = data.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1 || version > 1_000_000_000) {
    throw new PolicyValidationError("version이 올바르지 않습니다.");
  }

  const description = typeof data.description === "string" ? data.description.slice(0, 500) : "";

  const rawActions = data.category_actions;
  if (!rawActions || typeof rawActions !== "object" || Array.isArray(rawActions)) {
    throw new PolicyValidationError("category_actions가 객체가 아닙니다.");
  }
  const entries = Object.entries(rawActions as Record<string, unknown>);
  if (entries.length === 0 || entries.length > MAX_CATEGORIES) {
    throw new PolicyValidationError("category_actions의 항목 수가 올바르지 않습니다.");
  }
  // 프로토타입 오염을 막으려고 프로토타입 없는 객체에 담습니다. (CATEGORY_ID는 __proto__ 같은 이름도 거부합니다.)
  const categoryActions: Record<string, ActionName> = Object.create(null);
  for (const [category, action] of entries) {
    if (!CATEGORY_ID.test(category)) throw new PolicyValidationError("범주 ID 형식이 올바르지 않습니다.");
    if (!isAction(action)) throw new PolicyValidationError("알 수 없는 조치 이름이 있습니다.");
    categoryActions[category] = action;
  }

  if (!isAction(data.unknown_category_action)) {
    throw new PolicyValidationError("unknown_category_action이 올바르지 않습니다.");
  }

  const threshold = data.bulk_record_threshold;
  if (typeof threshold !== "number" || !Number.isInteger(threshold) || threshold < 1 || threshold > MAX_BULK_THRESHOLD) {
    throw new PolicyValidationError("bulk_record_threshold가 올바르지 않습니다.");
  }

  return Object.freeze({
    policyId,
    version,
    description,
    categoryActions: Object.freeze(categoryActions),
    unknownCategoryAction: data.unknown_category_action,
    bulkRecordThreshold: threshold,
    fetchedAt,
    ...(etag ? { etag } : {}),
  });
}

// 저장소에 넣어 둔 정책을 다시 읽을 때. 저장소는 믿을 수 있는 곳이 아니라고 보고 같은 검사를 한 번 더 합니다.
export function readStoredPolicy(stored: unknown): ServerPolicy | null {
  if (!stored || typeof stored !== "object") return null;
  const value = stored as Record<string, unknown>;
  try {
    return parseServerPolicy(
      {
        policy_id: value.policyId,
        version: value.version,
        description: value.description,
        category_actions: value.categoryActions,
        unknown_category_action: value.unknownCategoryAction,
        bulk_record_threshold: value.bulkRecordThreshold,
      },
      typeof value.fetchedAt === "number" ? value.fetchedAt : 0,
      typeof value.etag === "string" ? value.etag : undefined,
    );
  } catch {
    return null;
  }
}

// 로컬 정책 엔진(policy.js)에 넘기는 모양
export function toEngineOptions(policy: ServerPolicy): PolicyOptions {
  return { categoryActions: policy.categoryActions, unknownCategoryAction: policy.unknownCategoryAction };
}

export const MAX_POLICY_RESPONSE_CHARS = MAX_BODY_CHARS;

// 서버 주소 검사: HTTPS여야 하고, 로컬 개발용 localhost·127.0.0.1만 HTTP를 허용합니다.
// API 키가 평문으로 오가지 않게 하려는 것입니다. 주소에는 경로·인증 정보·쿼리를 넣지 못합니다.
export interface ServerUrlCheck {
  readonly ok: boolean;
  readonly origin?: string;
  readonly message?: string;
}

export function checkServerUrl(input: string): ServerUrlCheck {
  const text = input.trim();
  if (!text) return { ok: false, message: "서버 주소를 입력해 주세요." };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, message: "주소 형식이 올바르지 않습니다. 예: https://pdp.example.com" };
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    return { ok: false, message: "주소는 https:// 로 시작해야 합니다. (개발용 localhost·127.0.0.1만 http를 쓸 수 있습니다.)" };
  }
  if (url.username || url.password) {
    return { ok: false, message: "주소에 사용자 이름·비밀번호를 넣지 마세요. API 키는 아래 입력란에 따로 넣습니다." };
  }
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    return { ok: false, message: "주소에는 경로·쿼리를 넣지 말고 서버 주소만 적어 주세요. 예: https://pdp.example.com" };
  }
  return { ok: true, origin: url.origin };
}

// 서버 연동이 chrome.storage.local에 쓰는 키입니다.
//  - serverConfig: 연동 여부와 서버 주소(비밀 아님)
//  - serverApiKey: API 키. 백그라운드와 설정 화면만 읽습니다(콘텐츠 스크립트·팝업은 읽지 않습니다).
//  - serverPolicy: 내려받아 검사를 통과한 정책(콘텐츠 스크립트가 적용)
//  - serverStatus: 마지막 동기화 결과(설정 화면에 표시). 키·원문은 담지 않습니다.
export const SERVER_KEYS = Object.freeze({
  config: "serverConfig",
  apiKey: "serverApiKey",
  policy: "serverPolicy",
  status: "serverStatus",
});

export interface ServerConfig {
  readonly enabled: boolean;
  readonly url: string;
}

export type SyncState = "ok" | "unchanged" | "error" | "off";

export interface SyncStatus {
  readonly state: SyncState;
  readonly message: string;
  readonly at: number;
  readonly version?: number;
}

export function readServerConfig(value: unknown): ServerConfig {
  if (value && typeof value === "object") {
    const data = value as Record<string, unknown>;
    if (data.enabled === true && typeof data.url === "string") {
      const check = checkServerUrl(data.url);
      if (check.ok && check.origin) return { enabled: true, url: check.origin };
    }
  }
  return { enabled: false, url: "" };
}

export function readSyncStatus(value: unknown): SyncStatus | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const state = data.state;
  if (state !== "ok" && state !== "unchanged" && state !== "error" && state !== "off") return null;
  if (typeof data.message !== "string" || typeof data.at !== "number") return null;
  return {
    state,
    message: data.message.slice(0, 300),
    at: data.at,
    ...(typeof data.version === "number" ? { version: data.version } : {}),
  };
}

// 메시지 이름(콘텐츠·설정 화면 → 백그라운드)
export const POLICY_SYNC_MESSAGE = "gateway:policy-sync";
export const POLICY_PROBE_MESSAGE = "gateway:policy-probe";

// API 키로 쓸 수 있는 값인지(HTTP 헤더에 안전하게 넣을 수 있는지)만 확인합니다. 키의 형식은 서버가 정합니다.
export function isPlausibleApiKey(value: unknown): value is string {
  return typeof value === "string" && value.length >= 16 && value.length <= 256 && /^[\x21-\x7e]+$/.test(value);
}
