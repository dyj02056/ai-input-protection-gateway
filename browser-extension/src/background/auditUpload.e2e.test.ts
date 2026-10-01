// 실제 PDP 서버로 감사 이벤트를 보내 해시 체인을 확인합니다. `py tools/server.py e2e`가 서버를 띄워 실행합니다.
// 서버 주소·키는 환경 변수(PDP_E2E_URL, PDP_E2E_KEY, PDP_E2E_ADMIN_KEY)로만 받으며, 없으면 건너뜁니다.
import { describe, expect, it } from "vitest";
import { SERVER_KEYS } from "../shared/serverPolicy.ts";
import { DEFAULT_FEATURES } from "../shared/settings.ts";
import { enqueueAudit, flushAudit, type AuditDeps } from "./auditUpload.ts";

const URL_BASE = process.env.PDP_E2E_URL ?? "";
const KEY = process.env.PDP_E2E_KEY ?? "";
const ADMIN = process.env.PDP_E2E_ADMIN_KEY ?? "";
const enabled = URL_BASE !== "" && KEY !== "" && ADMIN !== "";

function makeDeps(store: Record<string, unknown>, now: number): AuditDeps {
  return {
    fetch: (input, init) => fetch(input, init),
    now: () => now,
    get: async (keys) => Object.fromEntries(keys.filter((key) => key in store).map((key) => [key, store[key]])),
    set: async (items) => void Object.assign(store, items),
    hasOrigin: async () => true,
    newId: () => crypto.randomUUID().replaceAll("-", ""),
  };
}

const admin = (path: string) => fetch(`${URL_BASE}${path}`, { headers: { Authorization: `Bearer ${ADMIN}` } }).then((r) => r.json() as Promise<Record<string, unknown>>);

describe.skipIf(!enabled)("실제 서버로 감사 이벤트 전송", () => {
  it("보낸 이벤트가 서버에 해시 체인으로 쌓이고 검증을 통과하며, 원문 필드가 없다", async () => {
    const store: Record<string, unknown> = {
      [SERVER_KEYS.config]: { enabled: true, url: URL_BASE },
      [SERVER_KEYS.apiKey]: KEY,
      features: { ...DEFAULT_FEATURES, uploadAudit: true },
    };
    const before = (await admin("/v1/audit/head")) as { seq: number };
    const deps = makeDeps(store, Date.now() + 10_000_000);
    await enqueueAudit(deps, { at: Date.now(), action: "BLOCK", categories: ["api_key"], channel: "prompt" });
    await enqueueAudit(deps, { at: Date.now(), action: "REQUIRE_APPROVAL", categories: ["phone_number"], channel: "file" });
    await flushAudit(deps, true);
    expect(store[SERVER_KEYS.auditQueue]).toEqual([]);

    const records = ((await admin(`/v1/audit?after=${before.seq}&limit=10`)) as { records: Array<Record<string, any>> }).records;
    expect(records.map((r) => r.event.action)).toEqual(["BLOCK", "REQUIRE_APPROVAL"]);
    expect(records[0]!.caller).toBe("e2e");
    expect(Object.keys(records[0]!.event).sort()).toEqual(["action", "at", "categories", "channel", "event_id", "policy_version"].filter((k) => k in records[0]!.event).sort());
    expect(records[1]!.prev_hash).toBe(records[0]!.hash);
    const verify = await admin("/v1/audit/verify");
    expect(verify.ok).toBe(true);
  });

  it("일반 API 키로는 로그를 읽을 수 없다", async () => {
    const response = await fetch(`${URL_BASE}/v1/audit`, { headers: { Authorization: `Bearer ${KEY}` } });
    expect(response.status).toBe(401);
  });

  it("스위치가 꺼져 있으면 서버에 아무것도 가지 않는다", async () => {
    const before = (await admin("/v1/audit/head")) as { seq: number };
    const store: Record<string, unknown> = {
      [SERVER_KEYS.config]: { enabled: true, url: URL_BASE },
      [SERVER_KEYS.apiKey]: KEY,
      features: { ...DEFAULT_FEATURES },
    };
    await enqueueAudit(makeDeps(store, Date.now()), { at: Date.now(), action: "BLOCK", categories: ["api_key"], channel: "prompt" });
    expect(((await admin("/v1/audit/head")) as { seq: number }).seq).toBe(before.seq);
  });
});
