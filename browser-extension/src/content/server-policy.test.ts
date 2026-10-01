// 조직 서버 정책이 콘텐츠 스크립트의 입력 → 안내 → 전송 차단 흐름에 실제로 반영되는지 확인합니다.
// (정책 내려받기 자체는 background/policySync.test.ts, 설정 화면은 options/OptionsApp.server.test.tsx)
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POLICY_SYNC_MESSAGE, SERVER_KEYS, parseServerPolicy } from "../shared/serverPolicy.ts";
import { installChromeStub, type ChromeStub } from "../test/chromeStub.ts";
import {
  installEngines,
  noticePart,
  noticeTitle,
  openShadowRoots,
  removeEngines,
  resetContentState,
} from "../test/contentEnv.ts";
import type { Features } from "../shared/settings.ts";
import { handleEditorEvent } from "./flow.ts";
import { installSendGuard } from "./sendGuard.ts";
import { state, watchSettings } from "./state.ts";

const ALERT_TITLE = "형식 패턴 감지 — 전송 전 확인";
const BLOCK_TITLE = "전송을 막았습니다 — 형식 패턴 감지";

const orgPolicy = (version = 7) =>
  parseServerPolicy(
    {
      policy_id: "strict-demo",
      version,
      description: "",
      category_actions: { email: "BLOCK", phone_number: "ALLOW" },
      unknown_category_action: "BLOCK",
      bulk_record_threshold: 50,
    },
    1,
  );

let restoreShadow: () => void;
let stub: ChromeStub;

beforeAll(() => {
  restoreShadow = openShadowRoots();
  document.addEventListener("input", handleEditorEvent, true);
  installSendGuard();
});
afterAll(() => {
  restoreShadow();
  document.removeEventListener("input", handleEditorEvent, true);
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  removeEngines();
  document.body.innerHTML = "";
});

function setup(initial: Record<string, unknown> = {}, features: Partial<Features> = {}): void {
  stub = installChromeStub(initial);
  installEngines();
  resetContentState(features);
}

const flush = async () => {
  await vi.advanceTimersByTimeAsync(0);
};

const description = () => noticePart(".message span")?.textContent ?? "";

function typeEmail(): HTMLTextAreaElement {
  document.body.innerHTML = '<form id="f"><textarea id="t"></textarea><button id="s" type="submit">보내기</button></form>';
  const form = document.getElementById("f") as HTMLFormElement;
  form.addEventListener("submit", (event) => event.preventDefault());
  const area = document.getElementById("t") as HTMLTextAreaElement;
  area.value = "메일은 test.user@example.com 입니다";
  area.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
  return area;
}

describe("정책 읽기와 갱신", () => {
  it("저장된 조직 정책을 읽어 적용하고, 로드할 때 백그라운드에 동기화를 요청한다", async () => {
    setup({ [SERVER_KEYS.policy]: orgPolicy(7) });
    watchSettings(() => {});
    await flush();
    expect(state.serverPolicy?.version).toBe(7);
    expect(stub.sendMessage.mock.calls.some(([message]) => (message as { type?: string }).type === POLICY_SYNC_MESSAGE)).toBe(true);
  });

  it("정책이 없으면(연동 안 함) 내장 정책을 쓴다. 동기화 요청은 보내도 서버 호출은 백그라운드가 판단한다", async () => {
    setup();
    watchSettings(() => {});
    await flush();
    expect(state.serverPolicy).toBeNull();
  });

  it("저장소의 정책이 바뀌면 바로 반영하고, 지워지면 내장 정책으로 돌아간다", async () => {
    setup();
    watchSettings(() => {});
    await flush();
    stub.emitChange(SERVER_KEYS.policy, orgPolicy(8));
    expect(state.serverPolicy?.version).toBe(8);
    stub.emitChange(SERVER_KEYS.policy, undefined);
    expect(state.serverPolicy).toBeNull();
  });

  it("망가진 값이 저장돼 있어도 적용하지 않는다", async () => {
    setup({ [SERVER_KEYS.policy]: { ...orgPolicy(), categoryActions: { email: "DELETE" } } });
    watchSettings(() => {});
    await flush();
    expect(state.serverPolicy).toBeNull();
  });

  it("무관한 설정이 바뀌어도 정책은 그대로다", async () => {
    setup({ [SERVER_KEYS.policy]: orgPolicy(7) });
    watchSettings(() => {});
    await flush();
    stub.emitChange("allowlist", ["02-123-4567"]);
    expect(state.serverPolicy?.version).toBe(7);
  });

  it("확장이 새로 고쳐져 메시지를 보낼 수 없어도 오류 없이 계속 동작한다", async () => {
    setup({ [SERVER_KEYS.policy]: orgPolicy(7) });
    stub.sendMessage.mockImplementation(() => {
      throw new Error("Extension context invalidated.");
    });
    expect(() => watchSettings(() => {})).not.toThrow();
    await flush();
    expect(state.serverPolicy?.version).toBe(7);
  });
});

describe("안내와 전송 차단에 조직 정책이 쓰인다", () => {
  it("내장 정책에서 이메일은 마스킹 안내(MASK)이고 이름은 '로컬 정책'이다", () => {
    setup();
    typeEmail();
    expect(noticeTitle()).toBe(ALERT_TITLE);
    expect(description()).toContain("로컬 정책 판정이 MASK");
    expect(stub.sendMessage.mock.lastCall![0]).toEqual({ type: "gateway:action", action: "MASK" });
  });

  it("조직 정책이 이메일을 BLOCK으로 정했으면 BLOCK 안내이고 정책 버전을 보여 준다", () => {
    setup();
    state.serverPolicy = orgPolicy(7);
    typeEmail();
    expect(description()).toContain("조직 정책(v7) 판정이 BLOCK");
    expect(description()).not.toContain("로컬 정책");
    expect(stub.sendMessage.mock.lastCall![0]).toEqual({ type: "gateway:action", action: "BLOCK" });
  });

  it("전송 차단을 켠 상태에서, 내장 정책이면 통과하고 조직 정책이 BLOCK이면 첫 시도를 막는다", () => {
    setup({}, { enforcePolicy: true, blockSend: true });
    const free = typeEmail();
    const enter = (target: Element) => {
      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event;
    };
    expect(enter(free).defaultPrevented).toBe(false); // 이메일은 내장 정책에서 MASK라 막지 않는다

    state.serverPolicy = orgPolicy(7);
    const blocked = typeEmail();
    expect(enter(blocked).defaultPrevented).toBe(true);
    expect(noticeTitle()).toBe(BLOCK_TITLE);
  });

  it("조직 정책이 전화번호를 ALLOW로 정했으면 전송을 막지 않는다", () => {
    setup({}, { enforcePolicy: true, blockSend: true, requireConfirm: true });
    state.serverPolicy = orgPolicy(7);
    document.body.innerHTML = '<form id="f"><textarea id="t"></textarea><button id="s" type="submit">보내기</button></form>';
    const area = document.getElementById("t") as HTMLTextAreaElement;
    area.value = "연락처 010-1234-5678";
    area.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    area.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
