// 서버에서 정책을 내려받는 코드. 가짜 fetch·저장소로 성공·실패·보안 속성을 확인합니다.
// 실제 서버와 붙여 보는 시험은 policySync.e2e.test.ts(py tools/server.py e2e)입니다.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SERVER_KEYS, parseServerPolicy } from "../shared/serverPolicy.ts";
import { MIN_SYNC_INTERVAL_MS, probeServer, syncPolicy, type SyncDeps } from "./policySync.ts";

// 테스트용 가짜 키: 형식 검사(16자 이상)를 통과할 뿐 실제 키가 아닙니다.
const FAKE_KEY = ["fake", "key", "for", "unit", "tests"].join("-");
const ORIGIN = "http://127.0.0.1:8787";

const policyBody = (version = 1) => ({
  policy_id: "default",
  version,
  description: "",
  category_actions: { email: "MASK", api_key: "BLOCK" },
  unknown_category_action: "REQUIRE_APPROVAL",
  bulk_record_threshold: 100,
});

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { ETag: '"etag-1"' }, ...init });

interface Harness {
  deps: SyncDeps;
  store: Record<string, unknown>;
  fetch: ReturnType<typeof vi.fn>;
  clock: { now: number };
  origins: { allowed: boolean };
}

function harness(initial: Record<string, unknown> = {}): Harness {
  const store: Record<string, unknown> = {
    [SERVER_KEYS.config]: { enabled: true, url: ORIGIN },
    [SERVER_KEYS.apiKey]: FAKE_KEY,
    ...initial,
  };
  const clock = { now: 1_000_000 };
  const origins = { allowed: true };
  const fetchMock = vi.fn(async () => jsonResponse(policyBody()));
  const deps: SyncDeps = {
    fetch: fetchMock as unknown as typeof fetch,
    now: () => clock.now,
    get: async (keys) => Object.fromEntries(keys.filter((key) => key in store).map((key) => [key, store[key]])),
    set: async (items) => void Object.assign(store, items),
    hasOrigin: async () => origins.allowed,
  };
  return { deps, store, fetch: fetchMock, clock, origins };
}

let h: Harness;
beforeEach(() => {
  h = harness();
});

describe("syncPolicy — 성공", () => {
  it("정책을 받아 검사한 뒤 저장하고 상태를 남긴다", async () => {
    const status = await syncPolicy(h.deps, true);
    expect(status).toMatchObject({ state: "ok", version: 1 });
    expect(status.message).toContain("v1");
    const stored = h.store[SERVER_KEYS.policy] as { version: number; etag: string; categoryActions: Record<string, string> };
    expect(stored.version).toBe(1);
    expect(stored.etag).toBe('"etag-1"');
    expect(stored.categoryActions.api_key).toBe("BLOCK");
    expect(h.store[SERVER_KEYS.status]).toMatchObject({ state: "ok" });
  });

  it("요청은 GET /v1/policy 한 번이고, 키는 Authorization 헤더로만, 쿠키·리다이렉트·캐시는 막는다", async () => {
    await syncPolicy(h.deps, true);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = h.fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${ORIGIN}/v1/policy`);
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.credentials).toBe("omit");
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
    expect(init.referrerPolicy).toBe("no-referrer");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${FAKE_KEY}`);
    // 키가 주소(쿼리)에 들어가지 않는다
    expect(url).not.toContain(FAKE_KEY);
  });

  it("두 번째 요청에는 If-None-Match를 보내고, 304면 정책은 그대로 두고 시각만 갱신한다", async () => {
    await syncPolicy(h.deps, true);
    h.clock.now += 60_000;
    h.fetch.mockResolvedValueOnce(new Response(null, { status: 304 }));
    const status = await syncPolicy(h.deps, true);
    const init = h.fetch.mock.calls[1]![1] as RequestInit;
    expect((init.headers as Record<string, string>)["If-None-Match"]).toBe('"etag-1"');
    expect(status).toMatchObject({ state: "unchanged", version: 1 });
    expect((h.store[SERVER_KEYS.policy] as { fetchedAt: number }).fetchedAt).toBe(h.clock.now);
  });

  it("새 버전이 오면 교체한다(롤백으로 낮은 버전이 와도 서버가 정한 것이니 따른다)", async () => {
    await syncPolicy(h.deps, true);
    h.fetch.mockResolvedValueOnce(jsonResponse(policyBody(5), { headers: { ETag: '"etag-5"' } }));
    await syncPolicy(h.deps, true);
    expect((h.store[SERVER_KEYS.policy] as { version: number }).version).toBe(5);
    h.fetch.mockResolvedValueOnce(jsonResponse(policyBody(2), { headers: { ETag: '"etag-2"' } }));
    await syncPolicy(h.deps, true);
    expect((h.store[SERVER_KEYS.policy] as { version: number }).version).toBe(2);
  });
});

