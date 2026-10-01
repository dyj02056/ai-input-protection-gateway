// 입력창에 마스킹을 적용하고 되돌립니다. 사용자가 알림 버튼을 누른 경우에만 호출됩니다.
import type { Detector } from "../engine/detector.ts";
import { readContentEditable } from "./editable.ts";
import { detectorOptions, state } from "./state.ts";
import type { Editor, MaskResult, PlainEditor, TextRun, UndoEntry } from "./types.ts";

// input/textarea의 값은 평문이므로 프로토타입 setter로 넣어야 사이트가 변경을 감지합니다.
export function setPlainValue(editor: PlainEditor, text: string): void {
  const target =
    editor instanceof HTMLInputElement
      ? HTMLInputElement
      : editor instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement
        : null;
  if (!target) {
    throw new Error("평문 입력 요소가 아닙니다.");
  }

  const descriptor = Object.getOwnPropertyDescriptor(target.prototype, "value");
  if (!descriptor || typeof descriptor.set !== "function") {
    throw new Error("입력 요소를 갱신할 수 없습니다.");
  }
  descriptor.set.call(editor, text);
}

export function dispatchInputEvent(editor: Editor): void {
  // 사이트가 값 변경을 감지하도록 input 이벤트를 보냅니다.
  // 이 이벤트로 다시 검사하면 방금 표시한 결과 안내를 덮어쓰므로 한 번 건너뜁니다.
  state.skipNextInspection = true;
  // 이벤트가 문서까지 닿지 못해 플래그가 남으면 다음 실제 입력을 놓치므로 곧바로 풉니다.
  // dispatchEvent는 동기이므로 이 타이머는 우리가 만든 이벤트를 처리한 뒤에 실행됩니다.
  window.setTimeout(() => {
    state.skipNextInspection = false;
  }, 0);

  const inputEvent =
    typeof InputEvent === "function"
      ? new InputEvent("input", {
          bubbles: true,
          composed: true,
          inputType: "insertReplacementText",
        })
      : new Event("input", { bubbles: true, composed: true });
  editor.dispatchEvent(inputEvent);
}

interface Match {
  readonly label: string;
  readonly start: number;
  readonly end: number;
}

// 일치한 구간이 걸친 텍스트 노드의 문자만 바꿉니다.
// 문단 요소·<br>·서식 요소를 그대로 두므로 줄 구조가 바뀌지 않습니다.
// 하나라도 안전하게 바꿀 수 없으면 아무것도 바꾸지 않고 false를 돌려줍니다.
function replaceInTextNodes(
  runs: readonly TextRun[],
  matches: readonly Match[],
  undoStack: Array<{ node: Text; data: string }>,
): boolean {
  // 뒤에서부터 바꾸면 앞쪽 구간의 위치가 밀리지 않습니다.
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index]!;
    const spanned = runs.filter((run) => run.start < match.end && match.start < run.end);
    if (spanned.length === 0) {
      return false;
    }

    const first = spanned[0]!;
    const last = spanned[spanned.length - 1]!;
    if (!first.node.isConnected || !last.node.isConnected) {
      return false;
    }

    // 되돌릴 수 있도록 바꾸기 전 값을 남깁니다.
    for (const run of spanned) {
      undoStack.push({ node: run.node, data: run.node.data });
    }

    const head = first.node.data.slice(0, match.start - first.start);
    const tail = last.node.data.slice(match.end - last.start);

    if (first === last) {
      first.node.data = `${head}[${match.label}]${tail}`;
    } else {
      // 일치 구간이 여러 텍스트 노드에 나뉘어 있어도 사이에 <br>이나 블록 경계가
      // 없으면(정규식이 줄바꿈을 넘지 못하므로 항상 그렇습니다) 안전하게 바꿀 수 있습니다.
      first.node.data = `${head}[${match.label}]`;
      for (let inner = 1; inner < spanned.length - 1; inner += 1) {
        spanned[inner]!.node.data = "";
      }
      last.node.data = tail;
    }
  }

  return true;
}

export function restoreTextNodes(undoStack: ReadonlyArray<{ node: Text; data: string }>): void {
  for (let index = undoStack.length - 1; index >= 0; index -= 1) {
    const entry = undoStack[index]!;
    if (entry.node.isConnected) {
      entry.node.data = entry.data;
    }
  }
}

// input/textarea 전용 경로입니다. 값이 평문이라 위치를 따로 다룰 필요가 없습니다.
// 결과와 함께 실행 취소에 필요한 이전 값만 돌려주고, 원문을 다른 곳에 저장하지 않습니다.
export function maskPlainValue(editor: PlainEditor, detector: Detector): MaskResult {
  let currentText: string;
  let maskedText: unknown;
  try {
    currentText = editor.value;
    maskedText = detector.mask(currentText, detectorOptions());
  } catch {
    return { outcome: "failed" };
  }

  if (typeof maskedText !== "string" || maskedText === currentText) {
    return { outcome: "unchanged" };
  }

  try {
    setPlainValue(editor, maskedText);
  } catch {
    return { outcome: "failed" };
  }

  dispatchInputEvent(editor);
  return {
    outcome: "applied",
    undo: { kind: "plain", editor, previous: currentText },
  };
}

// contenteditable 전용 경로입니다.
// 일치한 구간만 바꾸고 문단·<br>·서식은 그대로 두어 줄 구조가 바뀌지 않게 합니다.
export function maskContentEditable(editor: Editor, detector: Detector): MaskResult {
  let read: ReturnType<typeof readContentEditable>;
  let matches: ReturnType<Detector["findMatches"]>;
  let expected: string;
  try {
    read = readContentEditable(editor);
    matches = detector.findMatches(read.text, detectorOptions());
    expected = detector.applyMatches(read.text, matches);
  } catch {
    return { outcome: "failed" };
  }

  if (matches.length === 0 || expected === read.text) {
    // 전각 숫자처럼 원문 표기가 달라 위치를 특정할 수 없는 값만 있는 경우를 구분합니다.
    let variantOnly = false;
    try {
      variantOnly = detector.mask(read.text, detectorOptions()) !== read.text;
    } catch {
      variantOnly = false;
    }
    return { outcome: variantOnly ? "variant-only" : "unchanged" };
  }

  const undoStack: Array<{ node: Text; data: string }> = [];
  let applied = false;
  try {
    applied = replaceInTextNodes(read.runs, matches, undoStack);
    if (applied) {
      // 바꾼 결과가 예상과 같은지 확인합니다. 다르면 전부 되돌리고 중단합니다.
      applied = readContentEditable(editor).text === expected;
    }
  } catch {
    applied = false;
  }

  if (!applied) {
    restoreTextNodes(undoStack);
    return { outcome: "failed" };
  }

  dispatchInputEvent(editor);
  const undo: UndoEntry = { kind: "nodes", editor, stack: undoStack };
  return { outcome: "applied", undo };
}
