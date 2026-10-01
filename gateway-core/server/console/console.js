// PDP 관리 콘솔. 서버가 내려주는 정적 화면이며, 데이터는 /v1 API로만 가져옵니다.
//  - 관리자 키는 이 스크립트의 메모리에만 두고 저장하지 않습니다(새로고침하면 다시 입력).
//  - 서버에서 온 값(요청자가 쓴 메모 등)은 사람이 쓴 글이므로 절대 HTML로 해석하지 않고 textContent로만 그립니다.
"use strict";

const CATEGORY_LABELS = {
  government_id: "주민등록번호",
  phone_number: "전화번호",
  email: "이메일",
  api_key: "API 키",
  credit_card: "카드번호",
  bank_account: "계좌번호",
  passport_number: "여권번호",
  driver_license: "운전면허번호",
  password: "비밀번호",
};
// 서버가 새 정책 버전에서도 약화를 거부하는 범주입니다(policies.py의 LOCKED_BLOCK_CATEGORIES와 같아야 합니다).
const LOCKED = new Set(["api_key", "credit_card", "password"]);
const ACTIONS = ["ALLOW", "MASK", "REQUIRE_APPROVAL", "BLOCK"];
const ACTION_TEXT = { ALLOW: "허용", MASK: "마스킹", REQUIRE_APPROVAL: "승인 검토", BLOCK: "차단 판정" };
const STATUS_TEXT = { PENDING: "대기", APPROVED: "승인됨", REJECTED: "거절됨", EXPIRED: "만료", CONSUMED: "사용됨" };
const PURPOSE_TEXT = {
  customer_response: "고객 응대",
  document_review: "문서 검토",
  code_work: "코드 작업",
  data_analysis: "데이터 분석",
  other: "기타",
};
const CHANNEL_TEXT = { prompt: "입력", file: "파일" };
const REFRESH_MS = 15000;

const state = { key: "", tab: "approvals", filter: "PENDING", timer: 0, token: 0 };

const $ = (selector) => document.querySelector(selector);

