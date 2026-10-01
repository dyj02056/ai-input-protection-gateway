// 세션 토큰 방식: 입력창 마스킹 → AI 답변 화면에서 원래 값으로 복원까지의 흐름을 jsdom에서 확인합니다.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { detector } from "../engine/detector.ts";
import { installChromeStub } from "../test/chromeStub.ts";
import {
  installEngines,
  noticePart,
  noticeTitle,
  openShadowRoots,
  removeEngines,
  resetContentState,
} from "../test/contentEnv.ts";
import { handleEditorEvent } from "./flow.ts";
import { maskContentEditable, maskPlainValue, restoreTextNodes } from "./masking.ts";
import { stopRestoring } from "./restore.ts";
import { applySettings, state } from "./state.ts";
import { vault } from "./tokens.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
let restoreShadow: () => void;

beforeAll(() => {
  restoreShadow = openShadowRoots();
  document.addEventListener("input", handleEditorEvent, true);
});
afterAll(() => {
  restoreShadow();
  document.removeEventListener("input", handleEditorEvent, true);
});
beforeEach(() => {
  installChromeStub();
  installEngines();
  resetContentState();
  vault.clear();
});
afterEach(() => {
  stopRestoring();
  vault.clear();
  removeEngines();
  vi.useRealTimers();
});

function editor(html: string): HTMLElement {
  const element = document.createElement("div");
  element.setAttribute("contenteditable", "true");
  element.innerHTML = html;
  document.body.append(element);
  return element;
}

const useTokens = () => applySettings({ maskStyle: "token" });
const description = () => noticePart(".message span")?.textContent ?? "";

describe("토큰 방식 마스킹 (contenteditable)", () => {
  beforeEach(useTokens);

  it("값을 [전화_1] 같은 토큰으로 바꾸고, 같은 값은 같은 토큰으로 바꾼다", () => {
    const target = editor("<p>내 번호 010-1234-5678, 다시 010-1234-5678, 메일 kim@example.com</p>");
    const result = maskContentEditable(target, detector);
    expect(result.outcome).toBe("applied");
    expect(target.querySelector("p")!.textContent).toBe("내 번호 [전화_1], 다시 [전화_1], 메일 [메일_1]");
    expect(result.outcome === "applied" && result.tokens).toBe(true);
  });

  it("두 번째 마스킹에서 다른 값은 새 번호를 받고, 이미 나온 값은 같은 번호를 쓴다", () => {
    maskContentEditable(editor("<p>010-1111-1111</p>"), detector);
    const second = editor("<p>010-2222-2222 / 010-1111-1111</p>");
    maskContentEditable(second, detector);
    expect(second.querySelector("p")!.textContent).toBe("[전화_2] / [전화_1]");
  });

  it("문단 구조를 그대로 두고, 실행 취소로 원래 글자로 돌아간다", () => {
    const html = "<p>번호 010-1234-5678</p><p>그대로</p>";
    const target = editor(html);
    const result = maskContentEditable(target, detector);
    expect(target.querySelectorAll("p")).toHaveLength(2);
    expect(target.innerHTML).toBe("<p>번호 [전화_1]</p><p>그대로</p>");
    if (result.outcome !== "applied" || result.undo.kind !== "nodes") throw new Error("적용되지 않음");
    restoreTextNodes(result.undo.stack);
    expect(target.innerHTML).toBe(html);
  });

  it("카드번호·비밀번호도 토큰이 된다 (비밀번호는 값만)", () => {
    const target = editor("<p>카드 4111 1111 1111 1111 비밀번호: abc12345</p>");
    maskContentEditable(target, detector);
    expect(target.querySelector("p")!.textContent).toBe("카드 [카드_1] 비밀번호: [비번_1]");
  });

  it("자리표시자 방식에서는 토큰을 만들지 않는다", () => {
    applySettings({ maskStyle: "placeholder" });
    const target = editor("<p>010-1234-5678</p>");
    const result = maskContentEditable(target, detector);
    expect(target.querySelector("p")!.textContent).toBe("[전화번호]");
    expect(result.outcome === "applied" && result.tokens).toBe(false);
    expect(vault.size).toBe(0);
  });
});

