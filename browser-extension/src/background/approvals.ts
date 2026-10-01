// 승인 요청을 조직 PDP 서버와 주고받습니다. 서비스 워커에서만 실행합니다.
//
// 조건: ① 조직 서버가 연결돼 있고 ② 사용자가 설정에서 "승인 요청을 조직 서버로 전송"을 직접 켰을 때만.
// 보내는 것: 감지된 범주 ID, 업무 목적(고정 선택지), 사용자가 쓴 짧은 사유. 입력 원문·파일 이름·사이트 주소·내용 해시는 없습니다.
// 이 모듈은 요청을 만들고 상태를 묻고 승인을 한 번 쓰는 일만 하며, 전송을 허용할지는 콘텐츠 스크립트가 정합니다.
import {
  APPROVAL_ID,
  APPROVAL_MESSAGE,
  isApprovalPurpose,
  isServerStatus,
  sanitizeNote,
  type ApprovalReply,
} from "../shared/approval.ts";
import { checkServerUrl, isPlausibleApiKey, readServerConfig, SERVER_KEYS } from "../shared/serverPolicy.ts";
import { coerceFeatures } from "../shared/settings.ts";
import { SYNC_TIMEOUT_MS, type SyncDeps } from "./policySync.ts";

const CATEGORY_ID = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_RESPONSE_CHARS = 2000;

const FAILURE_TEXT: Readonly<Record<number, string>> = {
  401: "서버가 API 키를 받아들이지 않았습니다.",
  404: "서버에서 승인 요청을 찾을 수 없습니다(만료되어 지워졌을 수 있습니다).",
  409: "이미 사용했거나 만료된 승인입니다.",
  413: "서버가 요청이 너무 크다고 거절했습니다.",
  422: "서버가 요청 형식을 받아들이지 않았습니다.",
  429: "대기 중인 승인 요청이 너무 많습니다. 처리된 뒤에 다시 요청해 주세요.",
};

const failure = (error: string, http?: number): ApprovalReply => ({ ok: false, error, ...(http !== undefined ? { http } : {}) });

async function send(
  deps: SyncDeps,
  origin: string,
  key: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);
  try {
    const response = await deps.fetch(`${origin}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    let data: unknown = null;
    try {
      const text = await response.text();
      if (text.length <= MAX_RESPONSE_CHARS) data = JSON.parse(text);
    } catch {
      data = null;
    }
    return { status: response.status, data };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 서버 응답의 승인 상태를 검사해 돌려줍니다. 올바르지 않으면 null.
function readState(data: unknown): Extract<ApprovalReply, { ok: true }> | null {
  if (!data || typeof data !== "object") return null;
  const value = data as Record<string, unknown>;
  if (typeof value.approval_id !== "string" || !APPROVAL_ID.test(value.approval_id)) return null;
  if (!isServerStatus(value.status)) return null;
  if (typeof value.expires_at !== "number" || !Number.isFinite(value.expires_at)) return null;
  return {
    ok: true,
    id: value.approval_id,
    status: value.status,
    expiresAt: value.expires_at,
    note: sanitizeNote(value.decision_note),
  };
}

export async function handleApproval(deps: SyncDeps, raw: unknown): Promise<ApprovalReply> {
  if (!raw || typeof raw !== "object" || (raw as { type?: unknown }).type !== APPROVAL_MESSAGE) {
    return failure("요청 형식이 올바르지 않습니다.");
  }
  const message = raw as Record<string, unknown>;
  const op = message.op;

  // 요청을 서버로 보내기 전에 모양을 모두 검사합니다. 이상한 값은 보내지 않습니다.
  let call: { method: "GET" | "POST"; path: string; body?: unknown };
  if (op === "create") {
    const { categories, purpose } = message;
    if (
      !Array.isArray(categories) ||
      categories.length === 0 ||
      categories.length > 32 ||
      !categories.every((item) => typeof item === "string" && CATEGORY_ID.test(item)) ||
      !isApprovalPurpose(purpose)
    ) {
      return failure("승인 요청 내용이 올바르지 않습니다.");
    }
    call = {
      method: "POST",
      path: "/v1/approvals",
      body: { categories: [...new Set(categories as string[])].sort(), channel: "prompt", purpose, note: sanitizeNote(message.note) },
    };
  } else if (op === "status" || op === "consume") {
    if (typeof message.id !== "string" || !APPROVAL_ID.test(message.id)) return failure("승인 번호가 올바르지 않습니다.");
    call = op === "status" ? { method: "GET", path: `/v1/approvals/${message.id}` } : { method: "POST", path: `/v1/approvals/${message.id}/consume` };
  } else {
    return failure("알 수 없는 요청입니다.");
  }

  const stored = await deps.get([SERVER_KEYS.config, SERVER_KEYS.apiKey, "features"]);
  const config = readServerConfig(stored[SERVER_KEYS.config]);
  if (!config.enabled || !coerceFeatures(stored.features).requestApproval) {
    return failure("승인 요청이 꺼져 있거나 조직 서버에 연결돼 있지 않습니다.");
  }
  const key = stored[SERVER_KEYS.apiKey];
  if (!isPlausibleApiKey(key) || !checkServerUrl(config.url).ok) {
    return failure("API 키나 서버 주소가 올바르지 않습니다. 설정을 확인해 주세요.");
  }
  if (!(await deps.hasOrigin(config.url))) {
    return failure("이 서버에 접근할 권한이 없습니다. 설정에서 다시 연결해 주세요.");
  }

  const result = await send(deps, config.url, key, call.method, call.path, call.body);
  if (!result) return failure("서버에 연결하지 못했습니다.");
  if (result.status < 200 || result.status >= 300) {
    return failure(FAILURE_TEXT[result.status] ?? `서버가 요청을 처리하지 못했습니다(${result.status}).`, result.status);
  }
  return readState(result.data) ?? failure("서버 응답을 해석하지 못했습니다.");
}
