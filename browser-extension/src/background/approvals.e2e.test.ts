// 실제 PDP 서버로 승인 흐름을 끝까지 시험합니다: 요청 → 관리자 승인 → 수령(한 번만) → 재사용 거절.
// `py tools/server.py e2e`가 서버를 임시 키로 띄워 실행합니다. 환경 변수가 없으면 건너뜁니다.
import { describe, expect, it } from "vitest";
import { APPROVAL_MESSAGE, type ApprovalReply } from "../shared/approval.ts";
import { SERVER_KEYS } from "../shared/serverPolicy.ts";
import { DEFAULT_FEATURES } from "../shared/settings.ts";
import { handleApproval } from "./approvals.ts";
import type { SyncDeps } from "./policySync.ts";

const URL_BASE = process.env.PDP_E2E_URL ?? "";
const KEY = process.env.PDP_E2E_KEY ?? "";
const ADMIN = process.env.PDP_E2E_ADMIN_KEY ?? "";
const enabled = URL_BASE !== "" && KEY !== "" && ADMIN !== "";

function makeDeps(features: Record<string, unknown>): SyncDeps {
  const store: Record<string, unknown> = {
    [SERVER_KEYS.config]: { enabled: true, url: URL_BASE },
    [SERVER_KEYS.apiKey]: KEY,
    features,
  };
  return {
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    get: async (keys) => Object.fromEntries(keys.filter((key) => key in store).map((key) => [key, store[key]])),
    set: async (items) => void Object.assign(store, items),
    hasOrigin: async () => true,
  };
}

const admin = (path: string, init: RequestInit = {}) =>
  fetch(`${URL_BASE}${path}`, { ...init, headers: { Authorization: `Bearer ${ADMIN}`, "Content-Type": "application/json" } });

describe.skipIf(!enabled)("실제 서버로 승인 흐름", () => {
  const deps = makeDeps({ ...DEFAULT_FEATURES, requestApproval: true });
  const send = (message: Record<string, unknown>) => handleApproval(deps, { type: APPROVAL_MESSAGE, ...message });
  const okReply = (reply: ApprovalReply) => {
    expect(reply.ok).toBe(true);
    return reply as Extract<ApprovalReply, { ok: true }>;
  };

  it("요청 → 대기 → 승인 → 한 번 수령 → 재사용 거절", async () => {
    const created = okReply(await send({ op: "create", categories: ["phone_number", "email"], purpose: "customer_response", note: "e2e 시험" }));
    expect(created.status).toBe("PENDING");

    // 관리자 콘솔 쪽: 목록에 보이고, 원문 없는 정보만 있다
    const listed = (await (await admin("/v1/approvals?status=PENDING")).json()) as { approvals: Array<Record<string, unknown>> };
    const mine = listed.approvals.find((item) => item.approval_id === created.id)!;
    expect(mine).toMatchObject({ requester: "e2e", categories: ["email", "phone_number"], purpose: "customer_response", note: "e2e 시험" });
    expect(Object.keys(mine).sort()).toEqual(["approval_id", "categories", "channel", "created_at", "expires_at", "note", "purpose", "requester", "status"]);

    expect(okReply(await send({ op: "status", id: created.id })).status).toBe("PENDING");
    // 승인 전에는 수령할 수 없다
    expect(await send({ op: "consume", id: created.id })).toMatchObject({ ok: false, http: 409 });

    const decided = await admin(`/v1/approvals/${created.id}/decision`, { method: "POST", body: JSON.stringify({ decision: "approve", note: "확인" }) });
    expect(decided.status).toBe(200);

    const approved = okReply(await send({ op: "status", id: created.id }));
    expect(approved).toMatchObject({ status: "APPROVED", note: "확인" });
    expect(okReply(await send({ op: "consume", id: created.id })).status).toBe("CONSUMED");
    expect(await send({ op: "consume", id: created.id })).toMatchObject({ ok: false, http: 409 });
  });

  it("거절된 요청은 수령할 수 없다", async () => {
    const created = okReply(await send({ op: "create", categories: ["api_key"], purpose: "code_work", note: "" }));
    await admin(`/v1/approvals/${created.id}/decision`, { method: "POST", body: JSON.stringify({ decision: "reject", note: "안 됨" }) });
    expect(okReply(await send({ op: "status", id: created.id }))).toMatchObject({ status: "REJECTED", note: "안 됨" });
    expect(await send({ op: "consume", id: created.id })).toMatchObject({ ok: false, http: 409 });
  });

  it("동의 스위치가 꺼져 있으면 서버에 요청이 가지 않는다", async () => {
    const before = ((await (await admin("/v1/approvals?limit=500")).json()) as { approvals: unknown[] }).approvals.length;
    const off = makeDeps({ ...DEFAULT_FEATURES });
    const reply = await handleApproval(off, { type: APPROVAL_MESSAGE, op: "create", categories: ["email"], purpose: "other", note: "" });
    expect(reply.ok).toBe(false);
    expect(((await (await admin("/v1/approvals?limit=500")).json()) as { approvals: unknown[] }).approvals.length).toBe(before);
  });

  it("일반 키로는 목록·처리를 못 하고, 승인 처리는 관리 기록에 남는다", async () => {
    expect((await fetch(`${URL_BASE}/v1/approvals`, { headers: { Authorization: `Bearer ${KEY}` } })).status).toBe(401);
    const events = (await (await admin("/v1/admin/events")).json()) as { records: Array<{ event: { kind: string } }> };
    expect(events.records.map((r) => r.event.kind)).toEqual(expect.arrayContaining(["approval.approve", "approval.reject"]));
    expect(((await (await admin("/v1/admin/events/verify")).json()) as { ok: boolean }).ok).toBe(true);
  });
});
