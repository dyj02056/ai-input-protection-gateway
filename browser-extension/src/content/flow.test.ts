// 입력 이벤트 → 안내 → 마스킹·실행 취소까지의 흐름을 jsdom에서 확인합니다.
// 실제 브라우저에서의 같은 흐름은 tools/dom_test.py(헤드리스 Chrome)가 다시 확인합니다.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeStub, type ChromeStub } from "../test/chromeStub.ts";
import {
  installEngines,
  noticeHost,
  noticePart,
  noticeTitle,
  openShadowRoots,
  removeEngines,
  resetContentState,
} from "../test/contentEnv.ts";
import { handleEditorEvent } from "./flow.ts";
import { readContentEditable } from "./editable.ts";
import type { Features } from "../shared/settings.ts";

const ALERT_TITLE = "형식 패턴 감지 — 전송 전 확인";
const PHONE = "010-0000-0000";

let restoreShadow: () => void;
let stub: ChromeStub;

beforeAll(() => {
  restoreShadow = openShadowRoots();
  document.addEventListener("input", handleEditorEvent, true);
  document.addEventListener("paste", handleEditorEvent, true);
});
afterAll(() => {
  restoreShadow();
  document.removeEventListener("input", handleEditorEvent, true);
  document.removeEventListener("paste", handleEditorEvent, true);
});

function setup(features: Partial<Features> = {}): void {
  stub = installChromeStub();
  installEngines();
  resetContentState(features);
}

beforeEach(() => setup());
afterEach(() => {
  vi.useRealTimers();
  removeEngines();
});

function makeEditable(html = ""): HTMLElement {
  const editor = document.createElement("div");
  editor.setAttribute("contenteditable", "true");
  editor.innerHTML = html;
  document.body.append(editor);
  return editor;
}

const fireInput = (target: Element) =>
  target.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));

function typeHtml(editor: HTMLElement, html: string): void {
  editor.innerHTML = html;
  fireInput(editor);
}

const click = (selector: string) => noticePart<HTMLButtonElement>(selector)!.click();

