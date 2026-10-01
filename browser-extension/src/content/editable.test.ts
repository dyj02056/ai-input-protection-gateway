import { describe, expect, it } from "vitest";
import { findEditableTarget, readContentEditable, readEditorText } from "./editable.ts";

function editorWith(html: string): HTMLElement {
  const editor = document.createElement("div");
  editor.setAttribute("contenteditable", "true");
  editor.innerHTML = html;
  document.body.append(editor);
  return editor;
}

// 편집기 자체도 블록 요소라 읽은 텍스트 끝에 줄바꿈이 하나 붙습니다. 마스킹 위치에는 영향이 없고,
// 마스킹 전후를 같은 방법으로 읽어 비교하므로 결과 검증에도 일관됩니다.
describe("readContentEditable", () => {
  it("문단 경계를 줄바꿈 하나로 센다 (innerText는 둘로 센다)", () => {
    expect(readContentEditable(editorWith("<p>a</p><p>b</p>")).text).toBe("a\nb\n");
  });

  it("<br>은 줄바꿈 하나다", () => {
    expect(readContentEditable(editorWith("a<br>b")).text).toBe("a\nb\n");
  });

  it("빈 문단(<p><br></p>)은 빈 줄로 남는다", () => {
    expect(readContentEditable(editorWith("<p>a</p><p><br></p><p>b</p>")).text).toBe("a\n\nb\n");
  });

  it("중첩된 블록 경계에서 줄바꿈이 겹치지 않는다", () => {
    expect(readContentEditable(editorWith("<div><div><p>a</p></div></div><div>b</div>")).text).toBe(
      "a\nb\n",
    );
  });

  it("인라인 요소는 줄을 나누지 않는다", () => {
    expect(readContentEditable(editorWith("<p>a<b>b</b>c</p>")).text).toBe("abc\n");
  });

  it("보이지 않는 요소와 입력 요소가 아닌 내용은 읽지 않는다", () => {
    const editor = editorWith(
      '<p>보임</p><p hidden>숨김</p><p style="display:none">없음</p><script>x</script><style>y</style>',
    );
    expect(readContentEditable(editor).text).toBe("보임\n");
  });

  it("텍스트 노드마다 차지하는 구간을 돌려준다", () => {
    const editor = editorWith("<p>ab<b>cd</b></p><p>ef</p>");
    const { text, runs } = readContentEditable(editor);
    expect(text).toBe("abcd\nef\n");
    expect(runs.map((run) => [run.node.data, run.start, run.end])).toEqual([
      ["ab", 0, 2],
      ["cd", 2, 4],
      ["ef", 5, 7],
    ]);
    for (const run of runs) expect(text.slice(run.start, run.end)).toBe(run.node.data);
  });
});

describe("readEditorText", () => {
  it("input·textarea는 값을 그대로 읽는다", () => {
    const input = document.createElement("input");
    input.value = "한 줄";
    const area = document.createElement("textarea");
    area.value = "첫째\n둘째";
    expect(readEditorText(input)).toBe("한 줄");
    expect(readEditorText(area)).toBe("첫째\n둘째");
  });

  it("contenteditable은 구조를 읽는다", () => {
    expect(readEditorText(editorWith("<p>a</p><p>b</p>"))).toBe("a\nb\n");
  });
});

describe("findEditableTarget", () => {
  const make = (html: string) => {
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    return host;
  };

  it("텍스트 입력 요소만 입력창으로 본다", () => {
    const host = make(
      '<textarea id="t"></textarea><input id="a"><input id="b" type="text"><input id="c" type="search">' +
        '<input id="d" type="checkbox"><input id="e" type="password"><div id="f" role="textbox"></div>' +
        '<div id="g" contenteditable="true"><span id="inner">x</span></div><div id="h">x</div>',
    );
    const found = (id: string) => findEditableTarget(host.querySelector(`#${id}`))?.id ?? null;
    expect(found("t")).toBe("t");
    expect(found("a")).toBe("a");
    expect(found("b")).toBe("b");
    expect(found("c")).toBe("c");
    expect(found("f")).toBe("f");
    expect(found("g")).toBe("g");
    expect(found("inner")).toBe("g");
    expect(found("d")).toBeNull();
    expect(found("e")).toBeNull();
    expect(found("h")).toBeNull();
  });

  it("요소가 아닌 대상은 null이다", () => {
    expect(findEditableTarget(null)).toBeNull();
    expect(findEditableTarget(document)).toBeNull();
    expect(findEditableTarget(document.createTextNode("x"))).toBeNull();
  });
});
