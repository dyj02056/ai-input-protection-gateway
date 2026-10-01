// 화면의 토큰을 원래 값으로 바꿔 보여주는 복원기를 jsdom에서 확인합니다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetContentState } from "../test/contentEnv.ts";
import { isRestoring, startRestoring, stopRestoring } from "./restore.ts";
import { vault } from "./tokens.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const PHONE = "010-1234-5678";

beforeEach(() => {
  resetContentState();
  vault.clear();
  vault.tokenFor("phone_number", PHONE); // [전화_1]
  vault.tokenFor("email", "kim@example.com"); // [메일_1]
});
afterEach(() => {
  stopRestoring();
  vault.clear();
  vi.restoreAllMocks();
});

function add(html: string): HTMLElement {
  const holder = document.createElement("div");
  holder.innerHTML = html;
  document.body.append(holder);
  return holder;
}

describe("이미 화면에 있는 토큰", () => {
  it("시작할 때 한 번 훑어서 원래 값으로 바꾼다", () => {
    const holder = add("<p>연락처는 [전화_1] 입니다</p>");
    startRestoring();
    expect(holder.textContent).toBe(`연락처는 ${PHONE} 입니다`);
  });

  it("글자만 바꾸고 노드는 그대로 둔다 (React 같은 프레임워크가 만든 노드를 갈아 끼우지 않는다)", () => {
    const holder = add("<p>[전화_1]</p>");
    const paragraph = holder.querySelector("p")!;
    const textNode = paragraph.firstChild!;
    startRestoring();
    expect(paragraph.firstChild).toBe(textNode);
    expect(paragraph.childNodes).toHaveLength(1);
    expect(textNode.nodeValue).toBe(PHONE);
  });
});

describe("나중에 나타나는 토큰 (답변이 화면에 그려질 때)", () => {
  it("새로 붙은 요소의 토큰을 되돌린다", async () => {
    startRestoring();
    const holder = add("<p>답변: [메일_1] 로 보내세요</p>");
    await tick();
    expect(holder.textContent).toBe("답변: kim@example.com 로 보내세요");
  });

  it("스트리밍처럼 같은 글자 노드가 조금씩 늘어나도, 완성된 토큰이 되면 되돌린다", async () => {
    const holder = add("<p>답변: </p>");
    const textNode = holder.querySelector("p")!.firstChild as Text;
    startRestoring();

    textNode.data += "[전";
    await tick();
    expect(textNode.data).toBe("답변: [전"); // 아직 토큰이 아니다

    textNode.data += "화_1]님";
    await tick();
    expect(textNode.data).toBe(`답변: ${PHONE}님`);
  });

  it("사이트가 같은 노드에 글자를 다시 써도 다시 되돌린다", async () => {
    const holder = add("<p>[전화_1]</p>");
    const textNode = holder.querySelector("p")!.firstChild as Text;
    startRestoring();
    expect(textNode.data).toBe(PHONE);
    textNode.data = "다시 렌더링: [전화_1]";
    await tick();
    expect(textNode.data).toBe(`다시 렌더링: ${PHONE}`);
  });

  it("스스로 만든 변화에 반응해 끝없이 도는 일이 없다", async () => {
    const spy = vi.spyOn(vault, "restoreText");
    startRestoring();
    add("<p>[전화_1] [메일_1]</p>");
    await tick();
    await tick();
    expect(spy.mock.calls.length).toBeLessThanOrEqual(4);
  });
});

describe("건드리지 않는 곳", () => {
  it("입력창(편집 가능한 곳)은 건드리지 않는다 — 되돌리면 마스킹이 취소된다", async () => {
    const holder = add(
      '<div id="e" contenteditable="true">[전화_1]</div><textarea id="t">[전화_1]</textarea><div role="textbox" id="r">[전화_1]</div>',
    );
    startRestoring();
    add("<p>[전화_1]</p>");
    await tick();
    expect(holder.querySelector("#e")!.textContent).toBe("[전화_1]");
    expect((holder.querySelector("#t") as HTMLTextAreaElement).value).toBe("[전화_1]");
    expect(holder.querySelector("#r")!.textContent).toBe("[전화_1]");
  });

  it("우리 안내창은 건드리지 않는다", () => {
    const host = add('<div data-ai-input-gateway-notice><span>[전화_1]</span></div>');
    startRestoring();
    expect(host.textContent).toBe("[전화_1]");
  });

  it("내가 보낸 메시지 말풍선은 복원하지 않는다 (복원한 값을 수정해 다시 보내면 원문이 전송된다)", () => {
    const holder = add(
      '<div data-message-author-role="user">내 메시지 [전화_1]</div>' +
        '<div data-message-author-role="assistant">답변 [전화_1]</div>',
    );
    startRestoring();
    expect(holder.children[0]!.textContent).toBe("내 메시지 [전화_1]");
    expect(holder.children[1]!.textContent).toBe(`답변 ${PHONE}`);
  });

  it("다른 사이트의 사용자 말풍선 표식도 제외한다", () => {
    const holder = add('<div data-testid="user-message">[전화_1]</div><user-query>[전화_1]</user-query>');
    startRestoring();
    expect(holder.textContent).toBe("[전화_1][전화_1]");
  });

  it("script·style 안의 글자는 건드리지 않는다", () => {
    const holder = add("<style>.a::after{content:'[전화_1]'}</style>");
    startRestoring();
    expect(holder.textContent).toContain("[전화_1]");
  });

  it("이 탭에서 만들지 않은 토큰은 그대로 둔다", () => {
    const holder = add("<p>[전화_7] [이름_1]</p>");
    startRestoring();
    expect(holder.textContent).toBe("[전화_7] [이름_1]");
  });
});

describe("켜고 끄기", () => {
  it("복원 표시를 끄면 아무것도 바꾸지 않고 관찰도 시작하지 않는다", async () => {
    resetContentState({ restoreTokens: false });
    const holder = add("<p>[전화_1]</p>");
    startRestoring();
    expect(isRestoring()).toBe(false);
    add("<p>[전화_1]</p>");
    await tick();
    expect(holder.textContent).toBe("[전화_1]");
  });

  it("관찰 중에 끄면 그 뒤의 변화는 건드리지 않는다", async () => {
    startRestoring();
    resetContentState({ restoreTokens: false });
    const holder = add("<p>[전화_1]</p>");
    await tick();
    expect(holder.textContent).toBe("[전화_1]");
  });

  it("첫 토큰을 만들기 전에는 아무것도 관찰하지 않는다 (성능 영향 없음)", () => {
    const original = globalThis.MutationObserver;
    const created = vi.fn();
    globalThis.MutationObserver = class extends original {
      constructor(callback: MutationCallback) {
        super(callback);
        created();
      }
    };
    try {
      expect(isRestoring()).toBe(false);
      expect(created).not.toHaveBeenCalled();
      startRestoring();
      expect(created).toHaveBeenCalledTimes(1);
      startRestoring(); // 여러 번 불러도 관찰자는 하나
      expect(created).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.MutationObserver = original;
    }
  });

  it("stopRestoring() 뒤에는 관찰하지 않는다", async () => {
    startRestoring();
    stopRestoring();
    expect(isRestoring()).toBe(false);
    const holder = add("<p>[전화_1]</p>");
    await tick();
    expect(holder.textContent).toBe("[전화_1]");
  });
});
