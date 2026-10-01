// 설정 화면의 조직 정책 서버 카드: 연결·권한 요청·시험·동기화·연결 끊기.
import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  parseServerPolicy,
  POLICY_PROBE_MESSAGE,
  POLICY_SYNC_MESSAGE,
  SERVER_KEYS,
  type SyncStatus,
} from "../shared/serverPolicy.ts";
import { installChromeStub, type ChromeStub } from "../test/chromeStub.ts";
import { OptionsApp } from "./OptionsApp.tsx";

// 형식 검사만 통과하는 가짜 키입니다(실제 키 아님).
const FAKE_KEY = ["fake", "key", "for", "options", "test"].join("-");
const ORIGIN = "http://127.0.0.1:8787";

const input = (id: string) => document.getElementById(id) as HTMLInputElement;
const button = (id: string) => document.getElementById(id) as HTMLButtonElement | null;
const text = () => document.getElementById("server-card")?.textContent ?? "";

const okStatus = (version = 1): SyncStatus => ({ state: "ok", message: `조직 정책 v${version}`, at: 1, version });
const policy = (version = 3) =>
  parseServerPolicy(
    {
      policy_id: "default",
      version,
      description: "기본 정책",
      category_actions: { email: "MASK", api_key: "BLOCK" },
      unknown_category_action: "REQUIRE_APPROVAL",
      bulk_record_threshold: 100,
    },
    1_700_000_000_000,
  );

let stub: ChromeStub;
let probeReply: SyncStatus | null;
let syncReply: SyncStatus | null;

async function renderOptions(initial: Record<string, unknown> = {}) {
  stub = installChromeStub(initial);
  probeReply = okStatus(3);
  syncReply = okStatus(3);
  // 백그라운드의 응답을 흉내 냅니다.
  stub.sendMessage.mockImplementation((message: unknown, callback?: (response: unknown) => void) => {
    const type = (message as { type?: string }).type;
    if (type === POLICY_PROBE_MESSAGE) callback?.(probeReply);
    else if (type === POLICY_SYNC_MESSAGE) callback?.(syncReply);
    else callback?.(undefined);
  });
  render(<OptionsApp />);
  await waitFor(() => expect(input("server-url")).not.toBeNull());
  return stub;
}

const fill = (url: string, key: string) => {
  fireEvent.change(input("server-url"), { target: { value: url } });
  fireEvent.change(input("server-key"), { target: { value: key } });
};

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("기본 상태", () => {
  it("연결 안 됨으로 보이고, 요청은 아무것도 보내지 않으며, 입력 내용을 보내지 않는다는 설명이 있다", async () => {
    await renderOptions();
    expect(text()).toContain("연결 안 됨");
    expect(text()).toContain("보내지 않습니다");
    expect(button("server-connect")).not.toBeNull();
    expect(button("server-sync")).toBeNull();
    expect(button("server-disconnect")).toBeNull();
    expect(stub.sendMessage).not.toHaveBeenCalled();
    expect(stub.permissionsRequest).not.toHaveBeenCalled();
    expect(input("server-key").type).toBe("password");
  });
});

describe("연결", () => {
  it("권한을 요청하고 시험에 성공하면 설정과 키를 저장한 뒤 동기화한다", async () => {
    await renderOptions();
    fill(ORIGIN, FAKE_KEY);
    fireEvent.click(button("server-connect")!);
    await waitFor(() => expect(stub.store[SERVER_KEYS.config]).toEqual({ enabled: true, url: ORIGIN }));

    expect(stub.permissionsRequest).toHaveBeenCalledWith({ origins: [`${ORIGIN}/*`] });
    expect(stub.store[SERVER_KEYS.apiKey]).toBe(FAKE_KEY);
    const types = stub.sendMessage.mock.calls.map(([message]) => (message as { type: string }).type);
    expect(types).toEqual([POLICY_PROBE_MESSAGE, POLICY_SYNC_MESSAGE]);
    const probe = stub.sendMessage.mock.calls[0]![0] as { url: string; key: string };
    expect(probe).toMatchObject({ url: ORIGIN, key: FAKE_KEY });
    // 입력한 키는 화면에서 지워진다
    await waitFor(() => expect(input("server-key").value).toBe(""));
  });

  it("주소가 https가 아니면(원격 http) 권한을 묻지 않고 거절한다", async () => {
    await renderOptions();
    fill("http://pdp.example.com", FAKE_KEY);
    fireEvent.click(button("server-connect")!);
    await waitFor(() => expect(document.getElementById("server-message")?.textContent).toContain("https"));
    expect(stub.permissionsRequest).not.toHaveBeenCalled();
    expect(stub.store[SERVER_KEYS.config]).toBeUndefined();
  });

  it("키 형식이 틀리거나 비어 있으면 거절한다", async () => {
    await renderOptions();
    fill(ORIGIN, "short");
    fireEvent.click(button("server-connect")!);
    await waitFor(() => expect(document.getElementById("server-message")?.textContent).toContain("API 키"));
    fill(ORIGIN, "");
    fireEvent.click(button("server-connect")!);
    await waitFor(() => expect(document.getElementById("server-message")?.textContent).toContain("입력"));
    expect(stub.permissionsRequest).not.toHaveBeenCalled();
    expect(stub.store[SERVER_KEYS.apiKey]).toBeUndefined();
  });

  it("사용자가 서버 접근을 허용하지 않으면 아무것도 저장하지 않는다", async () => {
    await renderOptions();
    stub.permissionsRequest.mockResolvedValueOnce(false);
    fill(ORIGIN, FAKE_KEY);
    fireEvent.click(button("server-connect")!);
    await waitFor(() => expect(document.getElementById("server-message")?.textContent).toContain("허용하지 않아"));
    expect(stub.store[SERVER_KEYS.config]).toBeUndefined();
    expect(stub.store[SERVER_KEYS.apiKey]).toBeUndefined();
    expect(stub.sendMessage).not.toHaveBeenCalled();
  });

  it("시험에 실패하면(키 오류 등) 저장하지 않는다", async () => {
    await renderOptions();
    fill(ORIGIN, FAKE_KEY);
    probeReply = { state: "error", message: "API 키가 올바르지 않습니다.", at: 1 };
    fireEvent.click(button("server-connect")!);
    await waitFor(() => expect(document.getElementById("server-message")?.textContent).toContain("API 키가 올바르지"));
    expect(stub.store[SERVER_KEYS.config]).toBeUndefined();
    expect(stub.store[SERVER_KEYS.apiKey]).toBeUndefined();
  });

  it("백그라운드 응답이 없어도 저장하지 않는다", async () => {
    await renderOptions();
    fill(ORIGIN, FAKE_KEY);
    probeReply = null;
    fireEvent.click(button("server-connect")!);
    await waitFor(() => expect(document.getElementById("server-message")?.textContent).toContain("응답이 없습니다"));
    expect(stub.store[SERVER_KEYS.config]).toBeUndefined();
  });
});

