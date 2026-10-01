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
  function readContentEditable(editor) {
    const runs = [];
    const displayCache = new Map();
    let text = "";

    function appendBlockBreak() {
      // 중첩된 블록 경계에서 줄바꿈이 겹치지 않게 합니다.
      if (text.length > 0 && !text.endsWith("\n")) {
        text += "\n";
      }
    }

    function displayOf(element) {
      let display = displayCache.get(element);
      if (display === undefined) {
        display = window.getComputedStyle(element).display;
        displayCache.set(element, display);
      }
      return display;
    }

    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const value = node.data;
        if (value.length > 0) {
          runs.push({ node, start: text.length, end: text.length + value.length });
          text += value;
        }
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) {
        return;
      }

      if (SKIP_TAGS.has(node.tagName) || node.hasAttribute("hidden")) {
        return;
      }

      // <br>은 사용자가 직접 만든 줄바꿈이므로 항상 한 줄로 셉니다.
      if (node.tagName === "BR") {
        text += "\n";
        return;
      }

      const display = displayOf(node);
      if (display === "none") {
        // 화면에 없는 요소는 검사 대상이 아닙니다.
        return;
      }

      const lineBreaking = BLOCK_DISPLAYS.has(display);
      if (lineBreaking) {
        appendBlockBreak();
      }
      for (const child of node.childNodes) {
        walk(child);
      }
      if (lineBreaking) {
        appendBlockBreak();
      }
    }

    walk(editor);
    return { text, runs };
  }

  function readEditorText(editor) {
    if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) {
      return editor.value;
    }

    return readContentEditable(editor).text;
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
        editor &&
          editor.isConnected &&
          detector &&
          typeof detector.mask === "function" &&
          typeof detector.findMatches === "function" &&
          typeof detector.applyMatches === "function",
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

  // input/textarea의 값은 평문이므로 프로토타입 setter로 넣어야 사이트가 변경을 감지합니다.
  function setPlainValue(editor, text) {
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

  function dispatchInputEvent(editor) {
    const inputEvent = typeof InputEvent === "function"
      ? new InputEvent("input", {
          bubbles: true,
          composed: true,
          inputType: "insertReplacementText",
        })
      : new Event("input", { bubbles: true, composed: true });
    editor.dispatchEvent(inputEvent);
  }

  // 일치한 구간이 걸친 텍스트 노드의 문자만 바꿉니다.
  // 문단 요소·<br>·서식 요소를 그대로 두므로 줄 구조가 바뀌지 않습니다.
  // 하나라도 안전하게 바꿀 수 없으면 아무것도 바꾸지 않고 false를 돌려줍니다.
  function replaceInTextNodes(runs, matches, undoStack) {
    // 뒤에서부터 바꾸면 앞쪽 구간의 위치가 밀리지 않습니다.
    for (let index = matches.length - 1; index >= 0; index -= 1) {
      const match = matches[index];
      const spanned = runs.filter((run) => run.start < match.end && match.start < run.end);
      if (spanned.length === 0) {
        return false;
      }

      const first = spanned[0];
      const last = spanned[spanned.length - 1];
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
          spanned[inner].node.data = "";
        }
        last.node.data = tail;
      }
    }

    return true;
  }

  function restoreTextNodes(undoStack) {
    for (let index = undoStack.length - 1; index >= 0; index -= 1) {
      const entry = undoStack[index];
      if (entry.node.isConnected) {
        entry.node.data = entry.data;
      }
    }
  }

  // input/textarea 전용 경로입니다. 값이 평문이라 위치를 따로 다룰 필요가 없습니다.
  function maskPlainValue(editor, detector) {
    let currentText;
    let maskedText;
    try {
      currentText = editor.value;
      maskedText = detector.mask(currentText, detectorOptions());
    } catch {
      return "failed";
    }

    if (typeof maskedText !== "string" || maskedText === currentText) {
      return "unchanged";
    }

    try {
      setPlainValue(editor, maskedText);
    } catch {
      return "failed";
    }

    dispatchInputEvent(editor);
    return "applied";
  }

  // contenteditable 전용 경로입니다.
  // 일치한 구간만 바꾸고 문단·<br>·서식은 그대로 두어 줄 구조가 바뀌지 않게 합니다.
  function maskContentEditable(editor, detector) {
    let read;
    let matches;
    let expected;
    try {
      read = readContentEditable(editor);
      matches = detector.findMatches(read.text, detectorOptions());
      expected = detector.applyMatches(read.text, matches);
    } catch {
      return "failed";
    }

    if (matches.length === 0 || expected === read.text) {
      // 전각 숫자처럼 원문 표기가 달라 위치를 특정할 수 없는 값만 있는 경우를 구분합니다.
      let variantOnly = false;
      try {
        variantOnly = detector.mask(read.text, detectorOptions()) !== read.text;
      } catch {
        variantOnly = false;
      }
      return variantOnly ? "variant-only" : "unchanged";
    }

    const undoStack = [];
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
      return "failed";
    }

    dispatchInputEvent(editor);
    return "applied";
  }

  function applyMaskToActiveEditor() {
    const editor = activeEditor;
    const detector = globalThis.AIInputGatewayDetector;

    if (
      !editor ||
      !editor.isConnected ||
      !detector ||
      typeof detector.findMatches !== "function" ||
      typeof detector.applyMatches !== "function" ||
      typeof detector.mask !== "function"
    ) {
      displayNotice(
        "마스킹할 입력창을 찾을 수 없습니다",
        "입력창을 다시 클릭해 검사해 주세요. 이 상태를 보호 기능이 작동한 것으로 간주하지 마세요.",
      );
      return;
    }

    const plainTarget =
      editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement;
    const outcome = plainTarget
      ? maskPlainValue(editor, detector)
      : maskContentEditable(editor, detector);

    if (outcome === "applied") {
      displayNotice(
        "마스킹본을 입력란에 적용했습니다",
        "일치한 구간만 유형별 자리표시자로 바꿨습니다. 문단·줄바꿈·서식은 건드리지 않았지만, 편집기별 상태가 달라질 수 있으니 결과를 확인하세요. 자동 전송·차단 기능은 없습니다.",
      );
      return;
    }

    if (outcome === "variant-only") {
      displayNotice(
        "입력란을 바꾸지 않았습니다",
        "전각 숫자처럼 원문 표기가 다른 값만 있어 바꿀 위치를 특정하지 못했습니다. 구조를 안전하게 유지하려면 해당 부분을 직접 수정해 주세요.",
      );
      return;
    }

    if (outcome === "unchanged") {
      displayNotice(
        "현재 입력에서 마스킹할 형식이 없습니다",
        "탐지 규칙에 일치하지 않아도 민감정보가 없다는 뜻은 아닙니다. 입력을 차단하지 않습니다.",
      );
      return;
    }

    displayNotice(
      "마스킹을 적용하지 못했습니다",
      "감지된 값이 여러 요소에 걸쳐 있거나 편집기 구조가 예상과 달라, 일부만 바꾸지 않고 중단했습니다. 입력이 보호되었다고 간주하지 마세요.",
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