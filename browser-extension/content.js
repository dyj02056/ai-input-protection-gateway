(() => {
  "use strict";

  // 텍스트 입력 요소만 대상으로 합니다. 검사 결과에 원문이나 일치한 문자열은 넣지 않습니다.
  const EDITABLE_SELECTOR = [
    "textarea",
    "input:not([type])",
    'input[type="text"]',
    'input[type="search"]',
    '[contenteditable="true"]',
    '[contenteditable="plaintext-only"]',
    '[contenteditable=""]',
    '[role="textbox"]',
  ].join(", ");

  let noticeHost = null;
  let noticeTitle = null;
  let noticeDescription = null;
  let hideTimer = 0;

  function findEditableTarget(target) {
    if (!(target instanceof Element)) {
      return null;
    }

    return target.closest(EDITABLE_SELECTOR);
  }

  function readEditorText(editor) {
    if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) {
      return editor.value;
    }

    return editor.innerText || editor.textContent || "";
  }

  function createNotice() {
    const host = document.createElement("div");
    host.setAttribute("data-ai-input-gateway-notice", "");
    const shadow = host.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = `
      :host {
        all: initial;
        position: fixed;
        top: 12px;
        right: 12px;
        z-index: 2147483647;
        display: block;
        width: max-content;
        max-width: min(360px, calc(100vw - 24px));
        pointer-events: none;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .notice {
        display: flex;
        flex-direction: column;
        gap: 5px;
        padding: 12px 14px;
        border: 1px solid #c7d2e1;
        border-radius: 10px;
        background: #ffffff;
        color: #172033;
        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.16);
        font-size: 13px;
        line-height: 1.45;
        overflow-wrap: anywhere;
      }

      .notice strong {
        font-size: 14px;
      }
    `;

    const notice = document.createElement("div");
    notice.className = "notice";
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");

    noticeTitle = document.createElement("strong");
    noticeDescription = document.createElement("span");
    notice.append(noticeTitle, noticeDescription);
    shadow.append(style, notice);
    document.documentElement.append(host);
    noticeHost = host;

    return host;
  }

  function showNotice(categories, detectorAvailable = true) {
    if (!noticeHost || !noticeHost.isConnected) {
      createNotice();
    }

    if (!detectorAvailable) {
      noticeTitle.textContent = "로컬 검사기를 사용할 수 없습니다";
      noticeDescription.textContent =
        "확장 프로그램을 새로고침해 주세요. 입력 내용은 검사되거나 차단되지 않았습니다.";
    } else if (categories.length > 0) {
      noticeTitle.textContent = "형식 패턴 감지 — 전송 전 확인";
      noticeDescription.textContent =
        `${categories.join(" · ")} 형식과 일치했습니다. 실제 정보인지 검증하지 않았으며, 입력을 마스킹하거나 차단하지 않습니다.`;
    } else {
      noticeTitle.textContent = "간단한 형식 검사 완료";
      noticeDescription.textContent =
        "설정된 일부 정규식과 일치하는 항목을 찾지 못했습니다. 탐지 누락이 있을 수 있고, 입력은 차단되지 않습니다.";
    }

    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      if (noticeHost) {
        noticeHost.remove();
        noticeHost = null;
        noticeTitle = null;
        noticeDescription = null;
      }
      hideTimer = 0;
    }, 5000);
  }

  function inspectEditor(editor) {
    const detector = globalThis.AIInputGatewayDetector;
    if (!detector || typeof detector.inspect !== "function") {
      showNotice([], false);
      return;
    }

    try {
      const categories = detector.inspect(readEditorText(editor));
      if (!Array.isArray(categories)) {
        showNotice([], false);
        return;
      }
      showNotice(categories);
    } catch {
      // 오류 메시지나 입력값을 기록하지 않습니다.
      showNotice([], false);
    }
  }

  function handleEditorEvent(event) {
    const editor = findEditableTarget(event.target);
    if (!editor) {
      return;
    }

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

  // 관찰만 합니다. 입력 이벤트를 취소하거나 입력을 수정하지 않습니다.
  document.addEventListener("input", handleEditorEvent, true);
  document.addEventListener("paste", handleEditorEvent, true);
})();