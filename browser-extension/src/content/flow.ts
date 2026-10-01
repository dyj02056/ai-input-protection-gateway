// 입력 검사 → 안내 → (사용자가 누르면) 마스킹·실행 취소로 이어지는 흐름입니다.
// 입력은 관찰만 합니다. 사용자가 알림 버튼을 누르기 전에는 내용을 수정하지 않습니다.
import { DEFAULT_FEATURES } from "../shared/settings.ts";
import { recordAudit, reportAction } from "./audit.ts";
import { alertKey, decideLocalAction, formatCategoryLabels, policyName } from "./decision.ts";
import { findEditableTarget, isPlainEditor, readEditorText } from "./editable.ts";
import {
  dispatchInputEvent,
  maskContentEditable,
  maskPlainValue,
  restoreTextNodes,
  setPlainValue,
} from "./masking.ts";
import { createNoticeController } from "./notice/controller.ts";
import { startRestoring } from "./restore.ts";
import { detectorOptions, feature, state } from "./state.ts";
import { getDetector, NOTICE_KIND, type Editor, type NoticeKind } from "./types.ts";

interface DisplayOptions {
  kind?: NoticeKind;
  title: string;
  description: string;
  editor?: Editor | null;
  showMask?: boolean;
  showUndo?: boolean;
  alertId?: string;
}

const notice = createNoticeController({
  onClose: () => {
    // 사용자가 직접 닫은 감지 안내는 같은 감지가 계속되는 동안 다시 띄우지 않습니다.
    if (notice.kind === NOTICE_KIND.ALERT) {
      state.dismissedAlertKey = state.activeAlertKey;
    }
    notice.hide();
  },
  onMask: () => applyMaskToActiveEditor(),
  onUndo: () => applyUndo(),
  onHidden: () => {
    state.activeEditor = null;
  },
});

export const refreshNoticePosition = (): void => notice.refreshPosition();

// 감지 안내(alert)만 계속 표시합니다. 나머지 안내는 설정한 시간 뒤에 사라집니다.
function noticeAutoHideMs(kind: NoticeKind): number {
  if (kind === NOTICE_KIND.ALERT && feature("persistentAlert")) {
    return 0;
  }
  const configured = Number(state.features.resultAutoHideMs);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_FEATURES.resultAutoHideMs;
}

export function displayNotice({
  kind = NOTICE_KIND.INFO,
  title,
  description,
  editor = null,
  showMask = false,
  showUndo = false,
  alertId = "",
}: DisplayOptions): void {
  notice.show({ kind, title, description, showMask, showUndo }, noticeAutoHideMs(kind));

  if (kind === NOTICE_KIND.ALERT) {
    state.activeAlertKey = alertId;
  }
  state.activeEditor = showMask ? editor : null;
}

// 마스킹 버튼을 붙일 수 있는 입력창인지 확인합니다.
export function canMaskEditor(editor: Editor | null): boolean {
  const detector = getDetector();
  return Boolean(
    editor &&
      editor.isConnected &&
      detector &&
      typeof detector.mask === "function" &&
      typeof detector.findMatches === "function" &&
      typeof detector.applyMatches === "function",
  );
}

// 현재 입력창에서 다시 검사한 범주 목록입니다. 원문은 담지 않고 범주 ID만 돌려줍니다.
export function currentCategories(editor: Editor | null): string[] {
  const detector = getDetector();
  if (!editor || !editor.isConnected || !detector || typeof detector.inspect !== "function") {
    return [];
  }
  try {
    const categories = detector.inspect(readEditorText(editor), detectorOptions());
    if (!Array.isArray(categories)) {
      return [];
    }
    return categories.filter((category) => !state.disabledCategories.includes(category));
  } catch {
    return [];
  }
}

export function hasUndoAvailable(): boolean {
  const entry = state.lastUndo;
  return Boolean(feature("undoButton") && entry && entry.editor && entry.editor.isConnected);
}

