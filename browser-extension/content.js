(() => {
  "use strict";

  // detector.js와 PDP가 공유하는 범주 ID를 사용자가 읽을 수 있는 이름으로 바꿉니다.
  const CATEGORY_LABELS = Object.freeze({
    government_id: "주민등록번호 형식",
    phone_number: "전화번호 형식",
    email: "이메일 형식",
    api_key: "API 키/토큰 형식",
  });

  // PDP 데모 정책과 같은 우선순위를 안내문에도 표시합니다. 실제 차단은 하지 않습니다.
  const CATEGORY_ACTION_HINT = Object.freeze({
    government_id: "MASK",
    phone_number: "MASK",
    email: "MASK",
    api_key: "BLOCK",
  });

  // 설정(options.html)에서 끈 범주는 안내와 마스킹에서 모두 제외합니다.
  // 기본값은 4종 전체 사용이며, 저장소를 읽지 못하면 기본값을 유지합니다.
  const ALL_CATEGORIES = Object.freeze(Object.keys(CATEGORY_LABELS));
  let disabledCategories = [];

  function applyEnabledSetting(enabled) {
    if (!enabled || typeof enabled !== "object") {
      return;
    }
    disabledCategories = ALL_CATEGORIES.filter((category) => enabled[category] === false);
  }

  function detectorOptions() {
    return { disabledCategories };
  }

  // 판정 이름만 서비스 워커에 알려 배지에 표시합니다. 원문과 범주 ID는 보내지 않습니다.
  function reportAction(action) {
    try {
      chrome.runtime.sendMessage({ type: "gateway:action", action }, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      // 서비스 워커가 없으면 배지만 갱신되지 않습니다.
    }
  }

  try {
    chrome.storage.local.get({ enabled: null }, (data) => {
      if (data) {
        applyEnabledSetting(data.enabled);
      }
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && Object.prototype.hasOwnProperty.call(changes, "enabled")) {
        applyEnabledSetting(changes.enabled.newValue);
      }
    });
  } catch {
    // chrome.storage를 쓸 수 없는 환경에서는 기본값(4종 전체)으로만 동작합니다.
  }

  function decideLocalAction(categories) {
    if (!Array.isArray(categories) || categories.length === 0) {
      return "ALLOW";
    }
    if (categories.includes("api_key")) {
      return "BLOCK";
    }
    if (categories.some((category) => !Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, category))) {
      return "REQUIRE_APPROVAL";
    }
    return "MASK";
  }

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
  let noticeAction = null;
  let activeEditor = null;
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

  function formatCategoryLabels(categories) {
    return categories
      .map((category) => (
        Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, category)
          ? CATEGORY_LABELS[category]
          : "알 수 없는 탐지 범주"
      ))
      .join(" · ");
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
        pointer-events: auto;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .notice {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;
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

      .message {
        display: flex;
        flex-direction: column;
        gap: 5px;
      }

      .notice strong {
        font-size: 14px;
      }

      .mask-button {
        border: 0;
        border-radius: 6px;
        padding: 7px 10px;
        background: #155eef;
        color: #ffffff;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }

      .mask-button:hover {
        background: #004eeb;
      }

      .mask-button:focus-visible {
        outline: 3px solid #94b7ff;
        outline-offset: 2px;
      }

      .mask-button[hidden] {
        display: none;
      }
    `;

    const notice = document.createElement("div");
    notice.className = "notice";
    notice.setAttribute("role", "region");
    notice.setAttribute("aria-label", "로컬 입력 검사 안내");

    const message = document.createElement("div");
    message.className = "message";
    message.setAttribute("role", "status");
    message.setAttribute("aria-live", "polite");

    noticeTitle = document.createElement("strong");
    noticeDescription = document.createElement("span");
    message.append(noticeTitle, noticeDescription);

    noticeAction = document.createElement("button");
    noticeAction.type = "button";
    noticeAction.className = "mask-button";
    noticeAction.textContent = "감지 항목 마스킹";
    noticeAction.hidden = true;
    noticeAction.addEventListener("click", applyMaskToActiveEditor);

    notice.append(message, noticeAction);
    shadow.append(style, notice);
    document.documentElement.append(host);
    noticeHost = host;

    return host;
  }

  function displayNotice(title, description, editor = null, showMaskAction = false) {
    if (!noticeHost || !noticeHost.isConnected) {
      createNotice();
    }

    noticeTitle.textContent = title;
    noticeDescription.textContent = description;
    noticeAction.hidden = !showMaskAction;
    activeEditor = showMaskAction ? editor : null;

    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      if (noticeHost) {
        noticeHost.remove();
        noticeHost = null;
        noticeTitle = null;
        noticeDescription = null;
        noticeAction = null;
      }
      activeEditor = null;
      hideTimer = 0;
    }, 8000);
  }

  // 설정에서 끈 범주를 걸러낸 뒤 안내를 그리고, 판정 이름만 배지용으로 알립니다.
  function showNotice(categories, detectorAvailable = true, editor = null) {
    if (!detectorAvailable) {
      reportAction("");
      renderNotice(categories, false, editor);
      return;
    }

    const visible = categories.filter((category) => !disabledCategories.includes(category));
    reportAction(decideLocalAction(visible));
    renderNotice(visible, true, editor);
  }

  function renderNotice(categories, detectorAvailable = true, editor = null) {
    if (!detectorAvailable) {
      displayNotice(
        "로컬 검사기를 사용할 수 없습니다",
        "확장 프로그램을 새로고침해 주세요. 입력 내용은 검사되거나 차단되지 않았습니다.",
      );
      return;
    }

    if (categories.length > 0) {
      const detector = globalThis.AIInputGatewayDetector;
      const canMask = Boolean(
        editor && editor.isConnected && detector && typeof detector.mask === "function",
      );
      const categoryLabels = formatCategoryLabels(categories);
      const actionHint = decideLocalAction(categories);
      const actionText =
        actionHint === "BLOCK"
          ? "PDP 데모 기준 BLOCK에 해당합니다. 이 확장은 전송을 막지 않으니 보내기 전에 직접 지우거나 마스킹하세요."
          : actionHint === "REQUIRE_APPROVAL"
            ? "PDP 데모 기준 승인 검토 대상입니다. 이 확장은 승인 요청을 보내지 않으니 필요하면 별도 절차를 따르세요."
            : "PDP 데모 기준 MASK 대상입니다. 아래 버튼으로 자리표시자 마스킹을 할 수 있습니다.";
      const description = canMask
        ? `${categoryLabels}과(와) 일치했습니다. ${actionText} 실제 정보인지 검증하지 않았고, 입력을 자동 전송하거나 차단하지 않습니다.`
        : `${categoryLabels}과(와) 일치했습니다. ${actionText} 실제 정보인지 검증하지 않았으며, 입력을 마스킹하거나 차단하지 않습니다.`;

      displayNotice(
        "형식 패턴 감지 — 전송 전 확인",
        description,
        canMask ? editor : null,
        canMask,
      );
      return;
    }

    displayNotice(
      "간단한 형식 검사 완료",
      "설정된 일부 정규식과 일치하는 항목을 찾지 못했습니다. 안전하다는 뜻은 아니며, 입력은 차단되지 않습니다.",
    );
  }

  function writeContentEditableText(editor, text) {
    // contenteditable 안의 일반 텍스트 노드에서는 '\n'이 화면상 공백처럼 접힐 수 있습니다.
    // 줄마다 텍스트 노드를 만들고 줄 사이에 <br>을 넣어 줄바꿈을 표현합니다.
    // 입력을 HTML로 해석하지 않도록 innerHTML 대신 텍스트 노드만 사용합니다.
    const fragment = document.createDocumentFragment();
    const lines = text.split(/\r\n|\r|\n/);

    lines.forEach((line, index) => {
      if (index > 0) {
        fragment.append(document.createElement("br"));
      }
      if (line.length > 0) {
        fragment.append(document.createTextNode(line));
      }
    });

    editor.replaceChildren(fragment);
  }

  function writeEditorText(editor, text) {
    if (editor instanceof HTMLInputElement) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      if (!descriptor || typeof descriptor.set !== "function") {
        throw new Error("입력 요소를 갱신할 수 없습니다.");
      }
      descriptor.set.call(editor, text);
    } else if (editor instanceof HTMLTextAreaElement) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
      if (!descriptor || typeof descriptor.set !== "function") {
        throw new Error("입력 요소를 갱신할 수 없습니다.");
      }
      descriptor.set.call(editor, text);
    } else {
      writeContentEditableText(editor, text);
    }

    const inputEvent = typeof InputEvent === "function"
      ? new InputEvent("input", {
          bubbles: true,
          composed: true,
          inputType: "insertReplacementText",
        })
      : new Event("input", { bubbles: true, composed: true });
    editor.dispatchEvent(inputEvent);
  }

  function applyMaskToActiveEditor() {
    const editor = activeEditor;
    const detector = globalThis.AIInputGatewayDetector;

    if (!editor || !editor.isConnected || !detector || typeof detector.mask !== "function") {
      displayNotice(
        "마스킹할 입력창을 찾을 수 없습니다",
        "입력창을 다시 클릭해 검사해 주세요. 이 상태를 보호 기능이 작동한 것으로 간주하지 마세요.",
      );
      return;
    }

    let currentText;
    let maskedText;
    try {
      currentText = readEditorText(editor);
      maskedText = detector.mask(currentText, detectorOptions());
    } catch {
      displayNotice(
        "마스킹을 적용하지 못했습니다",
        "현재 편집기와 호환되지 않았을 수 있습니다. 입력이 보호되었다고 간주하지 마세요.",
      );
      return;
    }

    if (typeof maskedText !== "string" || maskedText === currentText) {
      displayNotice(
        "현재 입력에서 마스킹할 형식이 없습니다",
        "탐지 규칙에 일치하지 않아도 민감정보가 없다는 뜻은 아닙니다. 입력을 차단하지 않습니다.",
      );
      return;
    }

    try {
      writeEditorText(editor, maskedText);
    } catch {
      displayNotice(
        "마스킹을 적용하지 못했습니다",
        "현재 편집기와 호환되지 않았을 수 있습니다. 입력이 보호되었다고 간주하지 마세요.",
      );
      return;
    }

    displayNotice(
      "마스킹본을 입력란에 적용했습니다",
      "일치한 부분만 유형별 자리표시자로 바꿨습니다. 줄바꿈은 유지하도록 처리했지만 편집기별 서식·상태가 달라질 수 있으니 결과를 확인하세요. 자동 전송·차단 기능은 없습니다.",
    );
  }

  function inspectEditor(editor) {
    const detector = globalThis.AIInputGatewayDetector;
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

  // 입력은 관찰만 합니다. 사용자가 알림 버튼을 누르기 전에는 내용을 수정하지 않습니다.
  document.addEventListener("input", handleEditorEvent, true);
  document.addEventListener("paste", handleEditorEvent, true);
})();