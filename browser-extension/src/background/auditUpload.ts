// 감사 이벤트를 조직 PDP 서버로 보냅니다. 서비스 워커에서만 실행합니다.
//
// 조건: ① 조직 서버가 연결돼 있고 ② 사용자가 설정에서 "감사 이벤트를 조직 서버로 전송"을 직접 켰을 때만.
// 보내는 것: 이벤트 ID(무작위)·발생 시각·조치·범주 ID·채널(입력/파일)·정책 버전. 그 외에는 없습니다.
//   입력 원문, 파일 이름, 사이트 주소, 감지 건수, 사용자 식별자는 보내지 않습니다.
// 못 보낸 이벤트는 이 브라우저의 저장소에 최대 500건까지 쌓아 두었다가 다시 보냅니다(서버가 같은 ID를 한 번만 저장합니다).
// 스위치를 끄면 쌓여 있던 이벤트는 보내지 않고 지웁니다.
import {
  checkServerUrl,
  isPlausibleApiKey,
  readServerConfig,
  readStoredPolicy,
  SERVER_KEYS,
} from "../shared/serverPolicy.ts";
import { coerceFeatures } from "../shared/settings.ts";
import { SYNC_TIMEOUT_MS, type SyncDeps } from "./policySync.ts";

export const QUEUE_LIMIT = 500;
export const BATCH_SIZE = 50;
export const RETRY_AFTER_FAILURE_MS = 30_000;

const ACTIONS = new Set(["ALLOW", "MASK", "REQUIRE_APPROVAL", "BLOCK"]);
const CATEGORY_ID = /^[a-z][a-z0-9_]{0,63}$/;
const EVENT_ID = /^[0-9a-f]{32}$/;

export interface AuditEvent {
  readonly event_id: string;
  readonly at: number;
  readonly action: string;
  readonly categories: readonly string[];
  readonly channel: "prompt" | "file";
  readonly policy_version?: number;
}

export interface AuditStatus {
  readonly state: "ok" | "error" | "off";
  readonly message: string;
  readonly at: number;
  readonly pending: number;
}

export interface AuditDeps extends SyncDeps {
  readonly newId: () => string;
}

// 메시지로 들어온 값을 검사해 이벤트로 만듭니다. 이상하면 null(버립니다).
export function sanitizeEvent(raw: unknown, newId: () => string, policyVersion: number | undefined): AuditEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const { action, categories, channel, at } = value;
  if (typeof action !== "string" || !ACTIONS.has(action)) return null;
  if (!Array.isArray(categories) || categories.length === 0 || categories.length > 32) return null;
  if (!categories.every((item) => typeof item === "string" && CATEGORY_ID.test(item))) return null;
  if (channel !== "prompt" && channel !== "file") return null;
  if (typeof at !== "number" || !Number.isFinite(at) || at < 0 || at > 4_102_444_800_000) return null;
  const id = newId();
  if (!EVENT_ID.test(id)) return null;
  return {
    event_id: id,
    at: Math.floor(at),
    action,
    categories: [...new Set(categories as string[])].sort(),
    channel,
    ...(policyVersion !== undefined ? { policy_version: policyVersion } : {}),
  };
}

function readQueue(value: unknown): AuditEvent[] {
  if (!Array.isArray(value)) return [];
  const out: AuditEvent[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const event = item as AuditEvent;
    if (EVENT_ID.test(event.event_id) && ACTIONS.has(event.action)) out.push(event);
  }
  return out.slice(-QUEUE_LIMIT);
}

let inflight: Promise<void> | null = null;
let lastFailureAt = 0;

async function setStatus(deps: AuditDeps, state: AuditStatus["state"], message: string, pending: number): Promise<void> {
  try {
    await deps.set({ [SERVER_KEYS.auditStatus]: { state, message, at: deps.now(), pending } satisfies AuditStatus });
  } catch {
    // 상태 기록 실패는 무시합니다.
  }
}

// 이벤트 한 건을 대기열에 넣고 보냅니다. 조건이 안 맞으면 조용히 버립니다(동의 없이는 저장도 하지 않습니다).
export async function enqueueAudit(deps: AuditDeps, raw: unknown): Promise<boolean> {
  const stored = await deps.get([SERVER_KEYS.config, "features", SERVER_KEYS.policy, SERVER_KEYS.auditQueue]);
  const config = readServerConfig(stored[SERVER_KEYS.config]);
  if (!config.enabled || !coerceFeatures(stored.features).uploadAudit) return false;

  const policy = readStoredPolicy(stored[SERVER_KEYS.policy]);
  const event = sanitizeEvent(raw, deps.newId, policy?.version);
  if (!event) return false;

  const queue = [...readQueue(stored[SERVER_KEYS.auditQueue]), event].slice(-QUEUE_LIMIT);
  await deps.set({ [SERVER_KEYS.auditQueue]: queue });
  void flushAudit(deps, false);
  return true;
}