// 설정에서 끈 범주를 걸러낸 뒤 안내를 그리고, 판정 이름만 배지용으로 알립니다.
function showNotice(
  categories: readonly string[],
  detectorAvailable = true,
  editor: Editor | null = null,
): void {
  if (!detectorAvailable) {
    reportAction("");
    renderNotice(categories, false, editor);
    return;
  }

  const visible = categories.filter((category) => !state.disabledCategories.includes(category));
  const action = decideLocalAction(visible);
  reportAction(action);
  recordAudit(action, visible);
  renderNotice(visible, true, editor);
}

function actionTextFor(action: string, canMask: boolean): string {
  const enforcing = feature("enforcePolicy");
  if (action === "BLOCK") {
    return enforcing && feature("blockSend")
      ? `${policyName()} 판정이 BLOCK이고 전송 차단이 켜져 있어, 전송을 막습니다. 값을 지우거나 마스킹한 뒤 보내세요.`
      : `${policyName()} 판정이 BLOCK에 해당합니다. 이 확장은 전송을 막지 않으니 보내기 전에 직접 지우거나 마스킹하세요.`;
  }
  if (action === "REQUIRE_APPROVAL") {
    return enforcing && feature("requireConfirm")
      ? `${policyName()} 판정이 승인 검토 대상이고 승인 단계가 켜져 있어, 확인을 거쳐야 전송됩니다.`
      : `${policyName()} 판정이 승인 검토 대상입니다. 이 확장은 승인 요청을 보내지 않으니 필요하면 별도 절차를 따르세요.`;
  }
  return canMask
    ? `${policyName()} 판정이 MASK 대상입니다. 아래 버튼으로 자리표시자 마스킹을 할 수 있습니다.`
    : `${policyName()} 판정이 MASK 대상입니다. 아래 버튼 없이 직접 값을 수정해 주세요.`;
}

export function renderNotice(
  categories: readonly string[],
  detectorAvailable = true,
  editor: Editor | null = null,
): void {
  if (!detectorAvailable) {
    displayNotice({
      kind: NOTICE_KIND.INFO,
      title: "로컬 검사기를 사용할 수 없습니다",
      description: "확장 프로그램을 새로고침해 주세요. 입력 내용은 검사되거나 차단되지 않았습니다.",
    });
    return;
  }

  if (categories.length > 0) {
    const key = alertKey(categories);
    // 사용자가 직접 닫은 것과 같은 감지면 다시 띄우지 않습니다.
    if (key === state.dismissedAlertKey) {
      return;
    }

    const canMask = canMaskEditor(editor);
    const categoryLabels = formatCategoryLabels(categories);
    const actionHint = decideLocalAction(categories);
    const actionText = actionTextFor(actionHint, canMask);
    const description = canMask
      ? `${categoryLabels}과(와) 일치했습니다. ${actionText} 실제 정보인지 검증하지 않았고, 입력을 자동 전송하지 않습니다.`
      : `${categoryLabels}과(와) 일치했습니다. ${actionText} 실제 정보인지 검증하지 않았으며, 이 입력은 마스킹하거나 차단하지 않습니다.`;

    // 감지 안내는 사용자가 닫거나 감지가 사라질 때까지 계속 표시됩니다.
    displayNotice({
      kind: NOTICE_KIND.ALERT,
      title: "형식 패턴 감지 — 전송 전 확인",
      description,
      editor: canMask ? editor : null,
      showMask: canMask,
      showUndo: hasUndoAvailable(),
      alertId: key,
    });
    return;
  }

  // 첨부파일 안내는 입력창과 별개라서, 입력창이 깨끗해져도 닫지 않습니다(사용자가 닫거나 새 안내가 뜰 때까지).
  if (notice.kind === NOTICE_KIND.ALERT && state.activeAlertKey.startsWith("file|")) {
    return;
  }

  // 감지된 값이 모두 사라졌으면 계속 떠 있던 감지 안내를 닫고 닫힘 기록도 지웁니다.
  state.dismissedAlertKey = "";
  state.activeAlertKey = "";

  if (notice.kind === NOTICE_KIND.ALERT && feature("autoCloseWhenClean")) {
    notice.hide();
    return;
  }

  displayNotice({
    kind: NOTICE_KIND.INFO,
    title: "간단한 형식 검사 완료",
    description:
      "설정된 일부 정규식과 일치하는 항목을 찾지 못했습니다. 안전하다는 뜻은 아니며, 입력은 차단되지 않습니다.",
    showUndo: hasUndoAvailable(),
  });
}

