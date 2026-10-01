// 전송 차단은 기본 꺼짐이고, 켜도 첫 시도만 막으며 5초 안에 다시 누르면 통과시킵니다.
// 클릭 한 번이 click과 submit 두 경로를 타는 점까지 jsdom에서 확인합니다.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { policy } from "../engine/policy.ts";
import { installChromeStub } from "../test/chromeStub.ts";
import {
  installEngines,
  noticeHost,
  noticeTitle,
  openShadowRoots,
  removeEngines,
  resetContentState,
} from "../test/contentEnv.ts";
import type { Features } from "../shared/settings.ts";
import { handleEditorEvent } from "./flow.ts";
import { installSendGuard } from "./sendGuard.ts";

const BLOCK_TITLE = "전송을 막았습니다 — 형식 패턴 감지";
const APPROVAL_TITLE = "확인이 필요합니다 — 승인 검토 대상";
const API_KEY = "sk-TESTTESTTESTTESTTEST";

let restoreShadow: () => void;
beforeAll(() => {
  restoreShadow = openShadowRoots();
  document.addEventListener("input", handleEditorEvent, true);
  installSendGuard();
});
afterAll(() => {
  restoreShadow();
  document.removeEventListener("input", handleEditorEvent, true);
});

interface Page {
  form: HTMLFormElement;
  area: HTMLTextAreaElement;
  send: HTMLButtonElement;
  // 폼 제출이 막히지 않고 끝까지 도달한 횟수입니다. (우리 리스너가 막으면 도달하지 못합니다.)
  submitted: () => number;
}

function buildPage(value = `키 ${API_KEY}`): Page {
  document.body.innerHTML =
    '<form id="f"><textarea id="t"></textarea><button id="s" type="submit">보내기</button></form>';
  const form = document.getElementById("f") as HTMLFormElement;
  const area = document.getElementById("t") as HTMLTextAreaElement;
  const send = document.getElementById("s") as HTMLButtonElement;
  let count = 0;
  // 버블 단계 리스너: 캡처 단계에서 stopPropagation 되면 여기까지 오지 않습니다.
  form.addEventListener("submit", (event) => {
    count += 1;
    event.preventDefault(); // jsdom이 실제 제출을 시도하지 않게 합니다.
  });
  area.value = value;
  area.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
  return { form, area, send, submitted: () => count };
}

function pressEnter(target: Element, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function setup(features: Partial<Features> = {}): void {
  installChromeStub();
  installEngines();
  resetContentState(features);
}

const BLOCKING: Partial<Features> = { enforcePolicy: true, blockSend: true };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  removeEngines();
});

describe("기본값에서는 아무것도 막지 않는다", () => {
  it("전송 차단이 꺼져 있으면 Enter·클릭·제출이 그대로 통과한다", () => {
    setup();
    const page = buildPage();
    expect(pressEnter(page.area).defaultPrevented).toBe(false);
    page.send.click();
    expect(page.submitted()).toBe(1);
  });

  it("로컬 정책을 켜지 않으면 전송 차단을 켜도 동작하지 않는다", () => {
    setup({ enforcePolicy: false, blockSend: true });
    const page = buildPage();
    expect(pressEnter(page.area).defaultPrevented).toBe(false);
  });
});

