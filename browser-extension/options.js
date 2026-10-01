// 설정 저장: chrome.storage.local만 사용. 서버 전송 없음.
const DEFAULTS = {
  enabled: { government_id: true, phone_number: true, email: true, api_key: true },
  maskStyle: "placeholder",
  // 이름과 기본값은 content.js의 DEFAULT_FEATURES와 같아야 합니다.
  // 차단·승인·정책·감사 기록은 기본 꺼짐이 원칙입니다.
  features: {
    persistentAlert: true,
    autoCloseWhenClean: true,
    resultAutoHideMs: 8000,
    noticePosition: "top-right",
    undoButton: true,
    auditLog: false,
    enforcePolicy: false,
    blockSend: false,
    requireConfirm: false,
  },
};

const BOOL_FEATURES = [
  "persistentAlert",
  "autoCloseWhenClean",
  "undoButton",
  "auditLog",
  "enforcePolicy",
  "blockSend",
  "requireConfirm",
];

// 감사 기록에는 원문 대신 범주 ID만 들어옵니다. 화면에서는 한글 이름으로 바꿔 보여줍니다.
const CATEGORY_LABELS = {
  government_id: "주민등록번호",
  phone_number: "전화번호",
  email: "이메일",
  api_key: "API 키",
};

const ACTION_LABELS = {
  ALLOW: "허용(ALLOW)",
  MASK: "마스킹(MASK)",
  REQUIRE_APPROVAL: "승인 검토(REQUIRE_APPROVAL)",
  BLOCK: "차단(BLOCK)",
};

function labelForCategory(category) {
  return CATEGORY_LABELS[category] || category;
}

async function load() {
  const data = await chrome.storage.local.get(DEFAULTS);
  for (const [k, v] of Object.entries(data.enabled)) {
    const el = document.getElementById("c-" + k);
    if (el) el.checked = !!v;
  }

  // 기존 사용자에게는 features 키가 없을 수 있습니다. DEFAULTS를 기준으로 채웁니다.
  const features = Object.assign({}, DEFAULTS.features, data.features || {});
  for (const name of BOOL_FEATURES) {
    const el = document.getElementById("f-" + name);
    if (el) el.checked = features[name] === true;
  }
  const position = document.querySelector(
    `input[name="noticePosition"][value="${features.noticePosition}"]`,
  );
  if (position) position.checked = true;

  const mask = document.querySelector(
    `input[name="mask"][value="${data.maskStyle || DEFAULTS.maskStyle}"]`,
  );
  if (mask) mask.checked = true;
}

async function save() {
  const enabled = {};
  for (const k of Object.keys(DEFAULTS.enabled)) {
    const el = document.getElementById("c-" + k);
    enabled[k] = el ? el.checked : true;
  }

  const features = Object.assign({}, DEFAULTS.features);
  for (const name of BOOL_FEATURES) {
    const el = document.getElementById("f-" + name);
    if (el) features[name] = el.checked === true;
  }
  const position = document.querySelector('input[name="noticePosition"]:checked');
  if (position) features.noticePosition = position.value;

  const mask = document.querySelector('input[name="mask"]:checked');
  const maskStyle = mask ? mask.value : DEFAULTS.maskStyle;

  await chrome.storage.local.set({ enabled, features, maskStyle });
}

// 최근 20건을 최신순으로 그립니다. 표에는 시각·조치·범주 ID만 들어갑니다.
async function renderHistory() {
  const { history } = await chrome.storage.local.get({ history: [] });
  const rows = Array.isArray(history) ? history.slice().reverse() : [];
  const table = document.getElementById("audit");
  const body = document.getElementById("audit-body");
  const empty = document.getElementById("audit-empty");

  body.textContent = "";
  table.hidden = rows.length === 0;
  empty.hidden = rows.length > 0;

  for (const entry of rows) {
    if (!entry || typeof entry !== "object") continue;
    const tr = document.createElement("tr");

    const time = document.createElement("td");
    time.textContent = new Date(Number(entry.at) || 0).toLocaleString();

    const action = document.createElement("td");
    const actionKey = typeof entry.action === "string" ? entry.action : "";
    action.textContent = ACTION_LABELS[actionKey] || actionKey || "—";

    const categories = document.createElement("td");
    const list = Array.isArray(entry.categories) ? entry.categories : [];
    categories.textContent = list.length
      ? list.map(labelForCategory).join(", ")
      : "—";

    tr.append(time, action, categories);
    body.append(tr);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  load();
  renderHistory();
  document
    .querySelectorAll('input[type="checkbox"], input[type="radio"]')
    .forEach((el) =>
      el.addEventListener("change", () => {
        save();
        if (el.id === "f-auditLog") renderHistory();
      }),
    );
  document.getElementById("clear").addEventListener("click", async () => {
    await chrome.storage.local.remove(["history", "lastAction"]);
    await renderHistory();
    alert("로컬 기록을 삭제했습니다.");
  });
  // 다른 탭이나 페이지(내용 변경 스크립트)가 기록을 남기면 표시를 갱신합니다.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && Object.prototype.hasOwnProperty.call(changes, "history")) {
      renderHistory();
    }
  });
});