describe("토큰 방식 마스킹 (input·textarea)", () => {
  beforeEach(useTokens);

  it("textarea 값도 토큰으로 바꾸고 이전 값을 실행 취소 정보로 돌려준다", () => {
    const area = document.createElement("textarea");
    area.value = "번호 010-1234-5678 / 메일 kim@example.com";
    document.body.append(area);
    const result = maskPlainValue(area, detector);
    expect(area.value).toBe("번호 [전화_1] / 메일 [메일_1]");
    if (result.outcome === "applied" && result.undo.kind === "plain") {
      expect(result.tokens).toBe(true);
      expect(result.undo.previous).toBe("번호 010-1234-5678 / 메일 kim@example.com");
    } else {
      throw new Error("적용되지 않음");
    }
  });

  it("원문에서 위치를 못 찾은 전각 변형은 자리표시자로 가린다 (토큰으로 되돌릴 수 없는 경우)", () => {
    const input = document.createElement("input");
    input.value = "０１０-１２３４-５６７８";
    document.body.append(input);
    const result = maskPlainValue(input, detector);
    expect(input.value).toBe("[전화번호]");
    expect(result.outcome === "applied" && result.tokens).toBe(false);
  });
});

describe("마스킹 버튼 → 답변 화면 복원", () => {
  function typeAndMask(html: string): HTMLElement {
    const target = editor(html);
    target.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
    noticePart<HTMLButtonElement>(".mask-button")!.click();
    return target;
  }

  beforeEach(useTokens);

  it("마스킹하면 입력창에는 토큰이 들어가고 안내가 복원 방식을 알려준다", () => {
    const target = typeAndMask("<p>연락처 010-1234-5678</p>");
    expect(target.querySelector("p")!.textContent).toBe("연락처 [전화_1]");
    expect(noticeTitle()).toBe("마스킹본을 입력란에 적용했습니다");
    expect(description()).toContain("세션 토큰");
    expect(description()).toContain("이 탭의 화면에서만 원래 값으로 보여줍니다");
    expect(description()).toContain("새로고침하면 복원 정보가 사라집니다");
  });

  it("AI 답변에 나온 토큰은 원래 값으로 보이고, 입력창과 내 말풍선은 그대로다", async () => {
    const target = typeAndMask("<p>연락처 010-1234-5678</p>");
    const chat = document.createElement("div");
    chat.innerHTML =
      '<div data-message-author-role="user">연락처 [전화_1]</div>' +
      '<div data-message-author-role="assistant"><p>[전화_1]님께 연락드리겠습니다.</p></div>';
    document.body.append(chat);
    await tick();

    expect(chat.querySelector('[data-message-author-role="assistant"]')!.textContent).toBe(
      "010-1234-5678님께 연락드리겠습니다.",
    );
    expect(chat.querySelector('[data-message-author-role="user"]')!.textContent).toBe("연락처 [전화_1]");
    expect(target.querySelector("p")!.textContent).toBe("연락처 [전화_1]");
  });

  it("답변이 한 글자씩 스트리밍돼도 마지막에는 원래 값으로 보인다", async () => {
    typeAndMask("<p>010-1234-5678</p>");
    const answer = document.createElement("div");
    const text = document.createTextNode("");
    answer.append(text);
    document.body.append(answer);
    for (const chunk of ["안녕하세요 ", "[전", "화_", "1", "] 님"]) {
      text.data += chunk;
      await tick();
    }
    expect(text.data).toBe("안녕하세요 010-1234-5678 님");
  });

  it("복원 표시를 끄면 안내가 그렇게 알리고, 답변의 토큰은 그대로 보인다", async () => {
    applySettings({ features: { restoreTokens: false } });
    typeAndMask("<p>010-1234-5678</p>");
    expect(description()).toContain("복원 표시가 꺼져 있어");
    const answer = document.createElement("p");
    answer.textContent = "[전화_1] 입니다";
    document.body.append(answer);
    await tick();
    expect(answer.textContent).toBe("[전화_1] 입니다");
  });

  it("자리표시자 방식에서는 복원을 시작하지 않는다", async () => {
    applySettings({ maskStyle: "placeholder" });
    typeAndMask("<p>010-1234-5678</p>");
    expect(description()).not.toContain("세션 토큰");
    const answer = document.createElement("p");
    answer.textContent = "[전화_1]";
    document.body.append(answer);
    await tick();
    expect(answer.textContent).toBe("[전화_1]");
  });

  it("복원 정보는 메모리에만 있다: 저장소와 전송 어디에도 원래 값을 쓰지 않는다", async () => {
    const stub = installChromeStub();
    applySettings({ maskStyle: "token" });
    typeAndMask("<p>010-1234-5678</p>");
    await tick();
    expect(JSON.stringify(stub.store)).not.toContain("010-1234-5678");
    expect(JSON.stringify(stub.sendMessage.mock.calls)).not.toContain("010-1234-5678");
    expect(state.maskStyle).toBe("token");
  });

  it("실행 취소하면 입력창은 원래 글자로 돌아간다", () => {
    const target = typeAndMask("<p>연락처 010-1234-5678</p>");
    noticePart<HTMLButtonElement>(".undo-button")!.click();
    expect(target.querySelector("p")!.textContent).toBe("연락처 010-1234-5678");
  });
});