// 세션 토큰 마스킹일 때 복원이 어떻게 동작하는지 알려 줍니다. 전송되지 않고 이 탭에서만 보인다는 점을 분명히 합니다.
function restoreSentence(): string {
  return feature("restoreTokens")
    ? "AI 답변에 이 토큰이 나오면 이 탭의 화면에서만 원래 값으로 보여줍니다(전송되지 않으며, 새로고침하면 복원 정보가 사라집니다)."
    : "복원 표시가 꺼져 있어 답변의 토큰은 그대로 보입니다.";
}

// 현재 설정에서 자동 보호가 어디까지 동작하는지 한 줄로 알려 줍니다.
function enforcementSentence(): string {
  if (feature("enforcePolicy") && feature("blockSend")) {
    return "전송 차단이 켜져 있어, 같은 내용이면 전송을 막습니다.";
  }
  if (feature("enforcePolicy") && feature("requireConfirm")) {
    return "승인 단계가 켜져 있어, 확인을 거쳐야 전송됩니다.";
  }
  return "자동 전송·차단 기능은 꺼져 있습니다.";
}

function applyMaskToActiveEditor(): void {
  const editor = state.activeEditor;
  const detector = getDetector();

  if (
    !editor ||
    !editor.isConnected ||
    !detector ||
    typeof detector.findMatches !== "function" ||
    typeof detector.applyMatches !== "function" ||
    typeof detector.mask !== "function"
  ) {
    displayNotice({
      kind: NOTICE_KIND.INFO,
      title: "마스킹할 입력창을 찾을 수 없습니다",
      description:
        "입력창을 다시 클릭해 검사해 주세요. 이 상태를 보호 기능이 작동한 것으로 간주하지 마세요.",
    });
    return;
  }

  const result = isPlainEditor(editor)
    ? maskPlainValue(editor, detector)
    : maskContentEditable(editor, detector);

  if (result.outcome === "applied") {
    state.lastUndo = result.undo || null;

    // 남은 항목이 있으면 계속 표시되는 감지 안내로 돌아갑니다.
    const remaining = currentCategories(editor);
    if (remaining.length > 0) {
      renderNotice(remaining, true, editor);
      return;
    }

    // 세션 토큰으로 가렸다면, 이제부터 화면에 나오는 토큰을 이 탭에서만 원래 값으로 보여줍니다.
    if (result.tokens) {
      startRestoring();
    }

    displayNotice({
      kind: NOTICE_KIND.RESULT,
      title: "마스킹본을 입력란에 적용했습니다",
      description: `${result.tokens ? `일치한 구간만 [전화_1] 같은 세션 토큰으로 바꿨습니다. ${restoreSentence()}` : "일치한 구간만 유형별 자리표시자로 바꿨습니다."} 문단·줄바꿈·서식은 건드리지 않았지만, 편집기별 상태가 달라질 수 있으니 결과를 확인하세요. ${enforcementSentence()} 필요하면 아래 실행 취소로 되돌릴 수 있습니다.`,
      showUndo: hasUndoAvailable(),
    });
    return;
  }

  if (result.outcome === "variant-only") {
    displayNotice({
      kind: NOTICE_KIND.INFO,
      title: "입력란을 바꾸지 않았습니다",
      description:
        "전각 숫자·보이지 않는 문자·한글로 쓴 숫자·인코딩처럼 원문 표기가 다른 값만 있어 바꿀 위치를 특정하지 못했습니다. 구조를 안전하게 유지하려면 해당 부분을 직접 수정해 주세요.",
      showUndo: hasUndoAvailable(),
    });
    return;
  }

  if (result.outcome === "unchanged") {
    displayNotice({
      kind: NOTICE_KIND.INFO,
      title: "현재 입력에서 마스킹할 형식이 없습니다",
      description:
        "탐지 규칙에 일치하지 않아도 민감정보가 없다는 뜻은 아닙니다. 입력을 차단하지 않습니다.",
      showUndo: hasUndoAvailable(),
    });
    return;
  }

  displayNotice({
    kind: NOTICE_KIND.RESULT,
    title: "마스킹을 적용하지 못했습니다",
    description:
      "감지된 값이 여러 요소에 걸쳐 있거나 편집기 구조가 예상과 달라, 일부만 바꾸지 않고 중단했습니다. 입력이 보호되었다고 간주하지 마세요.",
    showUndo: hasUndoAvailable(),
  });
}

