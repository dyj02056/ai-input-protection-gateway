// 감사 이벤트 업로드: 동의·연결 조건, 보내는 내용의 최소성, 재시도·중복 방지.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SERVER_KEYS } from "../shared/serverPolicy.ts";
import { DEFAULT_FEATURES } from "../shared/settings.ts";
import { BATCH_SIZE, enqueueAudit, flushAudit, QUEUE_LIMIT, sanitizeEvent, type AuditDeps } from "./auditUpload.ts";

const FAKE_KEY = ["fake", "key", "for", "audit", "tests"].join("-");
const ORIGIN = "http://127.0.0.1:8787";

let counter = 0;
let harnessCount = 0;
const newId = () => (++counter).toString(16).padStart(32, "0");
const raw = (over: Record<string, unknown> = {}) => ({ at: 1_700_000_000_000, action: "MASK", categories: ["email"], channel: "prompt", ...over });

interface Harness {
  deps: AuditDeps;
  store: Record<string, unknown>;
  fetch: ReturnType<typeof vi.fn>;
  clock: { now: number };
}

function harness(over: Record<string, unknown> = {}): Harness {
  const store: Record<string, unknown> = {
    [SERVER_KEYS.config]: { enabled: true, url: ORIGIN },
    [SERVER_KEYS.apiKey]: FAKE_KEY,
    features: { ...DEFAULT_FEATURES, uploadAudit: true },
    ...over,
  };
  // 실패 직후 재시도 제한(모듈 상태)이 테스트끼리 영향을 주지 않도록 시작 시각을 매번 멀리 띄웁니다.
  const clock = { now: 1_000_000 + ++harnessCount * 3_600_000 };
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ accepted: 1, duplicates: 0, head_seq: 1 }), { status: 200 }));
  const deps: AuditDeps = {
    fetch: fetchMock as unknown as typeof fetch,
    now: () => clock.now,
    get: async (keys) => Object.fromEntries(keys.filter((key) => key in store).map((key) => [key, store[key]])),
    set: async (items) => void Object.assign(store, items),
    hasOrigin: async () => true,
    newId,
  };
  return { deps, store, fetch: fetchMock, clock };
}

const settle = async (h: Harness) => {
  await flushAudit(h.deps, true);
};

beforeEach(() => {
  counter = 0;
});

describe("sanitizeEvent", () => {
  it("올바른 이벤트만 받고, 범주는 중복 제거·정렬한다", () => {
    const event = sanitizeEvent(raw({ categories: ["phone_number", "email", "email"] }), newId, 3);
    expect(event).toMatchObject({ action: "MASK", categories: ["email", "phone_number"], channel: "prompt", policy_version: 3 });
    expect(event!.event_id).toMatch(/^[0-9a-f]{32}$/);
  });

  it.each([
    ["조치 이름", { action: "DELETE" }],
    ["빈 범주", { categories: [] }],
    ["범주 형식(원문이 섞임)", { categories: ["010-1234-5678"] }],
    ["범주가 문자열", { categories: "email" }],
    ["채널", { channel: "x" }],
    ["시각", { at: "now" }],
    ["시각 범위", { at: -5 }],
  ])("버린다: %s", (_name, over) => {
    expect(sanitizeEvent(raw(over), newId, undefined)).toBeNull();
  });

  it("모르는 필드(원문 등)는 결과에 옮기지 않는다", () => {
    const event = sanitizeEvent(raw({ text: "홍길동 010-1234-5678", filename: "고객.xlsx", url: "https://x" }), newId, undefined)!;
    expect(Object.keys(event).sort()).toEqual(["action", "at", "categories", "channel", "event_id"]);
  });
});

