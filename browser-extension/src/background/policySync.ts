// 조직 PDP 서버에서 정책을 내려받습니다. 서비스 워커(background.js) 안에서만 실행합니다.
//
// 보내는 것: API 키(Authorization 헤더)와 If-None-Match(이전 ETag)뿐입니다.
//           사용자가 입력한 글·파일·범주·감지 건수는 어떤 경우에도 보내지 않습니다.
// 받는 것: 정책 JSON. 엄격히 검사해 통과한 것만 저장하고, 실패하면 이전 정책을 그대로 둡니다.
import {
  checkServerUrl,
  isPlausibleApiKey,
  MAX_POLICY_RESPONSE_CHARS,
  parseServerPolicy,
  readServerConfig,
  readStoredPolicy,
  SERVER_KEYS,
  type ServerPolicy,
  type SyncStatus,
} from "../shared/serverPolicy.ts";

export const SYNC_TIMEOUT_MS = 5000;
// 콘텐츠 스크립트가 페이지를 열 때마다 동기화를 요청하므로, 너무 자주 서버를 두드리지 않게 간격을 둡니다.
export const MIN_SYNC_INTERVAL_MS = 10 * 60 * 1000;

export interface SyncDeps {
  readonly fetch: typeof fetch;
  readonly now: () => number;
  readonly get: (keys: string[]) => Promise<Record<string, unknown>>;
  readonly set: (items: Record<string, unknown>) => Promise<void>;
  readonly hasOrigin: (origin: string) => Promise<boolean>;
}

let inflight: Promise<SyncStatus> | null = null;

// 같은 시각에 여러 탭이 요청해도 서버 호출은 한 번만 합니다.
export function syncPolicy(deps: SyncDeps, force: boolean): Promise<SyncStatus> {
  if (inflight) return inflight;
  const run = doSync(deps, force).finally(() => {
    inflight = null;
  });
  inflight = run;
  return run;
}

async function record(deps: SyncDeps, status: SyncStatus): Promise<SyncStatus> {
  try {
    await deps.set({ [SERVER_KEYS.status]: status });
  } catch {
    // 상태 기록이 실패해도 동기화 결과 자체는 돌려줍니다.
  }
  return status;
}

