// 승인 요청 백그라운드 처리: 동의·연결 조건, 서버로 보내는 내용의 최소성, 응답 검사, 실패 처리.
import { describe, expect, it, vi } from "vitest";
import { APPROVAL_MESSAGE } from "../shared/approval.ts";
import { SERVER_KEYS } from "../shared/serverPolicy.ts";
import { DEFAULT_FEATURES } from "../shared/settings.ts";
import { handleApproval } from "./approvals.ts";
import type { SyncDeps } from "./policySync.ts";

const FAKE_KEY = ["fake", "key", "for", "approval", "tests"].join("-");
const ORIGIN = "http://127.0.0.1:8787";
const ID = "ab".repeat(16);
const STATE = { approval_id: ID, status: "PENDING", expires_at: 1_900_000_000_000, decision_note: "" };

interface Harness {
  deps: SyncDeps;
  fetch: ReturnType<typeof vi.fn>;
}

function harness(over: Record<string, unknown> = {}, reply: () => Response | Promise<Response> = () => json(STATE, 201), hasOrigin = true): Harness {
  const store: Record<string, unknown> = {
    [SERVER_KEYS.config]: { enabled: true, url: ORIGIN },
    [SERVER_KEYS.apiKey]: FAKE_KEY,
    features: { ...DEFAULT_FEATURES, requestApproval: true },
    ...over,
  };
  const fetchMock = vi.fn(async () => reply());
  const deps: SyncDeps = {
    fetch: fetchMock as unknown as typeof fetch,
    now: () => 1,
    get: async (keys) => Object.fromEntries(keys.filter((key) => key in store).map((key) => [key, store[key]])),
    set: async (items) => void Object.assign(store, items),
    hasOrigin: async () => hasOrigin,
  };
  return { deps, fetch: fetchMock };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const create = (over: Record<string, unknown> = {}) => ({
  type: APPROVAL_MESSAGE,
  op: "create",
  categories: ["phone_number", "email", "email"],
  purpose: "customer_response",
  note: "고객 답변 초안",
  ...over,
});

describe("조건: 동의 스위치와 서버 연결", () => {
  it("승인 요청 스위치가 꺼져 있으면(기본) 서버를 부르지 않는다", async () => {
    const h = harness({ features: { ...DEFAULT_FEATURES } });
    expect(await handleApproval(h.deps, create())).toMatchObject({ ok: false });
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("서버에 연결돼 있지 않으면 부르지 않는다", async () => {
    const h = harness({ [SERVER_KEYS.config]: { enabled: false, url: ORIGIN } });
    expect(await handleApproval(h.deps, create())).toMatchObject({ ok: false });
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("키가 이상하거나 서버 접근 권한이 없으면 부르지 않는다", async () => {
    const badKey = harness({ [SERVER_KEYS.apiKey]: "short" });
    expect(await handleApproval(badKey.deps, create())).toMatchObject({ ok: false });
    const noPermission = harness({}, undefined, false);
    expect(await handleApproval(noPermission.deps, create())).toMatchObject({ ok: false });
    expect(badKey.fetch).not.toHaveBeenCalled();
    expect(noPermission.fetch).not.toHaveBeenCalled();
  });
});

describe("요청 만들기", () => {
  it("범주 ID·채널·목적·사유만 보내고, 모르는 필드(원문 등)는 옮기지 않는다", async () => {
    const h = harness();
    const reply = await handleApproval(h.deps, create({ text: "홍길동 010-1234-5678", content_hash: "abc", filename: "고객.xlsx" }));
    expect(reply).toEqual({ ok: true, id: ID, status: "PENDING", expiresAt: 1_900_000_000_000, note: "" });

    const [url, init] = h.fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${ORIGIN}/v1/approvals`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${FAKE_KEY}`);
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ categories: ["email", "phone_number"], channel: "prompt", purpose: "customer_response", note: "고객 답변 초안" });
    expect(init.body).not.toContain("홍길동");
  });

  it("쿠키·리다이렉트·캐시·리퍼러를 쓰지 않는다", async () => {
    const h = harness();
    await handleApproval(h.deps, create());
    const init = h.fetch.mock.calls[0]![1] as RequestInit;
    expect(init).toMatchObject({ credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer" });
  });

  it("사유의 제어 문자를 정리하고 100자로 자른다", async () => {
    const h = harness();
    await handleApproval(h.deps, create({ note: `  가\n\t나${"다".repeat(200)}  ` }));
    const note = JSON.parse((h.fetch.mock.calls[0]![1] as RequestInit).body as string).note as string;
    expect(note.startsWith("가 나다")).toBe(true);
    expect(note).toHaveLength(100);
    expect(note).not.toMatch(/[\n\t]/);
  });

  it.each([
    ["빈 범주", { categories: [] }],
    ["범주에 원문이 섞임", { categories: ["010-1234-5678"] }],
    ["범주가 너무 많음", { categories: Array.from({ length: 33 }, (_, i) => `c${i}`) }],
    ["목적이 선택지가 아님", { purpose: "내 맘대로" }],
    ["알 수 없는 동작", { op: "delete" }],
  ])("보내기 전에 거절한다: %s", async (_name, over) => {
    const h = harness();
    expect(await handleApproval(h.deps, create(over))).toMatchObject({ ok: false });
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("다른 종류의 메시지는 받지 않는다", async () => {
    const h = harness();
    expect(await handleApproval(h.deps, { type: "other", op: "create" })).toMatchObject({ ok: false });
    expect(await handleApproval(h.deps, null)).toMatchObject({ ok: false });
    expect(h.fetch).not.toHaveBeenCalled();
  });
});

describe("상태 확인과 사용", () => {
  it("상태 확인은 GET, 사용은 POST로 승인 번호 경로를 부른다", async () => {
    const h = harness({}, () => json({ ...STATE, status: "APPROVED", decision_note: "확인함" }));
    const status = await handleApproval(h.deps, { type: APPROVAL_MESSAGE, op: "status", id: ID });
    expect(status).toMatchObject({ ok: true, status: "APPROVED", note: "확인함" });
    const consume = await handleApproval(h.deps, { type: APPROVAL_MESSAGE, op: "consume", id: ID });
    expect(consume).toMatchObject({ ok: true });
    const calls = h.fetch.mock.calls as unknown as Array<[string, RequestInit]>;
    expect([calls[0]![0], calls[0]![1].method]).toEqual([`${ORIGIN}/v1/approvals/${ID}`, "GET"]);
    expect([calls[1]![0], calls[1]![1].method]).toEqual([`${ORIGIN}/v1/approvals/${ID}/consume`, "POST"]);
    expect(calls[0]![1].body).toBeUndefined();
  });

  it.each(["../policy", "ab", "AB".repeat(16), `${ID}/consume`, "", 5])("승인 번호 형식이 다르면(경로 조작 방지) 부르지 않는다: %s", async (id) => {
    const h = harness();
    expect(await handleApproval(h.deps, { type: APPROVAL_MESSAGE, op: "status", id })).toMatchObject({ ok: false });
    expect(await handleApproval(h.deps, { type: APPROVAL_MESSAGE, op: "consume", id })).toMatchObject({ ok: false });
    expect(h.fetch).not.toHaveBeenCalled();
  });
});

describe("실패 처리", () => {
  it.each([
    [401, "API 키"],
    [404, "찾을 수 없"],
    [409, "이미 사용"],
    [422, "형식"],
    [429, "너무 많"],
    [500, "500"],
  ])("HTTP %i는 문구와 상태 코드를 돌려준다", async (status, fragment) => {
    const h = harness({}, () => json({ detail: "서버가 보낸 긴 설명" }, status));
    const reply = await handleApproval(h.deps, create());
    expect(reply).toMatchObject({ ok: false, http: status });
    expect((reply as { error: string }).error).toContain(fragment);
    // 서버가 보낸 본문(detail)은 그대로 보여 주지 않는다
    expect((reply as { error: string }).error).not.toContain("서버가 보낸 긴 설명");
  });

  it("네트워크 오류는 서버 연결 실패로 알린다", async () => {
    const h = harness({}, () => Promise.reject(new TypeError("fetch failed")));
    expect(await handleApproval(h.deps, create())).toEqual({ ok: false, error: "서버에 연결하지 못했습니다." });
  });

  it.each([
    ["JSON이 아님", () => new Response("<html>", { status: 201 })],
    ["승인 번호 형식", () => json({ ...STATE, approval_id: "../x" }, 201)],
    ["알 수 없는 상태", () => json({ ...STATE, status: "WHATEVER" }, 201)],
    ["만료 시각 누락", () => json({ approval_id: ID, status: "PENDING" }, 201)],
    ["너무 큰 응답", () => new Response(JSON.stringify({ ...STATE, pad: "x".repeat(5000) }), { status: 201 })],
  ])("올바르지 않은 응답은 버린다: %s", async (_name, reply) => {
    const h = harness({}, reply);
    expect(await handleApproval(h.deps, create())).toMatchObject({ ok: false });
  });

  it("서버가 돌려준 처리 메모의 제어 문자·길이를 정리한다", async () => {
    const h = harness({}, () => json({ ...STATE, status: "REJECTED", decision_note: `<b>안 됨</b>\n${"x".repeat(300)}` }));
    const reply = (await handleApproval(h.deps, { type: APPROVAL_MESSAGE, op: "status", id: ID })) as { note: string };
    expect(reply.note).toHaveLength(100);
    expect(reply.note).not.toContain("\n");
  });
});