// 사용자가 누르는 실행 취소입니다. 마스킹 직전 상태로만 되돌리고, 원문을 따로 보관하지 않습니다.
function applyUndo(): void {
  const entry = state.lastUndo;
  if (!feature("undoButton") || !entry || !entry.editor || !entry.editor.isConnected) {
    displayNotice({
      kind: NOTICE_KIND.INFO,
      title: "되돌릴 내용이 없습니다",
      description: "실행 취소는 마스킹 직후 한 번만 사용할 수 있습니다.",
    });
    return;
  }

  state.lastUndo = null;

  let restored = false;
  try {
    if (entry.kind === "plain") {
      setPlainValue(entry.editor, entry.previous);
      restored = true;
    } else if (entry.kind === "nodes") {
      restoreTextNodes(entry.stack);
      restored = true;
    }
  } catch {
    restored = false;
  }

  if (!restored) {
    displayNotice({
      kind: NOTICE_KIND.RESULT,
      title: "되돌리지 못했습니다",
      description:
        "편집기 상태가 바뀌어 마스킹 이전 내용으로 되돌릴 수 없습니다. 직접 값을 확인해 주세요.",
    });
    return;
  }

  dispatchInputEvent(entry.editor);

  const remaining = currentCategories(entry.editor);
  if (remaining.length > 0) {
    renderNotice(remaining, true, entry.editor);
    return;
  }

  displayNotice({
    kind: NOTICE_KIND.RESULT,
    title: "마스킹을 되돌렸습니다",
    description: `${enforcementSentence()} 되돌린 내용을 전송하기 전에 다시 확인하세요.`,
  });
}

function inspectEditor(editor: Editor): void {
  const detector = getDetector();
  if (!detector || typeof detector.inspect !== "function") {
    showNotice([], false);
    return;
  }

  try {
    const categories = detector.inspect(readEditorText(editor), detectorOptions());
    if (!Array.isArray(categories)) {
      showNotice([], false);
      return;
    }
    showNotice(categories, true, editor);
  } catch {
    // 오류 메시지나 입력값을 기록하지 않습니다.
    showNotice([], false);
  }
}

export function handleEditorEvent(event: Event): void {
  // 마스킹 뒤에 우리가 보낸 input 이벤트는 방금 표시한 안내를 덮어쓰지 않도록 건너뜁니다.
  if (event.type === "input" && state.skipNextInspection) {
    state.skipNextInspection = false;
    return;
  }

  const editor = findEditableTarget(event.target);
  if (!editor) {
    return;
  }

  // 전송 차단 판정은 마지막으로 입력한 창을 기준으로 합니다.
  state.focusedEditor = editor;

  if (event.type === "paste") {
    // 붙여넣기 기본 동작이 끝난 뒤 입력창의 현재 내용을 검사합니다.
    window.setTimeout(() => {
      if (editor.isConnected) {
        inspectEditor(editor);
      }
    }, 0);
    return;
  }

  inspectEditor(editor);
}