export function flushAudit(deps: AuditDeps, force: boolean): Promise<void> {
  if (inflight) return inflight;
  const run = doFlush(deps, force).finally(() => {
    inflight = null;
  });
  inflight = run;
  return run;
}

async function doFlush(deps: AuditDeps, force: boolean): Promise<void> {
  const stored = await deps.get([SERVER_KEYS.config, SERVER_KEYS.apiKey, "features", SERVER_KEYS.auditQueue]);
  let queue = readQueue(stored[SERVER_KEYS.auditQueue]);
  const config = readServerConfig(stored[SERVER_KEYS.config]);

  // 동의가 꺼졌거나 서버 연결이 끊겼으면 쌓여 있던 것을 보내지 않고 지웁니다.
  if (!config.enabled || !coerceFeatures(stored.features).uploadAudit) {
    if (stored[SERVER_KEYS.auditQueue] !== undefined) await deps.set({ [SERVER_KEYS.auditQueue]: [] });
    return;
  }
  if (queue.length === 0) return;

  const key = stored[SERVER_KEYS.apiKey];
  if (!isPlausibleApiKey(key) || !checkServerUrl(config.url).ok) {
    return setStatus(deps, "error", "API 키나 서버 주소가 올바르지 않아 보내지 못했습니다.", queue.length);
  }
  if (!force && deps.now() - lastFailureAt < RETRY_AFTER_FAILURE_MS) return;
  if (!(await deps.hasOrigin(config.url))) {
    lastFailureAt = deps.now();
    return setStatus(deps, "error", "이 서버에 접근할 권한이 없어 보내지 못했습니다.", queue.length);
  }

  for (let round = 0; round < 5 && queue.length > 0; round += 1) {
    // 전송하는 사이 새로 쌓인 이벤트도 이어서 보내도록 매번 저장소의 대기열을 다시 읽습니다.
    if (round > 0) queue = readQueue((await deps.get([SERVER_KEYS.auditQueue]))[SERVER_KEYS.auditQueue]);
    if (queue.length === 0) break;
    const batch = queue.slice(0, BATCH_SIZE);
    const outcome = await post(deps, config.url, key, batch);
    if (outcome === "retry") {
      lastFailureAt = deps.now();
      return setStatus(deps, "error", "서버에 보내지 못했습니다. 나중에 다시 시도합니다.", queue.length);
    }
    // 보냈거나(ok) 서버가 형식을 거절한 묶음(rejected: 다시 보내도 같으므로 버립니다)은 대기열에서 뺍니다.
    // 보내는 동안 쌓인 것을 지우지 않도록, 방금 보낸 묶음만 저장소의 최신 대기열 앞에서 뺍니다.
    const current = readQueue((await deps.get([SERVER_KEYS.auditQueue]))[SERVER_KEYS.auditQueue]);
    queue = current.slice(batch.length);
    await deps.set({ [SERVER_KEYS.auditQueue]: queue });
    if (outcome === "rejected") {
      await setStatus(deps, "error", "서버가 일부 이벤트의 형식을 받아들이지 않아 버렸습니다.", queue.length);
    }
  }
  const latest = readQueue((await deps.get([SERVER_KEYS.auditQueue]))[SERVER_KEYS.auditQueue]);
  lastFailureAt = 0;
  await setStatus(deps, "ok", "감사 이벤트를 서버로 보냈습니다.", latest.length);
}

async function post(deps: AuditDeps, origin: string, key: string, events: AuditEvent[]): Promise<"ok" | "retry" | "rejected"> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);
  try {
    const response = await deps.fetch(`${origin}/v1/audit`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ events }),
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    if (response.ok) return "ok";
    if (response.status === 422 || response.status === 413) return "rejected";
    return "retry"; // 401·5xx 등: 이벤트를 남겨 두고 나중에 다시
  } catch {
    return "retry";
  } finally {
    clearTimeout(timer);
  }
}

export function chromeAuditDeps(base: SyncDeps): AuditDeps {
  return { ...base, newId: () => crypto.randomUUID().replaceAll("-", "") };
}