// 요소 만들기. 문자열 자식은 항상 텍스트 노드가 됩니다.
function h(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(props || {})) {
    if (name === "class") node.className = value;
    else if (name.startsWith("on")) node.addEventListener(name.slice(2), value);
    else if (value === true) node.setAttribute(name, "");
    else if (value !== false && value != null) node.setAttribute(name, String(value));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function formatTime(ms) {
  return ms ? new Date(ms).toLocaleString("ko-KR") : "-";
}

function categoryTags(ids) {
  return (ids || []).map((id) => h("span", { class: "tag", title: id }, CATEGORY_LABELS[id] || id));
}

function say(text, ok) {
  const node = $("#message");
  node.textContent = text || "";
  node.className = "small " + (text ? (ok ? "ok" : "error") : "");
}

// ---- 서버 호출 ----

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: {
      Authorization: "Bearer " + state.key,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (response.status === 401) {
    logout("관리자 키가 올바르지 않거나 관리자 권한이 없습니다.");
    throw new ApiError(401, "인증 실패");
  }
  if (!response.ok) {
    const detail = data && typeof data.detail === "string" ? data.detail : "요청을 처리하지 못했습니다(" + response.status + ").";
    throw new ApiError(response.status, detail);
  }
  return data;
}

// ---- 로그인 ----

function logout(reason) {
  state.key = "";
  state.token += 1;
  window.clearInterval(state.timer);
  $("#app").hidden = true;
  $("#logout").hidden = true;
  $("#login").hidden = false;
  $("#admin-key").value = "";
  $("#login-message").textContent = reason || "";
}

async function login(event) {
  event.preventDefault();
  const key = $("#admin-key").value.trim();
  if (!key) return;
  state.key = key;
  $("#login-message").textContent = "";
  try {
    await api("/v1/admin/policies");
  } catch (error) {
    if (error.status !== 401) {
      state.key = "";
      $("#login-message").textContent = error.message;
    }
    return;
  }
  $("#admin-key").value = "";
  $("#login").hidden = true;
  $("#app").hidden = false;
  $("#logout").hidden = false;
  window.clearInterval(state.timer);
  state.timer = window.setInterval(() => {
    if (state.tab === "approvals" && !document.hidden) void render(true);
  }, REFRESH_MS);
  await selectTab(state.tab);
}

// ---- 탭 ----

async function selectTab(name) {
  state.tab = name;
  for (const button of document.querySelectorAll("#tabs button")) {
    button.setAttribute("aria-selected", String(button.dataset.tab === name));
  }
  say("");
  await render(false);
}

async function render(quiet) {
  const token = (state.token += 1);
  const panel = $("#panel");
  try {
    const nodes = await { approvals: viewApprovals, policy: viewPolicy, audit: viewAudit, events: viewEvents }[state.tab]();
    if (token !== state.token) return; // 그사이 다른 탭을 눌렀거나 로그아웃했으면 버립니다
    panel.replaceChildren(...nodes);
  } catch (error) {
    if (!quiet && error.status !== 401) say(error.message, false);
  }
  void updatePendingBadge();
}

async function updatePendingBadge() {
  try {
    const { approvals } = await api("/v1/approvals?status=PENDING&limit=500");
    const badge = $("#pending-count");
    badge.hidden = approvals.length === 0;
    badge.textContent = String(approvals.length);
  } catch {
    // 배지는 부가 정보입니다.
  }
}

// ---- 승인함 ----

async function viewApprovals() {
  const query = state.filter === "ALL" ? "" : "&status=" + state.filter;
  const { approvals } = await api("/v1/approvals?limit=200" + query);

  const filter = h(
    "select",
    { id: "filter", onchange: (event) => { state.filter = event.target.value; void render(false); } },
    [["PENDING", "대기 중"], ["ALL", "전체"], ["APPROVED", "승인됨"], ["REJECTED", "거절됨"], ["EXPIRED", "만료"], ["CONSUMED", "사용됨"]].map(
      ([value, label]) => h("option", { value, selected: value === state.filter }, label),
    ),
  );

  const rows = approvals.map((item) => {
    const note = h("input", { type: "text", maxlength: "200", placeholder: "처리 메모(선택)", "aria-label": "처리 메모" });
    const decide = (decision) => async (event) => {
      const verb = decision === "approve" ? "승인" : "거절";
      if (!window.confirm("이 요청을 " + verb + "할까요? 승인은 한 번만 쓸 수 있고, 요청한 내용이 그대로일 때만 전송됩니다.")) return;
      event.target.disabled = true;
      try {
        await api("/v1/approvals/" + item.approval_id + "/decision", { method: "POST", body: { decision, note: note.value } });
        say("요청을 " + verb + "했습니다.", true);
      } catch (error) {
        if (error.status !== 401) say(error.message, false);
      }
      await render(false);
    };
    return h(
      "tr",
      {},
      h("td", {}, formatTime(item.created_at)),
      h("td", {}, categoryTags(item.categories), " ", CHANNEL_TEXT[item.channel] || item.channel),
      h("td", {}, PURPOSE_TEXT[item.purpose] || item.purpose),
      h("td", { class: "wrap" }, item.note || "-"),
      h("td", {}, item.requester),
      h("td", {}, h("span", { class: "status " + item.status }, STATUS_TEXT[item.status] || item.status)),
      h("td", {}, formatTime(item.expires_at)),
      h(
        "td",
        {},
        item.status === "PENDING"
          ? h("div", { class: "row" }, note, h("button", { type: "button", onclick: decide("approve") }, "승인"), h("button", { type: "button", class: "danger", onclick: decide("reject") }, "거절"))
          : item.decided_by
            ? h("span", { class: "small" }, item.decided_by + (item.decision_note ? " · " + item.decision_note : ""))
            : "",
      ),
    );
  });

  return [
    h("h2", {}, "승인 요청"),
    h(
      "p",
      { class: "small" },
      "REQUIRE_APPROVAL 판정을 받은 사용자가 보낸 요청입니다. 입력 원문은 서버에 오지 않으며, 감지된 범주·업무 목적·짧은 메모만 보입니다. ",
      "승인된 요청은 한 번만 쓸 수 있고, 사용자가 보내는 내용이 요청 당시와 달라지면 확장이 스스로 무효로 봅니다. 요청한 키와 같은 이름의 관리자 키로는 승인할 수 없습니다.",
    ),
    h("div", { class: "row" }, h("label", {}, "보기 ", filter), h("button", { type: "button", class: "secondary", onclick: () => void render(false) }, "새로고침")),
    approvals.length === 0
      ? h("p", { class: "empty" }, "표시할 요청이 없습니다.")
      : h("div", { class: "table-scroll" }, h("table", {}, h("thead", {}, h("tr", {}, ["요청 시각", "감지 범주", "목적", "메모", "요청 키", "상태", "만료", "처리"].map((name) => h("th", {}, name)))), h("tbody", {}, rows))),
  ];
}

// ---- 정책 ----

function describeChanges(base, draft) {
  const changes = [];
  const ids = new Set([...Object.keys(base.category_actions), ...Object.keys(draft.category_actions)]);
  for (const id of ids) {
    const before = base.category_actions[id];
    const after = draft.category_actions[id];
    if (before !== after) changes.push((CATEGORY_LABELS[id] || id) + ": " + (ACTION_TEXT[before] || "없음") + " → " + (ACTION_TEXT[after] || "없음"));
  }
  if (base.unknown_category_action !== draft.unknown_category_action) {
    changes.push("알 수 없는 범주: " + ACTION_TEXT[base.unknown_category_action] + " → " + ACTION_TEXT[draft.unknown_category_action]);
  }
  if (base.bulk_record_threshold !== draft.bulk_record_threshold) {
    changes.push("대량 기준: " + base.bulk_record_threshold + "행 → " + draft.bulk_record_threshold + "행");
  }
  return changes;
}

async function viewPolicy() {
  const data = await api("/v1/admin/policies");
  const active = data.versions.find((item) => item.version === data.active);
  const versions = [...data.versions].sort((a, b) => b.version - a.version);

  const activate = (version) => async (event) => {
    if (!window.confirm("v" + version + "을(를) 활성 정책으로 지정할까요? 확장 프로그램은 다음 동기화 때(최대 10분 안팎) 받아 갑니다.")) return;
    event.target.disabled = true;
    try {
      await api("/v1/admin/policies/" + version + "/activate", { method: "POST" });
      say("v" + version + "을(를) 활성 정책으로 지정했습니다.", true);
    } catch (error) {
      if (error.status !== 401) say(error.message, false);
    }
    await render(false);
  };

  const historyRows = versions.map((item) =>
    h(
      "tr",
      {},
      h("td", {}, "v" + item.version, " ", item.active ? h("span", { class: "tag active" }, "활성") : ""),
      h("td", { class: "wrap" }, item.description || "-"),
      h("td", {}, Object.entries(item.category_actions).filter(([, action]) => action === "BLOCK").map(([id]) => h("span", { class: "tag" }, CATEGORY_LABELS[id] || id))),
      h("td", {}, String(item.bulk_record_threshold)),
      h("td", {}, item.active ? "" : h("button", { type: "button", class: "secondary", onclick: activate(item.version) }, "이 버전으로 되돌리기")),
    ),
  );

  // 새 버전 양식: 활성 정책을 복사해서 시작합니다.
  const selects = {};
  const grid = h("div", { class: "grid" });
  for (const id of Object.keys(active.category_actions).sort()) {
    const locked = LOCKED.has(id);
    const select = h("select", { "aria-label": CATEGORY_LABELS[id] || id, disabled: locked }, ACTIONS.map((action) => h("option", { value: action, selected: action === active.category_actions[id] }, ACTION_TEXT[action])));
    selects[id] = select;
    grid.append(h("label", {}, h("span", {}, CATEGORY_LABELS[id] || id, locked ? h("span", { class: "tag locked", title: "비밀·결제 정보는 약하게 바꿀 수 없습니다" }, "고정") : ""), select));
  }
  const unknown = h("select", { id: "unknown-action" }, ACTIONS.map((action) => h("option", { value: action, selected: action === active.unknown_category_action }, ACTION_TEXT[action])));
  const threshold = h("input", { id: "threshold", type: "number", min: "1", max: "1000000", value: active.bulk_record_threshold });
  const description = h("input", { id: "description", type: "text", maxlength: "500", placeholder: "무엇을 왜 바꿨는지 한 줄" });
  const activateNow = h("input", { id: "activate-now", type: "checkbox" });

  const save = async (event) => {
    event.preventDefault();
    const draft = {
      description: description.value.trim(),
      category_actions: Object.fromEntries(Object.entries(selects).map(([id, select]) => [id, select.value])),
      unknown_category_action: unknown.value,
      bulk_record_threshold: Number(threshold.value),
      activate: activateNow.checked,
    };
    const changes = describeChanges(active, draft);
    if (changes.length === 0) {
      say("현재 활성 정책과 같아서 새 버전을 만들 필요가 없습니다.", false);
      return;
    }
    const summary = changes.join("\n");
    if (!window.confirm("새 버전을 만들까요?" + (draft.activate ? " (바로 적용됩니다)" : "") + "\n\n" + summary)) return;
    try {
      const created = await api("/v1/admin/policies", { method: "POST", body: draft });
      say("v" + created.version + "을(를) 만들었습니다" + (draft.activate ? " 그리고 적용했습니다." : ". 아래 목록에서 활성으로 지정할 수 있습니다."), true);
    } catch (error) {
      if (error.status !== 401) say(error.message, false);
      return;
    }
    await render(false);
  };

  return [
    h("h2", {}, "정책 버전"),
    h("p", { class: "small" }, "버전은 만든 뒤 바꾸지 않습니다. 정책을 바꾸면 새 버전이 생기고, 문제가 있으면 이전 버전을 다시 활성으로 지정(롤백)합니다. 모든 변경은 '관리 기록'에 남습니다."),
    h("div", { class: "table-scroll" }, h("table", {}, h("thead", {}, h("tr", {}, ["버전", "설명", "차단 판정 범주", "대량 기준(행)", ""].map((name) => h("th", {}, name)))), h("tbody", {}, historyRows))),
    h("h3", {}, "새 버전 만들기 (현재 활성 v" + active.version + "에서 시작)"),
    h("form", { onsubmit: save }, grid,
      h("div", { class: "row" }, h("label", {}, "알 수 없는 범주 ", unknown), h("label", {}, "표에서 이 행 수 이상이면 차단 ", threshold)),
      h("label", { class: "field" }, "변경 설명", description),
      h("label", {}, activateNow, " 만든 뒤 바로 활성 정책으로 적용"),
      h("div", { class: "row" }, h("button", { type: "submit" }, "새 버전 만들기"))),
  ];
}

// ---- 감사 로그 / 관리 기록 ----

function verifyBox(result) {
  const good = result.ok;
  return h(
    "div",
    { class: "verify " + (good ? "good" : "bad"), role: "status" },
    good
      ? "체인 정상: " + result.count + "건, 마지막 번호 " + result.head_seq + ", 마지막 해시 " + result.head_hash
      : "체인이 깨졌습니다 — 번호 " + result.broken_at + ": " + result.reason,
  );
}

async function logView(title, intro, listPath, verifyPath, columns, rowCells) {
  const probe = await api(listPath + "?limit=1");
  const head = probe.head || (await api("/v1/audit/head"));
  const after = Math.max(0, head.seq - 100);
  const data = await api(listPath + "?limit=100&after=" + after);
  const records = [...data.records].reverse();
  const out = h("div", {});
  const check = async (event) => {
    event.target.disabled = true;
    try {
      out.replaceChildren(verifyBox(await api(verifyPath)));
    } catch (error) {
      if (error.status !== 401) say(error.message, false);
    }
    event.target.disabled = false;
  };
  return [
    h("h2", {}, title),
    h("p", { class: "small" }, intro),
    h("p", { class: "small" }, "마지막 번호 ", h("code", {}, String(head.seq)), " · 마지막 해시 ", h("code", {}, head.hash)),
    h("div", { class: "row" }, h("button", { type: "button", onclick: check }, "체인 검증"), h("button", { type: "button", class: "secondary", onclick: () => void render(false) }, "새로고침")),
    out,
    records.length === 0
      ? h("p", { class: "empty" }, "기록이 없습니다.")
      : h("div", { class: "table-scroll" }, h("table", {}, h("thead", {}, h("tr", {}, columns.map((name) => h("th", {}, name)))), h("tbody", {}, records.map((record) => h("tr", {}, rowCells(record).map((cell) => h("td", { class: "wrap" }, cell))))))),
  ];
}

function viewAudit() {
  return logView(
    "감사 로그",
    "확장 프로그램이 보낸 이벤트입니다(최근 100건). 시각·조치·범주 ID·채널·정책 버전만 있고 입력 원문은 없습니다. 마지막 번호와 해시를 서버 밖(관리자 메모 등)에 주기적으로 적어 두면 전체 재계산 변조까지 잡을 수 있습니다.",
    "/v1/audit",
    "/v1/audit/verify",
    ["번호", "받은 시각", "호출 키", "발생 시각", "조치", "범주", "채널", "정책"],
    (record) => [
      String(record.seq),
      formatTime(record.received_at),
      record.caller,
      formatTime(record.event.at),
      ACTION_TEXT[record.event.action] || record.event.action,
      categoryTags(record.event.categories),
      CHANNEL_TEXT[record.event.channel] || record.event.channel,
      record.event.policy_version ? "v" + record.event.policy_version : "-",
    ],
  );
}

function describeEvent(event) {
  switch (event.kind) {
    case "policy.create": return "정책 v" + event.version + " 생성 (v" + event.based_on + " 기반)";
    case "policy.activate": return "정책 v" + event.version + " 활성화 (이전 v" + event.previous + ")";
    case "approval.approve": return "승인 요청 승인";
    case "approval.reject": return "승인 요청 거절";
    default: return event.kind;
  }
}

function viewEvents() {
  return logView(
    "관리 기록",
    "정책 변경과 승인 처리 기록입니다(최근 100건). 감사 로그와 같은 해시 체인이지만 파일은 따로입니다.",
    "/v1/admin/events",
    "/v1/admin/events/verify",
    ["번호", "시각", "관리자 키", "내용", "대상"],
    (record) => [
      String(record.seq),
      formatTime(record.event.at),
      record.caller,
      describeEvent(record.event),
      record.event.categories ? categoryTags(record.event.categories) : record.event.approval_id ? record.event.approval_id.slice(0, 8) : "",
    ],
  );
}

// ---- 시작 ----

$("#login-form").addEventListener("submit", (event) => void login(event));
$("#logout").addEventListener("click", () => logout(""));
$("#tabs").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-tab]");
  if (button) void selectTab(button.dataset.tab);
});