describe("입력 검사와 안내", () => {
  it("감지되면 감지 안내와 마스킹 버튼을 띄운다", () => {
    const editor = makeEditable();
    typeHtml(editor, `<p>전화 ${PHONE}</p>`);
    expect(noticeTitle()).toBe(ALERT_TITLE);
    expect(noticePart<HTMLButtonElement>(".mask-button")!.hidden).toBe(false);
    expect(noticePart(".message span")!.textContent).toContain("전화번호 형식");
  });

  it("감지가 없으면 검사 완료 안내를 띄우고 8초 뒤 닫는다", () => {
    vi.useFakeTimers();
    typeHtml(makeEditable(), "<p>평범한 문장</p>");
    expect(noticeTitle()).toBe("간단한 형식 검사 완료");
    vi.advanceTimersByTime(7999);
    expect(noticeHost()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(noticeHost()).toBeNull();
  });

  it("textarea·input도 검사한다", () => {
    const area = document.createElement("textarea");
    document.body.append(area);
    area.value = `메일 test.user@example.com`;
    fireInput(area);
    expect(noticeTitle()).toBe(ALERT_TITLE);
  });

  it("입력창이 아닌 곳의 이벤트는 무시한다", () => {
    const div = document.createElement("div");
    document.body.append(div);
    fireInput(div);
    expect(noticeHost()).toBeNull();
  });

  it("붙여넣기는 기본 동작이 끝난 뒤(다음 틱) 검사한다", () => {
    vi.useFakeTimers();
    const editor = makeEditable(`<p>${PHONE}</p>`);
    editor.dispatchEvent(new Event("paste", { bubbles: true }));
    expect(noticeHost()).toBeNull();
    vi.advanceTimersByTime(0);
    expect(noticeTitle()).toBe(ALERT_TITLE);
  });

  it("판정 이름만 배지용으로 알린다", () => {
    typeHtml(makeEditable(), `<p>${PHONE}</p>`);
    expect(stub.sendMessage).toHaveBeenLastCalledWith(
      { type: "gateway:action", action: "MASK" },
      expect.any(Function),
    );
    typeHtml(makeEditable(), "<p>키 sk-TESTTESTTESTTESTTEST</p>");
    expect(stub.sendMessage.mock.lastCall![0]).toEqual({ type: "gateway:action", action: "BLOCK" });
  });

  it("설정에서 끈 범주는 감지하지 않는다", () => {
    setup();
    // applySettings 대신 상태를 직접 지정한다.
    return import("./state.ts").then(({ state }) => {
      state.disabledCategories = ["phone_number"];
      typeHtml(makeEditable(), `<p>${PHONE}</p>`);
      expect(noticeTitle()).toBe("간단한 형식 검사 완료");
    });
  });

  it("검사기를 읽지 못하면 그 사실을 알린다 (보호된 것으로 오해하지 않도록)", () => {
    removeEngines();
    typeHtml(makeEditable(), `<p>${PHONE}</p>`);
    expect(noticeTitle()).toBe("로컬 검사기를 사용할 수 없습니다");
    expect(noticePart<HTMLButtonElement>(".mask-button")!.hidden).toBe(true);
  });

  it("감사 기록은 켠 경우에만 남기고 원문은 담지 않는다", async () => {
    setup({ auditLog: true });
    typeHtml(makeEditable(), `<p>전화 ${PHONE}</p>`);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const rows = stub.store.history as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(PHONE);
    expect(rows[0]!.categories).toEqual(["phone_number"]);
  });
});

describe("감지 안내의 지속과 닫기", () => {
  it("계속 표시가 켜져 있으면 20초가 지나도 남는다", () => {
    vi.useFakeTimers();
    typeHtml(makeEditable(), `<p>${PHONE}</p>`);
    vi.advanceTimersByTime(20_000);
    expect(noticeTitle()).toBe(ALERT_TITLE);
  });

  it("계속 표시를 끄면 8초 뒤 닫힌다", () => {
    vi.useFakeTimers();
    setup({ persistentAlert: false });
    typeHtml(makeEditable(), `<p>${PHONE}</p>`);
    vi.advanceTimersByTime(8000);
    expect(noticeHost()).toBeNull();
  });

  it("× 로 닫으면 같은 감지가 이어지는 동안 다시 띄우지 않는다", () => {
    const editor = makeEditable();
    typeHtml(editor, `<p>${PHONE}</p>`);
    click(".close-button");
    expect(noticeHost()).toBeNull();
    typeHtml(editor, `<p>${PHONE} 계속 입력</p>`);
    expect(noticeHost()).toBeNull();
  });

  it("감지가 사라졌다가 같은 값이 다시 들어오면 다시 안내한다", () => {
    const editor = makeEditable();
    typeHtml(editor, `<p>${PHONE}</p>`);
    click(".close-button");
    typeHtml(editor, "<p>지움</p>");
    typeHtml(editor, `<p>${PHONE}</p>`);
    expect(noticeTitle()).toBe(ALERT_TITLE);
  });

  it("값이 모두 없어지면 감지 안내를 자동으로 닫는다", () => {
    const editor = makeEditable();
    typeHtml(editor, `<p>${PHONE}</p>`);
    typeHtml(editor, "<p>깨끗함</p>");
    expect(noticeHost()).toBeNull();
  });

  it("자동 닫기를 끄면 검사 완료 안내로 바뀐다", () => {
    setup({ autoCloseWhenClean: false });
    const editor = makeEditable();
    typeHtml(editor, `<p>${PHONE}</p>`);
    typeHtml(editor, "<p>깨끗함</p>");
    expect(noticeTitle()).toBe("간단한 형식 검사 완료");
  });
});

describe("마스킹과 실행 취소", () => {
  it("마스킹 버튼은 일치한 구간만 바꾸고 결과 안내와 실행 취소 버튼을 보여준다", () => {
    const editor = makeEditable();
    typeHtml(editor, `<p>전화 ${PHONE}</p><p>그대로</p>`);
    click(".mask-button");
    expect(editor.innerHTML).toBe("<p>전화 [전화번호]</p><p>그대로</p>");
    expect(noticeTitle()).toBe("마스킹본을 입력란에 적용했습니다");
    expect(noticePart<HTMLButtonElement>(".undo-button")!.hidden).toBe(false);
    expect(noticePart<HTMLButtonElement>(".mask-button")!.hidden).toBe(true);
  });

  it("마스킹이 보낸 input 이벤트가 결과 안내를 덮어쓰지 않는다", () => {
    const editor = makeEditable();
    typeHtml(editor, `<p>${PHONE}</p>`);
    click(".mask-button");
    expect(noticeTitle()).toBe("마스킹본을 입력란에 적용했습니다");
  });

  it("실행 취소는 마스킹 직전 상태로 되돌리고 한 번만 쓸 수 있다", () => {
    const editor = makeEditable();
    const html = `<p>전화 ${PHONE}</p><p>그대로</p>`;
    typeHtml(editor, html);
    click(".mask-button");
    click(".undo-button");
    expect(editor.innerHTML).toBe(html);
    expect(readContentEditable(editor).text).toBe(`전화 ${PHONE}\n그대로\n`);
    // 되돌린 값이 다시 감지되므로 감지 안내로 돌아가고, 두 번째 실행 취소는 없다.
    expect(noticeTitle()).toBe(ALERT_TITLE);
    expect(noticePart<HTMLButtonElement>(".undo-button")!.hidden).toBe(true);
  });

  it("textarea도 마스킹하고 되돌린다", () => {
    const area = document.createElement("textarea");
    document.body.append(area);
    area.value = `번호 ${PHONE}`;
    fireInput(area);
    click(".mask-button");
    expect(area.value).toBe("번호 [전화번호]");
    click(".undo-button");
    expect(area.value).toBe(`번호 ${PHONE}`);
  });

  it("실행 취소 버튼을 끄면 보이지 않는다", () => {
    setup({ undoButton: false });
    const editor = makeEditable();
    typeHtml(editor, `<p>${PHONE}</p>`);
    click(".mask-button");
    expect(noticePart<HTMLButtonElement>(".undo-button")!.hidden).toBe(true);
  });

  it("입력창이 사라졌으면 마스킹을 시도하지 않고 알린다", () => {
    const editor = makeEditable();
    typeHtml(editor, `<p>${PHONE}</p>`);
    editor.remove();
    click(".mask-button");
    expect(noticeTitle()).toBe("마스킹할 입력창을 찾을 수 없습니다");
  });

  it("전각 숫자만 있으면 입력란을 바꾸지 않고 직접 수정하라고 알린다", () => {
    const editor = makeEditable();
    const html = "<p>전각 ０１０-００００-００００</p>";
    typeHtml(editor, html);
    click(".mask-button");
    expect(editor.innerHTML).toBe(html);
    expect(noticeTitle()).toBe("입력란을 바꾸지 않았습니다");
  });
});
