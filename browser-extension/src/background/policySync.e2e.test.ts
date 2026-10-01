// 실제 PDP 서버와 붙여 보는 시험입니다. `py tools/server.py e2e`가 서버를 임시 키로 띄우고 이 파일을 실행합니다.
// 서버 주소·키는 환경 변수(PDP_E2E_URL, PDP_E2E_KEY)로만 받으며, 없으면 이 파일의 시험은 건너뜁니다.
// (일반 `npm test`에서는 서버가 없으므로 건너뜁니다.)
import { describe, expect, it } from "vitest";
import { CATEGORY_IDS } from "../shared/categories.ts";
import { readStoredPolicy, SERVER_KEYS, toEngineOptions } from "../shared/serverPolicy.ts";
import { decideLocalAction } from "../content/decision.ts";
import { decideFileAction } from "../content/files/decide.ts";
import { installEngines } from "../test/contentEnv.ts";
import { probeServer, syncPolicy, type SyncDeps } from "./policySync.ts";

const URL_BASE = process.env.PDP_E2E_URL ?? "";
const KEY = process.env.PDP_E2E_KEY ?? "";
const enabled = URL_BASE !== "" && KEY !== "";

function deps(store: Record<string, unknown>, now = Date.now()): SyncDeps {
  return {
    fetch: (input, init) => fetch(input, init),
    now: () => now,
    get: async (keys) => Object.fromEntries(keys.filter((key) => key in store).map((key) => [key, store[key]])),
    set: async (items) => void Object.assign(store, items),
    hasOrigin: async () => true,
  };
}

const connectedStore = (key = KEY): Record<string, unknown> => ({
  [SERVER_KEYS.config]: { enabled: true, url: URL_BASE },
  [SERVER_KEYS.apiKey]: key,
});

async function serverDecide(body: Record<string, unknown>): Promise<{ action: string }> {
  const response = await fetch(`${URL_BASE}/v1/decide`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { action: string };
}

describe.skipIf(!enabled)("실제 서버와의 정책 동기화", () => {
  it("서버가 내려준 정책을 확장의 검사를 통과시켜 저장한다", async () => {
    const store = connectedStore();
    const status = await syncPolicy(deps(store), true);
    expect(status.state).toBe("ok");
    const policy = readStoredPolicy(store[SERVER_KEYS.policy]);
    expect(policy).not.toBeNull();
    expect(policy!.etag).toBeTruthy();
    expect(Object.keys(policy!.categoryActions).sort()).toEqual([...CATEGORY_IDS].sort());
  });

  it("두 번째는 ETag로 304를 받아 '최신'으로 처리한다", async () => {
    const store = connectedStore();
    await syncPolicy(deps(store, 1_000), true);
    const status = await syncPolicy(deps(store, 2_000), true);
    expect(status.state).toBe("unchanged");
    expect(readStoredPolicy(store[SERVER_KEYS.policy])!.fetchedAt).toBe(2_000);
  });

  it("틀린 키는 거절당하고, 이전 정책은 그대로이며, 상태에 키가 남지 않는다", async () => {
    const store = connectedStore();
    await syncPolicy(deps(store), true);
    const before = store[SERVER_KEYS.policy];
    const wrongKey = `${KEY.slice(0, -4)}XXXX`;
    store[SERVER_KEYS.apiKey] = wrongKey;
    const status = await syncPolicy(deps(store), true);
    expect(status.state).toBe("error");
    expect(status.message).toContain("API 키");
    expect(store[SERVER_KEYS.policy]).toEqual(before);
    expect(JSON.stringify(store[SERVER_KEYS.status])).not.toContain(wrongKey);
  });

  it("연결 시험(probe)은 맞는 키로 성공하고 틀린 키로 실패한다", async () => {
    expect((await probeServer(deps({}), URL_BASE, KEY)).state).toBe("ok");
    expect((await probeServer(deps({}), URL_BASE, `${KEY.slice(0, -4)}XXXX`)).state).toBe("error");
  });

  it("안 열린 주소는 오류로 처리한다(앱이 죽지 않는다)", async () => {
    const store: Record<string, unknown> = { ...connectedStore(), [SERVER_KEYS.config]: { enabled: true, url: "http://127.0.0.1:1" } };
    expect((await syncPolicy(deps(store), true)).state).toBe("error");
  });

  it("내려받은 정책으로 확장이 내리는 판정이 서버의 /v1/decide와 같다", async () => {
    installEngines();
    const store = connectedStore();
    await syncPolicy(deps(store), true);
    const options = toEngineOptions(readStoredPolicy(store[SERVER_KEYS.policy])!);

    const sets: string[][] = [[], ...CATEGORY_IDS.map((id) => [id]), ["email", "phone_number"], ["email", "api_key"], ["mystery"], ["phone_number", "mystery"]];
    for (const categories of sets) {
      const remote = await serverDecide({ detected_categories: categories, channel: "prompt" });
      expect(decideLocalAction(categories, options), `프롬프트 ${JSON.stringify(categories)}`).toBe(remote.action);
    }

    const policy = readStoredPolicy(store[SERVER_KEYS.policy])!;
    const files = [
      { status: "clean", categories: [], count: 0 },
      { status: "detected", categories: ["phone_number"], count: 3 },
      { status: "detected", categories: ["phone_number"], count: policy.bulkRecordThreshold },
      { status: "detected", categories: ["api_key"], count: 0 },
      { status: "encrypted", categories: [], count: 0 },
      { status: "uninspected", categories: [], count: 0 },
      { status: "too-large", categories: [], count: 0 },
      { status: "failed", categories: [], count: 0 },
    ] as const;
    for (const item of files) {
      const remote = await serverDecide({
        detected_categories: item.categories,
        channel: "file",
        file_status: item.status,
        record_count: item.count,
      });
      const local = decideFileAction(item.status, [...item.categories], item.count, {
        policy: options,
        bulkThreshold: policy.bulkRecordThreshold,
      });
      expect(local, `파일 ${item.status} ${JSON.stringify(item.categories)} x${item.count}`).toBe(remote.action);
    }
  });
});
