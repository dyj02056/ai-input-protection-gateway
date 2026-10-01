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

  // 안내창 위치와 시간, 그리고 선택 기능의 기본값입니다.
  // persistentAlert(감지 안내 계속 표시)와 undoButton(실행 취소 버튼)은 화면 표시 방식만
  // 바꾸므로 기본값을 켭니다. 전송 차단·승인 단계·정책 적용·감사 기록은 이 확장의
  // "자동으로 막지 않는다"는 원칙을 바꾸므로 반드시 사용자가 켜야 합니다.
  const DEFAULT_FEATURES = Object.freeze({
    persistentAlert: true,
    autoCloseWhenClean: true,
    resultAutoHideMs: 8000,
    noticePosition: "top-right",
    undoButton: true,
    auditLog: false,
    enforcePolicy: false,
    blockSend: false,
    requireConfirm: false,
  });

  // options.html은 maskStyle(자리표시자/세션 토큰)을 저장하지만, 1.1.0은 자리표시자만
  // 구현되어 있어 content.js는 저장된 값을 쓰지 않습니다. 세션 토큰은 다음 버전 범위입니다.
  let features = Object.assign({}, DEFAULT_FEATURES);

  // 저장된 값 중 아는 키만, 타입에 맞게 받아들입니다. 이상한 값은 기본값으로 되돌립니다.
  function coerceFeatures(raw) {
    const merged = Object.assign({}, DEFAULT_FEATURES);
    if (!raw || typeof raw !== "object") {
      return merged;
    }

    for (const key of Object.keys(DEFAULT_FEATURES)) {
      if (!Object.prototype.hasOwnProperty.call(raw, key)) {
        continue;
      }
      const expected = DEFAULT_FEATURES[key];
      const value = raw[key];

      if (typeof expected === "boolean") {
        merged[key] = value === true;
      } else if (typeof expected === "number") {
        const number = Number(value);
        merged[key] = Number.isFinite(number) && number >= 0 ? number : expected;
      } else if (typeof expected === "string") {
        merged[key] = typeof value === "string" ? value : expected;
      }
    }

    return merged;
  }

  function feature(name) {
    return features[name] === true;
  }

  function applySettings(data) {
    if (!data || typeof data !== "object") {
      return;
    }
    if (data.enabled && typeof data.enabled === "object") {
      disabledCategories = ALL_CATEGORIES.filter((category) => data.enabled[category] === false);
    }
    if (data.features) {
      features = coerceFeatures(data.features);
    }
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
    chrome.storage.local.get({ enabled: null, features: DEFAULT_FEATURES }, (data) => {
      applySettings(data);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") {
        return;
      }
      // 바뀐 키만 모아서 반영합니다. 설정 변경은 다음 검사부터 바로 적용됩니다.
      const next = {};
      for (const key of ["enabled", "features"]) {
        if (Object.prototype.hasOwnProperty.call(changes, key)) {
          next[key] = changes[key].newValue;
        }
      }
      applySettings(next);

      // 안내창 위치는 표시 중인 창에도 즉시 반영합니다.
      if (noticeHost && noticeHost.isConnected) {
        applyNoticePosition(noticeHost);
      }
    });
  } catch {
    // chrome.storage를 쓸 수 없는 환경에서는 기본값으로만 동작합니다.
  }

  // 판정 규칙은 policy.js(브라우저 로컬 정책 엔진)에 있습니다.
  // policy.py와 같은 케이스 표로 양쪽 결과가 같은지 검사합니다.
  // policy.js를 읽지 못한 경우에만 아래 폴백으로 같은 규칙을 계산합니다.
  function decideLocalAction(categories) {
    const engine = globalThis.AIInputGatewayPolicy;
    if (engine && typeof engine.decide === "function") {
      try {
        return engine.decide(categories).action;
      } catch {
        // 원문이 섞여 들어오는 등 이상한 입력이면 폴백으로 진행합니다.
      }
    }

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

  // 안내창 종류입니다. 감지 안내(alert)만 사용자가 닫을 때까지 계속 표시합니다.
  const NOTICE_KIND = Object.freeze({
    ALERT: "alert",
    RESULT: "result",
    INFO: "info",
  });

  // 안내창을 둘 수 있는 위치입니다. 적용은 CSS의 data-position 규칙이 담당합니다.
  const NOTICE_POSITIONS = new Set(["top-right", "bottom-left"]);

  let noticeHost = null;
  let noticeTitle = null;
  let noticeDescription = null;
  let noticeAction = null;
  let noticeUndo = null;
  let noticeKind = "";
  // 안내창의 마스킹 버튼이 가리키는 입력창입니다.
  let activeEditor = null;
  // 마지막으로 사용자가 입력한 입력창입니다. 전송 차단 판정에 씁니다.
  let focusedEditor = null;
  // 표시 중인 감지 안내의 지문과, 사용자가 직접 닫은 지문입니다.
  // 닫은 뒤 같은 감지가 계속되면 다시 띄우지 않고, 감지가 사라지면 초기화합니다.
  let activeAlertKey = "";
  let dismissedAlertKey = "";
  let noticePosition = "";
  let hideTimer = 0;
  // 마스킹으로 우리가 직접 만든 input 이벤트를 다시 검사하지 않도록 1회 건너뜁니다.
  let skipNextInspection = false;
  // 실행 취소에 필요한 최소 정보입니다. 되돌릴 DOM 노드나 이전 평문 값만 담습니다.
  let lastUndo = null;
  // 전송 차단에서 "한 번 더 누르면 허용"을 처리하기 위한 상태입니다.
  let blockArmedKey = "";
  let blockArmedUntil = 0;
  const BLOCK_CONFIRM_WINDOW_MS = 5000;

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

  // 안내창 위치는 설정값을 host의 data-position으로 옮겨 CSS가 처리하게 합니다.
  function applyNoticePosition(host) {
    const position = NOTICE_POSITIONS.has(features.noticePosition)
      ? features.noticePosition
      : "top-right";
    if (noticePosition !== position) {
      noticePosition = position;
      host.dataset.position = position;
    }
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

      :host([data-position="bottom-left"]) {
        top: auto;
        right: auto;
        bottom: 12px;
        left: 12px;
      }

      .notice {
        position: relative;
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
        padding-right: 18px;
      }

      .notice strong {
        font-size: 14px;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .actions[hidden] {
        display: none;
      }

      .mask-button,
      .undo-button {
        border: 0;
        border-radius: 6px;
        padding: 7px 10px;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }

      .mask-button {
        background: #155eef;
        color: #ffffff;
      }

      .mask-button:hover {
        background: #004eeb;
      }

      .undo-button {
        background: #eef2f9;
        color: #22304a;
        border: 1px solid #c7d2e1;
      }

      .undo-button:hover {
        background: #e2e9f5;
      }

      .close-button {
        position: absolute;
        top: 6px;
        right: 6px;
        width: 22px;
        height: 22px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: #5a6b8c;
        font: inherit;
        font-size: 15px;
        line-height: 1;
        cursor: pointer;
      }

      .close-button:hover {
        background: #eef2f9;
        color: #22304a;
      }

      .mask-button:focus-visible,
      .undo-button:focus-visible,
      .close-button:focus-visible {
        outline: 3px solid #94b7ff;
        outline-offset: 2px;
      }

      [hidden] {
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

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "close-button";
    closeButton.textContent = "×";
    closeButton.title = "안내 닫기";
    closeButton.setAttribute("aria-label", "안내 닫기");
    closeButton.addEventListener("click", () => {
      // 사용자가 직접 닫은 감지 안내는 같은 감지가 계속되는 동안 다시 띄우지 않습니다.
      if (noticeKind === NOTICE_KIND.ALERT) {
        dismissedAlertKey = activeAlertKey;
      }
      hideNotice();
    });

    const actions = document.createElement("div");
    actions.className = "actions";

    noticeAction = document.createElement("button");
    noticeAction.type = "button";
    noticeAction.className = "mask-button";
    noticeAction.textContent = "감지 항목 마스킹";
    noticeAction.hidden = true;
    noticeAction.addEventListener("click", applyMaskToActiveEditor);

    noticeUndo = document.createElement("button");
    noticeUndo.type = "button";
    noticeUndo.className = "undo-button";
    noticeUndo.textContent = "실행 취소";
    noticeUndo.hidden = true;
    noticeUndo.addEventListener("click", applyUndo);

    actions.append(noticeAction, noticeUndo);
    notice.append(closeButton, message, actions);
    shadow.append(style, notice);
    document.documentElement.append(host);
    noticeHost = host;

    applyNoticePosition(host);

    return notice;
  }

  function hideNotice() {
    window.clearTimeout(hideTimer);
    hideTimer = 0;
    if (noticeHost && noticeHost.isConnected) {
      noticeHost.remove();
    }
    noticeHost = null;
    noticeTitle = null;
    noticeDescription = null;
    noticeAction = null;
    noticeUndo = null;
    noticeKind = "";
    activeEditor = null;
  }

  // 감지 안내(alert)만 계속 표시합니다. 나머지 안내는 설정한 시간 뒤에 사라집니다.
  function noticeAutoHideMs(kind) {
    if (kind === NOTICE_KIND.ALERT && feature("persistentAlert")) {
      return 0;
    }
    const configured = Number(features.resultAutoHideMs);
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_FEATURES.resultAutoHideMs;
  }

  function displayNotice({
    kind = NOTICE_KIND.INFO,
    title,
    description,
    editor = null,
    showMask = false,
    showUndo = false,
    alertId = "",
  }) {
    if (!noticeHost || !noticeHost.isConnected) {
      createNotice();
    }

    applyNoticePosition(noticeHost);

    noticeKind = kind;
    if (kind === NOTICE_KIND.ALERT) {
      activeAlertKey = alertId;
    }
    noticeTitle.textContent = title;
    noticeDescription.textContent = description;
    noticeAction.hidden = !showMask;
    noticeUndo.hidden = !showUndo;
    // 두 버튼이 모두 숨겨지면 빈 줄이 남지 않게 합니다.
    noticeAction.parentElement.hidden = !showMask && !showUndo;
    activeEditor = showMask ? editor : null;

    window.clearTimeout(hideTimer);
    hideTimer = 0;

    const autoHideMs = noticeAutoHideMs(kind);
    if (autoHideMs > 0) {
      hideTimer = window.setTimeout(hideNotice, autoHideMs);
    }
  }

  // 마스킹 버튼을 붙일 수 있는 입력창인지 확인합니다.
  function canMaskEditor(editor) {
    const detector = globalThis.AIInputGatewayDetector;
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
  function currentCategories(editor) {
    const detector = globalThis.AIInputGatewayDetector;
    if (!editor || !editor.isConnected || !detector || typeof detector.inspect !== "function") {
      return [];
    }
    try {
      const categories = detector.inspect(readEditorText(editor), detectorOptions());
      if (!Array.isArray(categories)) {
        return [];
      }
      return categories.filter((category) => !disabledCategories.includes(category));
    } catch {
      return [];
    }
  }

  function hasUndoAvailable() {
    const entry = lastUndo;
    return Boolean(
      feature("undoButton") && entry && entry.editor && entry.editor.isConnected,
    );
  }

  // 감사 기록에는 범주 ID·조치·시각만 남깁니다. 원문과 일치한 문자열은 저장하지 않습니다.
  // 같은 판정이 반복되면(예: 숫자를 한 자씩 입력) 마지막 기록과 비교해 한 번만 남깁니다.
  const AUDIT_LIMIT = 20;
  let lastAuditKey = "";

  function recordAudit(action, categories) {
    if (!feature("auditLog") || !Array.isArray(categories) || categories.length === 0) {
      return;
    }

    const key = `${action}|${[...categories].sort().join(",")}`;
    if (key === lastAuditKey) {
      return;
    }
    lastAuditKey = key;

    try {
      chrome.storage.local.get({ history: [] }, (data) => {
        void chrome.runtime.lastError;
        const existing = data && Array.isArray(data.history) ? data.history : [];
        const next = existing
          .concat([{ at: Date.now(), action, categories: [...categories].sort() }])
          .slice(-AUDIT_LIMIT);
        chrome.storage.local.set({ history: next }, () => {
          void chrome.runtime.lastError;
        });
      });
    } catch {
      // 저장소를 쓸 수 없으면 기록만 남기지 않습니다. 검사와 안내는 그대로 동작합니다.
    }
  }

  // 설정에서 끈 범주를 걸러낸 뒤 안내를 그리고, 판정 이름만 배지용으로 알립니다.
  function showNotice(categories, detectorAvailable = true, editor = null) {
    if (!detectorAvailable) {
      reportAction("");
      renderNotice(categories, false, editor);
      return;
    }

    const visible = categories.filter((category) => !disabledCategories.includes(category));
    const action = decideLocalAction(visible);
    reportAction(action);
    recordAudit(action, visible);
    renderNotice(visible, true, editor);
  }

  function actionTextFor(action, canMask) {
    const enforcing = feature("enforcePolicy");
    if (action === "BLOCK") {
      return enforcing && feature("blockSend")
        ? "로컬 정책 판정이 BLOCK이고 전송 차단이 켜져 있어, 전송을 막습니다. 값을 지우거나 마스킹한 뒤 보내세요."
        : "로컬 정책 판정이 BLOCK에 해당합니다. 이 확장은 전송을 막지 않으니 보내기 전에 직접 지우거나 마스킹하세요.";
    }
    if (action === "REQUIRE_APPROVAL") {
      return enforcing && feature("requireConfirm")
        ? "로컬 정책 판정이 승인 검토 대상이고 승인 단계가 켜져 있어, 확인을 거쳐야 전송됩니다."
        : "로컬 정책 판정이 승인 검토 대상입니다. 이 확장은 승인 요청을 보내지 않으니 필요하면 별도 절차를 따르세요.";
    }
    return canMask
      ? "로컬 정책 판정이 MASK 대상입니다. 아래 버튼으로 자리표시자 마스킹을 할 수 있습니다."
      : "로컬 정책 판정이 MASK 대상입니다. 아래 버튼 없이 직접 값을 수정해 주세요.";
  }

  // 감지 내용이 같은지 비교하기 위한 지문입니다. 범주 ID와 조치만 쓰고 원문은 넣지 않습니다.
  function alertKey(categories) {
    return `${decideLocalAction(categories)}|${[...categories].sort().join(",")}`;
  }

  function renderNotice(categories, detectorAvailable = true, editor = null) {
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
      if (key === dismissedAlertKey) {
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

    // 감지된 값이 모두 사라졌으면 계속 떠 있던 감지 안내를 닫고 닫힘 기록도 지웁니다.
    dismissedAlertKey = "";
    activeAlertKey = "";

    if (noticeKind === NOTICE_KIND.ALERT && feature("autoCloseWhenClean")) {
      hideNotice();
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
    // 사이트가 값 변경을 감지하도록 input 이벤트를 보냅니다.
    // 이 이벤트로 다시 검사하면 방금 표시한 결과 안내를 덮어쓰므로 한 번 건너뜁니다.
    skipNextInspection = true;
    // 이벤트가 문서까지 닿지 못해 플래그가 남으면 다음 실제 입력을 놓치므로 곧바로 풉니다.
    // dispatchEvent는 동기이므로 이 타이머는 우리가 만든 이벤트를 처리한 뒤에 실행됩니다.
    window.setTimeout(() => {
      skipNextInspection = false;
    }, 0);

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
  // 결과와 함께 실행 취소에 필요한 이전 값만 돌려주고, 원문을 다른 곳에 저장하지 않습니다.
  function maskPlainValue(editor, detector) {
    let currentText;
    let maskedText;
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
  function maskContentEditable(editor, detector) {
    let read;
    let matches;
    let expected;
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
      return { outcome: "failed" };
    }

    dispatchInputEvent(editor);
    return {
      outcome: "applied",
      undo: { kind: "nodes", editor, stack: undoStack },
    };
  }

  // 현재 설정에서 자동 보호가 어디까지 동작하는지 한 줄로 알려 줍니다.
  function enforcementSentence() {
    if (feature("enforcePolicy") && feature("blockSend")) {
      return "전송 차단이 켜져 있어, 같은 내용이면 전송을 막습니다.";
    }
    if (feature("enforcePolicy") && feature("requireConfirm")) {
      return "승인 단계가 켜져 있어, 확인을 거쳐야 전송됩니다.";
    }
    return "자동 전송·차단 기능은 꺼져 있습니다.";
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
      displayNotice({
        kind: NOTICE_KIND.INFO,
        title: "마스킹할 입력창을 찾을 수 없습니다",
        description:
          "입력창을 다시 클릭해 검사해 주세요. 이 상태를 보호 기능이 작동한 것으로 간주하지 마세요.",
      });
      return;
    }

    const plainTarget =
      editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement;
    const result = plainTarget
      ? maskPlainValue(editor, detector)
      : maskContentEditable(editor, detector);
    const outcome = result.outcome;

    if (outcome === "applied") {
      lastUndo = result.undo || null;

      // 남은 항목이 있으면 계속 표시되는 감지 안내로 돌아갑니다.
      const remaining = currentCategories(editor);
      if (remaining.length > 0) {
        renderNotice(remaining, true, editor);
        return;
      }

      displayNotice({
        kind: NOTICE_KIND.RESULT,
        title: "마스킹본을 입력란에 적용했습니다",
        description: `일치한 구간만 유형별 자리표시자로 바꿨습니다. 문단·줄바꿈·서식은 건드리지 않았지만, 편집기별 상태가 달라질 수 있으니 결과를 확인하세요. ${enforcementSentence()} 필요하면 아래 실행 취소로 되돌릴 수 있습니다.`,
        showUndo: hasUndoAvailable(),
      });
      return;
    }

    if (outcome === "variant-only") {
      displayNotice({
        kind: NOTICE_KIND.INFO,
        title: "입력란을 바꾸지 않았습니다",
        description:
          "전각 숫자처럼 원문 표기가 다른 값만 있어 바꿀 위치를 특정하지 못했습니다. 구조를 안전하게 유지하려면 해당 부분을 직접 수정해 주세요.",
        showUndo: hasUndoAvailable(),
      });
      return;
    }

    if (outcome === "unchanged") {
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
  function applyUndo() {
    const entry = lastUndo;
    if (!feature("undoButton") || !entry || !entry.editor || !entry.editor.isConnected) {
      displayNotice({
        kind: NOTICE_KIND.INFO,
        title: "되돌릴 내용이 없습니다",
        description: "실행 취소는 마스킹 직후 한 번만 사용할 수 있습니다.",
      });
      return;
    }

    lastUndo = null;

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
    // 마스킹 뒤에 우리가 보낸 input 이벤트는 방금 표시한 안내를 덮어쓰지 않도록 건너뜁니다.
    if (event.type === "input" && skipNextInspection) {
      skipNextInspection = false;
      return;
    }

    const editor = findEditableTarget(event.target);
    if (!editor) {
      return;
    }

    // 전송 차단 판정은 마지막으로 입력한 창을 기준으로 합니다.
    focusedEditor = editor;

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

  // 전송 차단은 기본값이 꺼져 있습니다. 켜져 있어도 정책 판정이 BLOCK이거나
  // 승인 단계가 필요한 경우에만 동작하고, 5초 안에 다시 누르면 통과시킵니다.
  // "전송 차단"과 "승인 확인 단계"는 서로 독립된 스위치입니다. 둘 다 "로컬 정책 적용"이
  // 켜져 있어야 판정을 받습니다.
  const SEND_LABEL_HINTS = ["send", "submit", "보내기", "전송", "질문하기"];

  function sendBlockReason(editor) {
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

  function isSendControl(target) {
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
  let allowPendingSubmit = false;

  function shouldBlockNow(editor, reason) {
    const key = `${reason}|${editor === focusedEditor ? "focused" : "other"}`;
    const now = Date.now();

    if (blockArmedKey === key && now < blockArmedUntil) {
      blockArmedKey = "";
      blockArmedUntil = 0;
      allowPendingSubmit = true;
      window.setTimeout(() => {
        allowPendingSubmit = false;
      }, 0);
      return false;
    }

    blockArmedKey = key;
    blockArmedUntil = now + BLOCK_CONFIRM_WINDOW_MS;
    return true;
  }

  function announceBlock(editor, reason) {
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

  // 입력은 관찰만 합니다. 사용자가 알림 버튼을 누르기 전에는 내용을 수정하지 않습니다.
  document.addEventListener("input", handleEditorEvent, true);
  document.addEventListener("paste", handleEditorEvent, true);

  // 아래 세 리스너는 설정에서 전송 차단을 켠 경우에만 실제로 전송을 막습니다.
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.defaultPrevented) {
        return;
      }

      const editor = findEditableTarget(event.target);
      const reason = sendBlockReason(editor);
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
      if (allowPendingSubmit) {
        return;
      }

      const editor =
        focusedEditor && focusedEditor.isConnected
          ? focusedEditor
          : event.target instanceof Element
            ? event.target.querySelector(EDITABLE_SELECTOR)
            : null;

      const reason = sendBlockReason(editor);
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

      const editor = focusedEditor && focusedEditor.isConnected ? focusedEditor : activeEditor;
      const reason = sendBlockReason(editor);
      if (!reason || !shouldBlockNow(editor, reason)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      announceBlock(editor, reason);
    },
    true,
  );
})();