// 정책 요청 한 번. 성공하면 응답을, 실패하면 사용자에게 보여 줄 문구를 돌려줍니다. 오류 객체의 내용은 쓰지 않습니다.
async function requestPolicy(
  fetcher: typeof fetch,
  origin: string,
  key: string,
  etag: string | undefined,
): Promise<{ response: Response } | { error: string }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, Accept: "application/json" };
  if (etag) headers["If-None-Match"] = etag;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);
  try {
    const response = await fetcher(`${origin}/v1/policy`, {
      method: "GET",
      headers,
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    return { response };
  } catch {
    return { error: "서버에 연결하지 못했습니다. 주소와 네트워크를 확인해 주세요." };
  } finally {
    clearTimeout(timer);
  }
}

// 응답에서 정책을 꺼냅니다. 통과하지 못하면 사유 문구를 돌려줍니다.
async function readPolicyResponse(response: Response, now: number): Promise<{ policy: ServerPolicy } | { error: string }> {
  if (response.status === 401) return { error: "API 키가 올바르지 않습니다." };
  if (!response.ok) return { error: `서버가 오류(${response.status})를 돌려줬습니다.` };
  let text: string;
  try {
    text = await response.text();
  } catch {
    return { error: "서버 응답을 읽지 못했습니다." };
  }
  if (text.length > MAX_POLICY_RESPONSE_CHARS) return { error: "서버 응답이 너무 커서 받아들이지 않았습니다." };
  try {
    return { policy: parseServerPolicy(JSON.parse(text), now, response.headers.get("ETag") ?? undefined) };
  } catch {
    return { error: "서버가 보낸 정책이 올바르지 않아 받아들이지 않았습니다." };
  }
}

async function doSync(deps: SyncDeps, force: boolean): Promise<SyncStatus> {
  const stored = await deps.get([SERVER_KEYS.config, SERVER_KEYS.apiKey, SERVER_KEYS.policy]);
  const config = readServerConfig(stored[SERVER_KEYS.config]);
  const now = deps.now();
  if (!config.enabled) {
    return { state: "off", message: "서버 연동이 꺼져 있습니다.", at: now };
  }

  const current = readStoredPolicy(stored[SERVER_KEYS.policy]);
  const keep = current ? { version: current.version } : {};
  const fail = (message: string, keepsPolicy = true): Promise<SyncStatus> =>
    record(deps, {
      state: "error",
      message: keepsPolicy && current ? `${message} 이전 정책(v${current.version})을 계속 사용합니다.` : message,
      at: now,
      ...keep,
    });

  const key = stored[SERVER_KEYS.apiKey];
  if (!isPlausibleApiKey(key)) {
    return fail("API 키가 입력되지 않았거나 형식이 올바르지 않습니다.");
  }

  if (!force && current && now >= current.fetchedAt && now - current.fetchedAt < MIN_SYNC_INTERVAL_MS) {
    return { state: "unchanged", message: "최근에 확인했습니다.", at: now, version: current.version };
  }

  if (!(await deps.hasOrigin(config.url))) {
    return fail("이 서버에 접근할 권한이 없습니다. 설정에서 서버 연결을 다시 허용해 주세요.");
  }

  const result = await requestPolicy(deps.fetch, config.url, key, current?.etag);
  if ("error" in result) return fail(result.error);
  const { response } = result;

  if (response.status === 304 && current) {
    await deps.set({ [SERVER_KEYS.policy]: { ...current, fetchedAt: now } });
    return record(deps, { state: "unchanged", message: "정책이 최신입니다.", at: now, version: current.version });
  }

  const parsed = await readPolicyResponse(response, now);
  if ("error" in parsed) return fail(parsed.error);

  await deps.set({ [SERVER_KEYS.policy]: parsed.policy });
  return record(deps, {
    state: "ok",
    message: `조직 정책 v${parsed.policy.version}을 적용했습니다.`,
    at: now,
    version: parsed.policy.version,
  });
}

// 브라우저 API를 SyncDeps로 감쌉니다.
export function chromeDeps(): SyncDeps {
  return {
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    get: (keys) => chrome.storage.local.get(keys),
    set: (items) => chrome.storage.local.set(items),
    hasOrigin: (origin) => chrome.permissions.contains({ origins: [`${origin}/*`] }),
  };
}

// 설정 화면의 "연결 시험"용: 아직 저장하지 않은 주소·키로 한 번 호출해 보기만 합니다. 아무것도 저장하지 않습니다.
export async function probeServer(
  deps: Pick<SyncDeps, "fetch" | "now" | "hasOrigin">,
  url: string,
  key: string,
): Promise<SyncStatus> {
  const now = deps.now();
  const check = checkServerUrl(url);
  if (!check.ok || !check.origin) return { state: "error", message: check.message ?? "주소가 올바르지 않습니다.", at: now };
  if (!isPlausibleApiKey(key)) return { state: "error", message: "API 키 형식이 올바르지 않습니다.", at: now };
  if (!(await deps.hasOrigin(check.origin))) return { state: "error", message: "이 서버에 접근할 권한이 없습니다.", at: now };

  const result = await requestPolicy(deps.fetch, check.origin, key, undefined);
  if ("error" in result) return { state: "error", message: result.error, at: now };
  const parsed = await readPolicyResponse(result.response, now);
  if ("error" in parsed) return { state: "error", message: parsed.error, at: now };
  return { state: "ok", message: `연결되었습니다. 조직 정책 v${parsed.policy.version}`, at: now, version: parsed.policy.version };
}