describe("enqueueAudit — 동의와 연결이 있어야만", () => {
  it("스위치가 꺼져 있으면(기본) 저장도 전송도 하지 않는다", async () => {
    const h = harness({ features: { ...DEFAULT_FEATURES } });
    expect(await enqueueAudit(h.deps, raw())).toBe(false);
    expect(h.store[SERVER_KEYS.auditQueue]).toBeUndefined();
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("서버가 연결돼 있지 않으면 스위치가 켜져 있어도 하지 않는다", async () => {
    const h = harness({ [SERVER_KEYS.config]: { enabled: false, url: ORIGIN } });
    expect(await enqueueAudit(h.deps, raw())).toBe(false);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.store[SERVER_KEYS.auditQueue]).toBeUndefined();
  });

  it("이상한 이벤트는 버린다", async () => {
    const h = harness();
    expect(await enqueueAudit(h.deps, raw({ action: "X" }))).toBe(false);
    expect(h.fetch).not.toHaveBeenCalled();
  });
});

describe("전송", () => {
  it("한 건을 POST /v1/audit로 보내고 대기열을 비우며, 보내는 값이 최소다", async () => {
    const h = harness();
    await enqueueAudit(h.deps, raw());
    await settle(h);
    expect(h.fetch).toHaveBeenCalled();
    const [url, init] = h.fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${ORIGIN}/v1/audit`);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("omit");
    expect(init.redirect).toBe("error");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${FAKE_KEY}`);
    const body = JSON.parse(init.body as string) as { events: Array<Record<string, unknown>> };
    expect(Object.keys(body)).toEqual(["events"]);
    expect(Object.keys(body.events[0]!).sort()).toEqual(["action", "at", "categories", "channel", "event_id"]);
    expect(init.body as string).not.toContain(FAKE_KEY);
    expect(h.store[SERVER_KEYS.auditQueue]).toEqual([]);
    expect(h.store[SERVER_KEYS.auditStatus]).toMatchObject({ state: "ok", pending: 0 });
  });

  it("저장된 정책 버전을 이벤트에 붙인다", async () => {
    const h = harness({
      [SERVER_KEYS.policy]: {
        policyId: "default", version: 4, description: "", categoryActions: { email: "MASK" },
        unknownCategoryAction: "BLOCK", bulkRecordThreshold: 100, fetchedAt: 1,
      },
    });
    await enqueueAudit(h.deps, raw());
    await settle(h);
    const body = JSON.parse((h.fetch.mock.calls[0]![1] as RequestInit).body as string) as { events: Array<{ policy_version: number }> };
    expect(body.events[0]!.policy_version).toBe(4);
  });

  it("서버가 실패하면(5xx·401·네트워크) 이벤트를 남겨 두고, 나중에 같은 ID로 다시 보낸다", async () => {
    const h = harness();
    h.fetch.mockResolvedValueOnce(new Response("x", { status: 503 }));
    await enqueueAudit(h.deps, raw());
    await settle(h);
    expect((h.store[SERVER_KEYS.auditQueue] as unknown[]).length).toBe(1);
    expect(h.store[SERVER_KEYS.auditStatus]).toMatchObject({ state: "error", pending: 1 });
    const firstId = (h.store[SERVER_KEYS.auditQueue] as Array<{ event_id: string }>)[0]!.event_id;

    h.fetch.mockRejectedValueOnce(new TypeError("down"));
    await settle(h);
    expect((h.store[SERVER_KEYS.auditQueue] as unknown[]).length).toBe(1);

    await settle(h);
    expect(h.store[SERVER_KEYS.auditQueue]).toEqual([]);
    const lastBody = JSON.parse((h.fetch.mock.calls.at(-1)![1] as RequestInit).body as string) as { events: Array<{ event_id: string }> };
    expect(lastBody.events[0]!.event_id).toBe(firstId);
  });

  it("실패한 직후 자동 재시도는 30초 동안 건너뛴다(강제는 즉시)", async () => {
    const h = harness();
    h.fetch.mockResolvedValue(new Response("x", { status: 500 }));
    await enqueueAudit(h.deps, raw());
    await settle(h);
    const calls = h.fetch.mock.calls.length;
    await flushAudit(h.deps, false);
    expect(h.fetch.mock.calls.length).toBe(calls);
    h.clock.now += 31_000;
    await flushAudit(h.deps, false);
    expect(h.fetch.mock.calls.length).toBe(calls + 1);
  });

  it("서버가 형식을 거절(422)하면 그 묶음은 버려 막히지 않는다", async () => {
    const h = harness();
    h.fetch.mockResolvedValueOnce(new Response("{}", { status: 422 }));
    await enqueueAudit(h.deps, raw());
    await settle(h);
    expect(h.store[SERVER_KEYS.auditQueue]).toEqual([]);
  });

  it("50건씩 나눠 보낸다", async () => {
    const h = harness();
    h.store[SERVER_KEYS.auditQueue] = Array.from({ length: 120 }, (_, i) => ({
      event_id: (i + 1000).toString(16).padStart(32, "0"), at: 1, action: "MASK", categories: ["email"], channel: "prompt",
    }));
    await settle(h);
    const sizes = h.fetch.mock.calls.map((call) => (JSON.parse((call[1] as RequestInit).body as string) as { events: unknown[] }).events.length);
    expect(sizes).toEqual([BATCH_SIZE, BATCH_SIZE, 20]);
    expect(h.store[SERVER_KEYS.auditQueue]).toEqual([]);
  });

  it("대기열은 500건을 넘지 않는다(오래된 것부터 버림)", async () => {
    const h = harness();
    h.fetch.mockResolvedValue(new Response("x", { status: 503 }));
    h.store[SERVER_KEYS.auditQueue] = Array.from({ length: QUEUE_LIMIT }, (_, i) => ({
      event_id: (i + 1).toString(16).padStart(32, "0"), at: 1, action: "MASK", categories: ["email"], channel: "prompt",
    }));
    await enqueueAudit(h.deps, raw());
    const queue = h.store[SERVER_KEYS.auditQueue] as unknown[];
    expect(queue.length).toBe(QUEUE_LIMIT);
  });
});

describe("동의를 끄거나 연결을 끊으면", () => {
  it("쌓여 있던 이벤트를 보내지 않고 지운다", async () => {
    const h = harness();
    h.fetch.mockResolvedValue(new Response("x", { status: 503 }));
    await enqueueAudit(h.deps, raw());
    await settle(h);
    expect((h.store[SERVER_KEYS.auditQueue] as unknown[]).length).toBe(1);
    h.fetch.mockClear();
    h.store.features = { ...DEFAULT_FEATURES, uploadAudit: false };
    await settle(h);
    expect(h.store[SERVER_KEYS.auditQueue]).toEqual([]);
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("API 키가 없으면 보내지 않고 오류로 표시한다", async () => {
    const h = harness();
    h.store[SERVER_KEYS.auditQueue] = [{ event_id: "a".repeat(32), at: 1, action: "MASK", categories: ["email"], channel: "prompt" }];
    delete h.store[SERVER_KEYS.apiKey];
    await settle(h);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.store[SERVER_KEYS.auditStatus]).toMatchObject({ state: "error" });
  });
});