describe("syncPolicy — 호출 빈도", () => {
  it("강제가 아니면 10분 안에는 서버를 다시 부르지 않는다", async () => {
    await syncPolicy(h.deps, false);
    h.clock.now += MIN_SYNC_INTERVAL_MS - 1;
    const status = await syncPolicy(h.deps, false);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(status.state).toBe("unchanged");
    h.fetch.mockResolvedValueOnce(new Response(null, { status: 304 }));
    h.clock.now += 2;
    await syncPolicy(h.deps, false);
    expect(h.fetch).toHaveBeenCalledTimes(2);
  });

  it("강제(설정 화면의 '지금 동기화')는 간격과 상관없이 부른다", async () => {
    await syncPolicy(h.deps, true);
    h.fetch.mockResolvedValueOnce(new Response(null, { status: 304 }));
    await syncPolicy(h.deps, true);
    expect(h.fetch).toHaveBeenCalledTimes(2);
  });

  it("동시에 여러 번 요청해도 서버 호출은 한 번이다", async () => {
    const results = await Promise.all([syncPolicy(h.deps, true), syncPolicy(h.deps, true), syncPolicy(h.deps, true)]);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(new Set(results.map((r) => r.state))).toEqual(new Set(["ok"]));
  });

  it("시계가 거꾸로 가서 받은 시각이 미래여도 간격에 갇히지 않는다", async () => {
    await syncPolicy(h.deps, true);
    h.clock.now -= 3_600_000;
    h.fetch.mockResolvedValueOnce(new Response(null, { status: 304 }));
    await syncPolicy(h.deps, false);
    expect(h.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("syncPolicy — 연결하지 않았거나 설정이 부족할 때는 요청하지 않는다", () => {
  it("연동이 꺼져 있으면 아무것도 하지 않는다", async () => {
    const off = harness({ [SERVER_KEYS.config]: { enabled: false, url: ORIGIN } });
    expect((await syncPolicy(off.deps, true)).state).toBe("off");
    expect(off.fetch).not.toHaveBeenCalled();
  });

  it("설정이 없어도 요청하지 않는다(기본 상태)", async () => {
    const empty = harness();
    delete empty.store[SERVER_KEYS.config];
    expect((await syncPolicy(empty.deps, true)).state).toBe("off");
    expect(empty.fetch).not.toHaveBeenCalled();
  });

  it("안전하지 않은 주소(원격 http)가 저장돼 있어도 요청하지 않는다", async () => {
    const insecure = harness({ [SERVER_KEYS.config]: { enabled: true, url: "http://pdp.example.com" } });
    expect((await syncPolicy(insecure.deps, true)).state).toBe("off");
    expect(insecure.fetch).not.toHaveBeenCalled();
  });

  it("API 키가 없거나 형식이 이상하면 요청하지 않는다", async () => {
    for (const bad of [undefined, "", "short", `${FAKE_KEY}\r\nX-Evil: 1`]) {
      const local = harness({ [SERVER_KEYS.apiKey]: bad });
      const status = await syncPolicy(local.deps, true);
      expect(status.state).toBe("error");
      expect(local.fetch).not.toHaveBeenCalled();
    }
  });

  it("서버 접근 권한이 없으면 요청하지 않는다", async () => {
    h.origins.allowed = false;
    const status = await syncPolicy(h.deps, true);
    expect(status.state).toBe("error");
    expect(status.message).toContain("권한");
    expect(h.fetch).not.toHaveBeenCalled();
  });
});

describe("syncPolicy — 실패해도 이전 정책을 지키고 비밀을 새기지 않는다", () => {
  const withPolicy = async () => {
    await syncPolicy(h.deps, true);
    h.clock.now += 1000;
  };
  const stored = () => h.store[SERVER_KEYS.policy] as { version: number };

  it("401: 키 오류를 알리고 이전 정책을 유지한다", async () => {
    await withPolicy();
    h.fetch.mockResolvedValueOnce(new Response("no", { status: 401 }));
    const status = await syncPolicy(h.deps, true);
    expect(status.state).toBe("error");
    expect(status.message).toContain("API 키");
    expect(status.message).toContain("이전 정책(v1)");
    expect(stored().version).toBe(1);
  });

  it("5xx", async () => {
    await withPolicy();
    h.fetch.mockResolvedValueOnce(new Response("x", { status: 503 }));
    const status = await syncPolicy(h.deps, true);
    expect(status.state).toBe("error");
    expect(status.message).toContain("503");
    expect(stored().version).toBe(1);
  });

  it("네트워크 오류: 오류 내용(주소 등)을 상태에 옮기지 않는다", async () => {
    await withPolicy();
    h.fetch.mockRejectedValueOnce(new TypeError(`Failed to fetch ${ORIGIN}/v1/policy ${FAKE_KEY}`));
    const status = await syncPolicy(h.deps, true);
    expect(status.state).toBe("error");
    expect(JSON.stringify(h.store[SERVER_KEYS.status])).not.toContain(FAKE_KEY);
    expect(JSON.stringify(h.store[SERVER_KEYS.status])).not.toContain("Failed to fetch");
    expect(stored().version).toBe(1);
  });

  it("리다이렉트로 거부당해도(redirect: error) 같은 오류로 처리한다", async () => {
    h.fetch.mockRejectedValueOnce(new TypeError("redirect"));
    expect((await syncPolicy(h.deps, true)).state).toBe("error");
    expect(h.store[SERVER_KEYS.policy]).toBeUndefined();
  });

  it.each([
    ["JSON이 아님", "not json"],
    ["항목 누락", JSON.stringify({ policy_id: "default", version: 1 })],
    ["모르는 조치", JSON.stringify({ ...policyBody(), category_actions: { email: "DELETE" } })],
    ["너무 큼", JSON.stringify({ ...policyBody(), description: "x".repeat(30_000) })],
  ])("받아들이지 않는 응답: %s", async (_name, text) => {
    await withPolicy();
    h.fetch.mockResolvedValueOnce(new Response(text, { status: 200 }));
    const status = await syncPolicy(h.deps, true);
    expect(status.state).toBe("error");
    expect(stored().version).toBe(1);
  });

  it("첫 동기화가 실패하면 정책은 저장되지 않는다(내장 정책 유지)", async () => {
    h.fetch.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await syncPolicy(h.deps, true);
    expect(h.store[SERVER_KEYS.policy]).toBeUndefined();
  });

  it("5초가 지나도 응답이 없으면 중단한다", async () => {
    vi.useFakeTimers();
    try {
      h.fetch.mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      );
      const pending = syncPolicy(h.deps, true);
      await vi.advanceTimersByTimeAsync(5001);
      expect((await pending).state).toBe("error");
    } finally {
      vi.useRealTimers();
    }
  });

  it("어떤 경우에도 상태에 API 키나 응답 본문이 들어가지 않는다", async () => {
    h.fetch.mockResolvedValueOnce(new Response(`secret ${FAKE_KEY}`, { status: 500 }));
    await syncPolicy(h.deps, true);
    expect(JSON.stringify(h.store[SERVER_KEYS.status])).not.toContain(FAKE_KEY);
    expect(JSON.stringify(h.store[SERVER_KEYS.status])).not.toContain("secret");
  });
});

describe("probeServer (연결 시험)", () => {
  it("저장하지 않고 결과만 돌려준다", async () => {
    const status = await probeServer(h.deps, ORIGIN, FAKE_KEY);
    expect(status).toMatchObject({ state: "ok", version: 1 });
    expect(h.store[SERVER_KEYS.policy]).toBeUndefined();
    expect(h.store[SERVER_KEYS.status]).toBeUndefined();
  });

  it("주소·키 형식이 틀리거나 권한이 없으면 요청 없이 실패한다", async () => {
    expect((await probeServer(h.deps, "http://pdp.example.com", FAKE_KEY)).state).toBe("error");
    expect((await probeServer(h.deps, ORIGIN, "short")).state).toBe("error");
    h.origins.allowed = false;
    expect((await probeServer(h.deps, ORIGIN, FAKE_KEY)).state).toBe("error");
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("401과 잘못된 응답을 구분해 알린다", async () => {
    h.fetch.mockResolvedValueOnce(new Response("", { status: 401 }));
    expect((await probeServer(h.deps, ORIGIN, FAKE_KEY)).message).toContain("API 키");
    h.fetch.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    expect((await probeServer(h.deps, ORIGIN, FAKE_KEY)).state).toBe("error");
  });
});

describe("parseServerPolicy와 동기화가 같은 검사를 쓴다", () => {
  it("동기화로 저장된 값은 그대로 다시 검사를 통과한다", async () => {
    await syncPolicy(h.deps, true);
    const stored = h.store[SERVER_KEYS.policy] as Record<string, unknown>;
    expect(() =>
      parseServerPolicy(
        {
          policy_id: stored.policyId,
          version: stored.version,
          category_actions: stored.categoryActions,
          unknown_category_action: stored.unknownCategoryAction,
          bulk_record_threshold: stored.bulkRecordThreshold,
        },
        0,
      ),
    ).not.toThrow();
  });
});
