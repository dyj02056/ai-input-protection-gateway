// 입력창을 찾고 그 내용을 읽습니다. 읽은 내용은 호출한 쪽에서만 쓰고 저장하지 않습니다.
import type { Editor, PlainEditor, TextRun } from "./types.ts";

// 텍스트 입력 요소만 대상으로 합니다. 검사 결과에 원문이나 일치한 문자열은 넣지 않습니다.
export const EDITABLE_SELECTOR = [
  "textarea",
  "input:not([type])",
  'input[type="text"]',
  'input[type="search"]',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  '[contenteditable=""]',
  '[role="textbox"]',
].join(", ");

export function findEditableTarget(target: EventTarget | null): Editor | null {
  if (!(target instanceof Element)) {
    return null;
  }

  return target.closest<HTMLElement>(EDITABLE_SELECTOR);
}

export function isPlainEditor(editor: Editor): editor is PlainEditor {
  return editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement;
}

// 블록으로 줄이 나뉘는 display 값입니다. 이 경계마다 줄바꿈 하나를 셉니다.
const BLOCK_DISPLAYS = new Set([
  "block",
  "flex",
  "grid",
  "flow-root",
  "list-item",
  "table",
  "table-row",
  "table-caption",
]);

// 입력 요소가 아닌 내용은 검사 대상에서 제외합니다.
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "TEXTAREA", "SELECT"]);

// contenteditable의 구조를 그대로 반영해 텍스트를 읽습니다.
//
// innerText를 쓰지 않는 이유: HTML 명세의 innerText는 <p> 요소 경계마다 줄바꿈을
// 2개로 계산합니다. 그래서 <p>a</p><p>b</p>는 "a\n\nb"가 되어, 실제로는 없는 빈 줄이
// 검사 대상에 섞입니다. 블록 경계와 <br>을 각각 줄바꿈 하나로 세면 사용자가 만든
// 줄 수와 일치합니다. (<p><br></p>처럼 빈 문단은 <br> 덕분에 빈 줄로 남습니다.)
//
// runs는 텍스트 노드마다 이 텍스트에서 차지하는 구간입니다. 마스킹할 때 이 구간만
// 바꾸면 문단 요소·<br>·서식이 그대로 남습니다.
export function readContentEditable(editor: Editor): { text: string; runs: TextRun[] } {
  const runs: TextRun[] = [];
  const displayCache = new Map<Element, string>();
  let text = "";

  function appendBlockBreak(): void {
    // 중첩된 블록 경계에서 줄바꿈이 겹치지 않게 합니다.
    if (text.length > 0 && !text.endsWith("\n")) {
      text += "\n";
    }
  }

  function displayOf(element: Element): string {
    let display = displayCache.get(element);
    if (display === undefined) {
      display = window.getComputedStyle(element).display;
      displayCache.set(element, display);
    }
    return display;
  }

  function walk(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const textNode = node as Text;
      const value = textNode.data;
      if (value.length > 0) {
        runs.push({ node: textNode, start: text.length, end: text.length + value.length });
        text += value;
      }
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const element = node as Element;
    if (SKIP_TAGS.has(element.tagName) || element.hasAttribute("hidden")) {
      return;
    }

    // <br>은 사용자가 직접 만든 줄바꿈이므로 항상 한 줄로 셉니다.
    if (element.tagName === "BR") {
      text += "\n";
      return;
    }

    const display = displayOf(element);
    if (display === "none") {
      // 화면에 없는 요소는 검사 대상이 아닙니다.
      return;
    }

    const lineBreaking = BLOCK_DISPLAYS.has(display);
    if (lineBreaking) {
      appendBlockBreak();
    }
    for (const child of element.childNodes) {
      walk(child);
    }
    if (lineBreaking) {
      appendBlockBreak();
    }
  }

  walk(editor);
  return { text, runs };
}

export function readEditorText(editor: Editor): string {
  if (isPlainEditor(editor)) {
    return editor.value;
  }

  return readContentEditable(editor).text;
}