describe("연결된 상태", () => {
  const connected = {
    [SERVER_KEYS.config]: { enabled: true, url: ORIGIN },
    [SERVER_KEYS.apiKey]: FAKE_KEY,
    [SERVER_KEYS.policy]: policy(3),
    [SERVER_KEYS.status]: okStatus(3),
  };

  it("적용 중인 정책의 이름·버전·범주별 조치를 보여 주고, 저장된 키는 화면에 채우지 않는다", async () => {
    await renderOptions(connected);
    await waitFor(() => expect(text()).toContain("연결됨"));
    expect(text()).toContain("default v3");
    expect(text()).toContain("기본 정책");
    expect(text()).toContain("이메일: 마스킹");
    expect(text()).toContain("API 키: 차단 판정");
    expect(text()).toContain("저장됨");
    expect(input("server-key").value).toBe("");
    expect(document.body.innerHTML).not.toContain(FAKE_KEY);
    expect(input("server-url").value).toBe(ORIGIN);
  });

  it("'지금 동기화'는 강제 동기화를 요청한다", async () => {
    await renderOptions(connected);
    await waitFor(() => expect(button("server-sync")).not.toBeNull());
    syncReply = { state: "unchanged", message: "정책이 최신입니다.", at: 2, version: 3 };
    fireEvent.click(button("server-sync")!);
    await waitFor(() => expect(document.getElementById("server-message")?.textContent).toContain("최신"));
    expect(stub.sendMessage.mock.calls.at(-1)![0]).toEqual({ type: POLICY_SYNC_MESSAGE, force: true });
  });

  it("키를 비워 두고 다시 연결하면 저장된 키로 시험한다", async () => {
    await renderOptions(connected);
    await waitFor(() => expect(button("server-connect")).not.toBeNull());
    fireEvent.change(input("server-url"), { target: { value: "http://localhost:9000" } });
    fireEvent.click(button("server-connect")!);
    await waitFor(() => expect(stub.store[SERVER_KEYS.config]).toEqual({ enabled: true, url: "http://localhost:9000" }));
    const probe = stub.sendMessage.mock.calls[0]![0] as { key: string };
    expect(probe.key).toBe(FAKE_KEY);
    expect(stub.store[SERVER_KEYS.apiKey]).toBe(FAKE_KEY);
  });

  it("연결을 끊으면 키·정책·상태·설정을 지우고 권한을 돌려준다", async () => {
    await renderOptions(connected);
    await waitFor(() => expect(button("server-disconnect")).not.toBeNull());
    fireEvent.click(button("server-disconnect")!);
    await waitFor(() => expect(stub.store[SERVER_KEYS.apiKey]).toBeUndefined());
    for (const key of Object.values(SERVER_KEYS)) expect(stub.store[key]).toBeUndefined();
    expect(stub.permissionsRemove).toHaveBeenCalledWith({ origins: [`${ORIGIN}/*`] });
    await waitFor(() => expect(text()).toContain("연결 안 됨"));
  });

  it("백그라운드가 새 정책을 저장하면 화면이 따라간다", async () => {
    await renderOptions(connected);
    await waitFor(() => expect(text()).toContain("default v3"));
    stub.emitChange(SERVER_KEYS.policy, policy(4));
    await waitFor(() => expect(text()).toContain("default v4"));
  });

  it("마지막 동기화가 실패했으면 그 사유를 보여 준다", async () => {
    await renderOptions({
      ...connected,
      [SERVER_KEYS.status]: { state: "error", message: "서버에 연결하지 못했습니다. 이전 정책(v3)을 계속 사용합니다.", at: 5 },
    });
    await waitFor(() => expect(text()).toContain("이전 정책(v3)을 계속 사용"));
  });
});
