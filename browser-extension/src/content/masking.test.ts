import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detector } from "../engine/detector.ts";
import { resetContentState } from "../test/contentEnv.ts";
import { maskContentEditable, maskPlainValue, restoreTextNodes } from "./masking.ts";
import { readContentEditable } from "./editable.ts";
import { state } from "./state.ts";

function editorWith(html: string): HTMLElement {
  const editor = document.createElement("div");
  editor.setAttribute("contenteditable", "true");
  editor.innerHTML = html;
  document.body.append(editor);
  return editor;
}

beforeEach(() => resetContentState());
afterEach(() => vi.useRealTimers());

describe("maskContentEditable", () => {
  it("일치한 구간만 바꾸고 문단 구조를 그대로 둔다", () => {
    const editor = editorWith("<p>가짜 전화번호 010-0000-0000</p><p>그대로 남아야 할 문장</p>");
    const result = maskContentEditable(editor, detector);
    expect(result.outcome).toBe("applied");
    expect(editor.innerHTML).toBe("<p>가짜 전화번호 [전화번호]</p><p>그대로 남아야 할 문장</p>");
    expect(readContentEditable(editor).text).toBe("가짜 전화번호 [전화번호]\n그대로 남아야 할 문장\n");
  });

  it("여러 줄·여러 값도 줄 수를 바꾸지 않는다", () => {
    const editor = editorWith(
      "<p>주민번호 000000-1000000</p><p>키 sk-TESTTESTTESTTESTTEST</p><p>메일 test.user@example.com</p>",
    );
    expect(maskContentEditable(editor, detector).outcome).toBe("applied");
    expect(editor.querySelectorAll("p")).toHaveLength(3);
    expect(readContentEditable(editor).text).toBe(
      "주민번호 [주민등록번호]\n키 [API 키/토큰]\n메일 [이메일]\n",
    );
  });

  it("값이 여러 텍스트 노드에 나뉘어 있어도 서식 요소를 남기고 바꾼다", () => {
    const editor = editorWith("<p>번호 010-<b>0000</b>-0000 끝</p>");
    expect(maskContentEditable(editor, detector).outcome).toBe("applied");
    expect(readContentEditable(editor).text).toBe("번호 [전화번호] 끝\n");
    expect(editor.querySelector("b")).not.toBeNull();
  });

  it("실행 취소 정보로 원래 DOM 텍스트를 되돌린다", () => {
    const html = "<p>번호 010-<b>0000</b>-0000 끝</p><p>b</p>";
    const editor = editorWith(html);
    const result = maskContentEditable(editor, detector);
    if (result.outcome !== "applied" || result.undo.kind !== "nodes") throw new Error("적용되지 않음");
    expect(editor.innerHTML).not.toBe(html);
    restoreTextNodes(result.undo.stack);
    expect(editor.innerHTML).toBe(html);
  });

  it("마스킹할 값이 없으면 바꾸지 않는다", () => {
    const editor = editorWith("<p>평범한 문장</p>");
    expect(maskContentEditable(editor, detector).outcome).toBe("unchanged");
    expect(editor.innerHTML).toBe("<p>평범한 문장</p>");
  });

  it("전각 숫자처럼 위치를 특정할 수 없는 값은 건드리지 않고 알린다", () => {
    const html = "<p>전각 ０１０-００００-００００</p>";
    const editor = editorWith(html);
    expect(maskContentEditable(editor, detector).outcome).toBe("variant-only");
    expect(editor.innerHTML).toBe(html);
  });

  it("설정에서 끈 범주는 바꾸지 않는다", () => {
    state.disabledCategories = ["phone_number"];
    const html = "<p>번호 010-0000-0000</p>";
    const editor = editorWith(html);
    expect(maskContentEditable(editor, detector).outcome).toBe("unchanged");
    expect(editor.innerHTML).toBe(html);
  });

  it("적용 뒤 input 이벤트를 한 번 보내고, 그 이벤트는 다시 검사하지 않도록 표시한다", () => {
    vi.useFakeTimers();
    const editor = editorWith("<p>번호 010-0000-0000</p>");
    const seen: string[] = [];
    editor.addEventListener("input", (event) => {
      seen.push((event as InputEvent).inputType);
      // 이벤트를 처리하는 동안에는 건너뛰기 표시가 켜져 있어야 한다.
      expect(state.skipNextInspection).toBe(true);
    });
    maskContentEditable(editor, detector);
    expect(seen).toEqual(["insertReplacementText"]);
    // 이벤트가 문서에 닿지 못해도 표시가 남아 다음 실제 입력을 놓치지 않는다.
    vi.advanceTimersByTime(0);
    expect(state.skipNextInspection).toBe(false);
  });

  it("바꾼 결과가 예상과 다르면 전부 되돌리고 실패로 알린다", () => {
    const editor = editorWith("<p>번호 010-0000-0000</p>");
    const original = editor.innerHTML;
    // 마스킹 중 편집기가 내용을 다시 쓰는 상황을 흉내 낸다.
    const tricky = {
      ...detector,
      applyMatches: () => "예상과 다른 결과",
    } as typeof detector;
    expect(maskContentEditable(editor, tricky).outcome).toBe("failed");
    expect(editor.innerHTML).toBe(original);
  });
});

describe("maskPlainValue", () => {
  it("textarea 값을 마스킹하고 이전 값을 실행 취소 정보로 돌려준다", () => {
    const area = document.createElement("textarea");
    area.value = "전화 010-0000-0000\n그대로";
    document.body.append(area);
    const result = maskPlainValue(area, detector);
    expect(result.outcome).toBe("applied");
    expect(area.value).toBe("전화 [전화번호]\n그대로");
    if (result.outcome === "applied" && result.undo.kind === "plain") {
      expect(result.undo.previous).toBe("전화 010-0000-0000\n그대로");
    } else {
      throw new Error("실행 취소 정보가 없습니다");
    }
  });

  it("input 이벤트를 보내 사이트가 변경을 알게 한다", () => {
    const input = document.createElement("input");
    input.value = "010-0000-0000";
    document.body.append(input);
    const listener = vi.fn();
    input.addEventListener("input", listener);
    maskPlainValue(input, detector);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("값이 바뀌지 않으면 unchanged이고 이벤트를 보내지 않는다", () => {
    const input = document.createElement("input");
    input.value = "평범한 문장";
    const listener = vi.fn();
    input.addEventListener("input", listener);
    expect(maskPlainValue(input, detector).outcome).toBe("unchanged");
    expect(listener).not.toHaveBeenCalled();
  });

  it("탐지기가 오류를 내면 failed이고 값을 바꾸지 않는다", () => {
    const input = document.createElement("input");
    input.value = "010-0000-0000";
    const broken = {
      ...detector,
      mask: () => {
        throw new Error("boom");
      },
    } as typeof detector;
    expect(maskPlainValue(input, broken).outcome).toBe("failed");
    expect(input.value).toBe("010-0000-0000");
  });
});
