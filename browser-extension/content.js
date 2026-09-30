(() => {
  "use strict";

  // 텍스트 입력 요소의 이벤트만 감지합니다. 입력값(value/textContent)은 읽지 않습니다.
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
  let hideTimer = 0;

  function isEditableTarget(target) {
    return (
      target instanceof Element &&
      target.closest(EDITABLE_SELECTOR) !== null
    );
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

    const title = document.createElement("strong");
    title.textContent = "입력/붙여넣기 이벤트 감지";

    const description = document.createElement("span");
    description.textContent =
      "확장 프로그램은 입력 내용을 검사·저장·전송하지 않습니다. 아직 차단·마스킹하지 않아 입력이 AI 서비스로 전송될 수 있습니다.";

    notice.append(title, description);
    shadow.append(style, notice);
    document.documentElement.append(host);

    return host;
  }

  function showNotice() {
    if (!noticeHost || !noticeHost.isConnected) {
      noticeHost = createNotice();
    }

    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      if (noticeHost) {
        noticeHost.remove();
        noticeHost = null;
      }
    }, 4000);
  }

  function handleEditorEvent(event) {
    if (!isEditableTarget(event.target)) {
      return;
    }

    // 페이지의 입력을 막거나 수정하지 않습니다.
    showNotice();
  }

  document.addEventListener("input", handleEditorEvent, true);
  document.addEventListener("paste", handleEditorEvent, true);
})();