describe("전송 차단 (BLOCK)", () => {
  beforeEach(() => setup(BLOCKING));

  it("첫 Enter는 막고 안내한다", () => {
    const page = buildPage();
    const event = pressEnter(page.area);
    expect(event.defaultPrevented).toBe(true);
    expect(noticeTitle()).toBe(BLOCK_TITLE);
    expect(noticeHost()).not.toBeNull();
  });

  it("5초 안에 다시 누르면 통과시키고, 5초가 지나면 다시 막는다", () => {
    const page = buildPage();
    expect(pressEnter(page.area).defaultPrevented).toBe(true);

    vi.setSystemTime(Date.now() + 4999);
    expect(pressEnter(page.area).defaultPrevented).toBe(false);

    // 허용한 뒤에는 처음부터 다시 센다.
    expect(pressEnter(page.area).defaultPrevented).toBe(true);
    vi.setSystemTime(Date.now() + 5000);
    expect(pressEnter(page.area).defaultPrevented).toBe(true);
  });

  it("Shift+Enter(줄바꿈)와 한글 조합 중 Enter는 막지 않는다", () => {
    const page = buildPage();
    expect(pressEnter(page.area, { shiftKey: true }).defaultPrevented).toBe(false);
    expect(pressEnter(page.area, { isComposing: true }).defaultPrevented).toBe(false);
  });

  it("보내기 버튼 클릭: 첫 클릭은 막고, 5초 안의 두 번째 클릭은 제출까지 통과한다", () => {
    const page = buildPage();
    page.send.click();
    expect(page.submitted()).toBe(0);
    expect(noticeTitle()).toBe(BLOCK_TITLE);

    page.send.click();
    // 클릭 한 번이 click과 submit 두 경로를 타므로, 허용한 직후의 제출까지 통과해야 한다.
    expect(page.submitted()).toBe(1);
  });

  it("허용한 뒤의 제출 허용은 같은 작업 묶음에서만 유효하다", () => {
    const page = buildPage();
    page.send.click();
    page.send.click();
    expect(page.submitted()).toBe(1);

    // 다음 작업 묶음에서는 허용이 풀려 다시 막힌다.
    vi.advanceTimersByTime(0);
    page.send.click();
    expect(page.submitted()).toBe(1);
  });

  it("폼 제출(submit)만 일어나도 막는다", () => {
    const page = buildPage();
    page.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(page.submitted()).toBe(0);
    expect(noticeTitle()).toBe(BLOCK_TITLE);
  });

  it("전송 버튼이 아닌 클릭은 막지 않는다", () => {
    const page = buildPage();
    document.body.insertAdjacentHTML("beforeend", '<button id="x" type="button">취소</button>');
    const other = document.getElementById("x")!;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    other.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(page.submitted()).toBe(0);
    // 입력 검사의 감지 안내는 떠 있지만, 전송을 막았다는 안내는 아니다.
    expect(noticeTitle()).not.toBe(BLOCK_TITLE);
  });

  it("폼 밖 버튼은 라벨이 전송을 뜻할 때만 전송으로 본다", () => {
    buildPage();
    document.body.insertAdjacentHTML(
      "beforeend",
      '<button id="a" type="button" aria-label="Send message">▶</button><button id="b" type="button">설정</button>',
    );
    const click = (id: string) => {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      document.getElementById(id)!.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(click("b")).toBe(false);
    expect(click("a")).toBe(true);
  });

  it("감지가 없으면 막지 않는다", () => {
    const page = buildPage("평범한 문장");
    expect(pressEnter(page.area).defaultPrevented).toBe(false);
  });

  it("MASK 판정(전화번호)은 BLOCK이 아니므로 막지 않는다", () => {
    const page = buildPage("전화 010-0000-0000");
    expect(pressEnter(page.area).defaultPrevented).toBe(false);
  });
});

describe("승인 확인 단계 (REQUIRE_APPROVAL)", () => {
  // 탐지기가 내는 범주는 모두 등록돼 있어 승인 대상이 나오지 않으므로, 정책 엔진만 바꿔 끼웁니다.
  const approval = { ...policy, decide: () => ({ action: "REQUIRE_APPROVAL", reasonCodes: [] }) };

  beforeEach(() => {
    (globalThis as Record<string, unknown>).AIInputGatewayPolicy = approval;
  });

  it("승인 확인만 켜도(전송 차단 없이) 동작한다 — 두 스위치는 독립이다", () => {
    setup({ enforcePolicy: true, requireConfirm: true, blockSend: false });
    (globalThis as Record<string, unknown>).AIInputGatewayPolicy = approval;
    const page = buildPage();
    expect(pressEnter(page.area).defaultPrevented).toBe(true);
    expect(noticeTitle()).toBe(APPROVAL_TITLE);
    expect(pressEnter(page.area).defaultPrevented).toBe(false);
  });

  it("전송 차단만 켜면 승인 대상은 막지 않는다", () => {
    setup({ enforcePolicy: true, requireConfirm: false, blockSend: true });
    (globalThis as Record<string, unknown>).AIInputGatewayPolicy = approval;
    const page = buildPage();
    expect(pressEnter(page.area).defaultPrevented).toBe(false);
  });
});

describe("안내창과의 상호작용", () => {
  it("우리 안내창에서 시작한 클릭은 전송으로 보지 않는다", () => {
    setup(BLOCKING);
    const page = buildPage();
    pressEnter(page.area);
    const host = noticeHost()!;
    const close = host.shadowRoot!.querySelector<HTMLButtonElement>(".close-button")!;
    const before = page.submitted();
    close.click();
    expect(page.submitted()).toBe(before);
    // 닫기만 동작하고 전송 차단 안내가 새로 뜨지 않는다.
    expect(noticeHost()).toBeNull();
  });
});
