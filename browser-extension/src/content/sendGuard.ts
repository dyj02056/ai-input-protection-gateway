// 전송 차단은 기본값이 꺼져 있습니다. 켜져 있어도 정책 판정이 BLOCK이거나
// 승인 단계가 필요한 경우에만 동작하고, 5초 안에 다시 누르면 통과시킵니다.
// "전송 차단"과 "승인 확인 단계"는 서로 독립된 스위치입니다. 둘 다 "로컬 정책 적용"이
// 켜져 있어야 판정을 받습니다.
import { recordAudit } from "./audit.ts";
import { alertKey, decideLocalAction, formatCategoryLabels } from "./decision.ts";
import { EDITABLE_SELECTOR, findEditableTarget } from "./editable.ts";
import { canMaskEditor, currentCategories, displayNotice, hasUndoAvailable } from "./flow.ts";
import { describeFindings, riskyAttachments } from "./files/guard.ts";
import { feature, state } from "./state.ts";
import { NOTICE_KIND, type Editor } from "./types.ts";

const SEND_LABEL_HINTS = ["send", "submit", "보내기", "전송", "질문하기"];
const BLOCK_CONFIRM_WINDOW_MS = 5000;

// FILE: 첨부파일 검사에서 문제가 있었고 "첨부파일 전송 차단"을 켠 경우
type BlockReason = "" | "BLOCK" | "REQUIRE_APPROVAL" | "FILE";

function sendBlockReason(editor: Editor | null): BlockReason {
  if (!feature("enforcePolicy")) {
    return "";
  }
  if (!editor || !editor.isConnected) {
    return "";
  }

  const categories = currentCategories(editor);
  if (categories.length === 0) {
    return "";
  }

  const action = decideLocalAction(categories);
  if (action === "BLOCK" && feature("blockSend")) {
    return "BLOCK";
  }
  if (action === "REQUIRE_APPROVAL" && feature("requireConfirm")) {
    return "REQUIRE_APPROVAL";
  }
  return "";
}

// 첨부파일 전송 차단은 별도 스위치(blockFileSend)입니다. 다른 두 스위치와 마찬가지로 "로컬 정책 적용"이 함께 켜져 있어야 합니다.
function fileBlockReason(): BlockReason {
  if (!feature("enforcePolicy") || !feature("blockFileSend")) {
    return "";
  }
  return riskyAttachments().length > 0 ? "FILE" : "";
}

function isSendControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  // 우리 안내창(섀도 DOM)에서 시작한 클릭은 전송 버튼이 아닙니다.
  if (target.closest("[data-ai-input-gateway-notice]")) {
    return false;
  }

  const control = target.closest(
    'button, [role="button"], input[type="submit"], input[type="button"], a[href]',
  );
  if (!control) {
    return false;
  }
  // 폼 안의 버튼은 전송으로 봅니다.
  if (control.closest("form")) {
    return true;
  }

  const label = [
    control.getAttribute("aria-label"),
    control.getAttribute("data-testid"),
    control.getAttribute("title"),
    control.textContent,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return SEND_LABEL_HINTS.some((hint) => label.includes(hint));
}

// 첫 시도는 막고, 같은 이유로 5초 안에 다시 시도하면 사용자의 뜻으로 보고 허용합니다.
// 클릭·Enter 한 번은 click과 submit 두 경로를 탑니다. 허용한 직후에 오는 제출까지
// 막으면 "한 번 더 누르면 전송됩니다"가 그대로 동작하지 않으므로, 같은 입력 묶음에
// 속한 제출만 한 번 통과시킵니다. (플래그는 다음 작업 묶음에서 사라집니다.)
function shouldBlockNow(editor: Editor | null, reason: string): boolean {
  const key = `${reason}|${editor === state.focusedEditor ? "focused" : "other"}`;
  const now = Date.now();

  if (state.blockArmedKey === key && now < state.blockArmedUntil) {
    state.blockArmedKey = "";
    state.blockArmedUntil = 0;
    state.allowPendingSubmit = true;
    // 사용자가 다시 눌러 보내기로 했으니 첨부된 파일도 함께 나갑니다. 같은 파일 때문에 다시 막지 않습니다.
    state.attachedFiles = [];
    window.setTimeout(() => {
      state.allowPendingSubmit = false;
    }, 0);
    return false;
  }

  state.blockArmedKey = key;
  state.blockArmedUntil = now + BLOCK_CONFIRM_WINDOW_MS;
  return true;
}

function announceBlock(editor: Editor | null, reason: BlockReason): void {
  if (reason === "FILE") {
    const seconds = Math.round(BLOCK_CONFIRM_WINDOW_MS / 1000);
    displayNotice({
      kind: NOTICE_KIND.ALERT,
      title: "전송을 막았습니다 — 첨부파일 확인 필요",
      description: `${describeFindings(riskyAttachments())}. 첨부파일에 문제가 있어 보내기를 중단했습니다. ${seconds}초 안에 다시 누르면 그대로 전송됩니다. 이미 첨부를 뺐다면 다시 눌러 주세요.`,
      alertId: `file|block|${Date.now()}`,
    });
    return;
  }

  const categories = currentCategories(editor);
  const label = formatCategoryLabels(categories);
  const seconds = Math.round(BLOCK_CONFIRM_WINDOW_MS / 1000);
  const canMask = canMaskEditor(editor);

  recordAudit(decideLocalAction(categories), categories);

  displayNotice({
    kind: NOTICE_KIND.ALERT,
    title:
      reason === "BLOCK"
        ? "전송을 막았습니다 — 형식 패턴 감지"
        : "확인이 필요합니다 — 승인 검토 대상",
    description: `${label}과(와) 일치해 보내기를 중단했습니다. ${seconds}초 안에 다시 누르면 그대로 전송됩니다. 값을 지우거나 마스킹하려면 아래 버튼을 쓰세요.`,
    editor: canMask ? editor : null,
    showMask: canMask,
    showUndo: hasUndoAvailable(),
    alertId: alertKey(categories),
  });
}

// 아래 세 리스너는 설정에서 전송 차단을 켠 경우에만 실제로 전송을 막습니다.
export function installSendGuard(): void {
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.defaultPrevented) {
        return;
      }

      const editor = findEditableTarget(event.target);
      const reason = sendBlockReason(editor) || (editor ? fileBlockReason() : "");
      if (!reason || !shouldBlockNow(editor, reason)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      announceBlock(editor, reason);
    },
    true,
  );

  document.addEventListener(
    "submit",
    (event) => {
      // 직전 클릭·Enter에서 사용자가 전송을 허용했다면 그 제출은 그대로 통과시킵니다.
      if (state.allowPendingSubmit) {
        return;
      }

      const editor =
        state.focusedEditor && state.focusedEditor.isConnected
          ? state.focusedEditor
          : event.target instanceof Element
            ? event.target.querySelector<HTMLElement>(EDITABLE_SELECTOR)
            : null;

      const reason = sendBlockReason(editor) || fileBlockReason();
      if (!reason || !shouldBlockNow(editor, reason)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      announceBlock(editor, reason);
    },
    true,
  );

  document.addEventListener(
    "click",
    (event) => {
      if (event.defaultPrevented || !isSendControl(event.target)) {
        return;
      }

      const editor =
        state.focusedEditor && state.focusedEditor.isConnected
          ? state.focusedEditor
          : state.activeEditor;
      const reason = sendBlockReason(editor) || fileBlockReason();
      if (!reason || !shouldBlockNow(editor, reason)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      announceBlock(editor, reason);
    },
    true,
  );
}
