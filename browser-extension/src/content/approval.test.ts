// 승인 흐름(콘텐츠 스크립트 쪽): 요청 → 대기 → 승인 수령 → 한 번 전송, 그리고 내용이 바뀌면 무효.
// 백그라운드와 서버는 메시지 응답으로 흉내 냅니다. 입력창·안내창·전송 차단은 jsdom에서 실제로 돌립니다.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { policy } from "../engine/policy.ts";
import { APPROVAL_MESSAGE, type ApprovalReply, type ApprovalServerStatus } from "../shared/approval.ts";
import type { Features } from "../shared/settings.ts";
import { installChromeStub, type ChromeStub } from "../test/chromeStub.ts";
import {
  installEngines,
  noticeHost,
  noticePart,
  noticeTitle,
  openShadowRoots,
  removeEngines,
  resetContentState,
} from "../test/contentEnv.ts";
import { approvalAvailable, approvalGrantsSend, approvalView, POLL_INTERVAL_MS, poll, requestApproval } from "./approval.ts";
import { handleEditorEvent } from "./flow.ts";
import { installSendGuard } from "./sendGuard.ts";
import { state } from "./state.ts";

const API_KEY = "sk-TESTTESTTESTTESTTEST";
const ID = "cd".repeat(16);
const APPROVAL_TITLE = "전송을 막았습니다 — 관리자 승인 필요";
const ON: Partial<Features> = { enforcePolicy: true, requireConfirm: true, requestApproval: true };

let restoreShadow: () => void;
beforeAll(() => {
  restoreShadow = openShadowRoots();
  document.addEventListener("input", handleEditorEvent, true);
  installSendGuard();
});
afterAll(() => {
  restoreShadow();
  document.removeEventListener("input", handleEditorEvent, true);
});

// 가짜 서버: 백그라운드가 돌려줄 응답을 테스트가 정합니다.
const server = {
  status: "PENDING" as ApprovalServerStatus,
  note: "",
  expiresAt: 0,
  createError: null as ApprovalReply | null,
  consumeReply: null as ApprovalReply | null,
  statusReply: null as ApprovalReply | null,
  messages: [] as Array<Record<string, unknown>>,
};

let stub: ChromeStub;

function setup(features: Partial<Features> = ON, serverEnabled = true): void {
  stub = installChromeStub();
  installEngines();
  // 탐지기가 내는 범주는 모두 등록돼 있으므로, 승인 대상이 나오도록 정책 엔진만 바꿔 끼웁니다.
  (globalThis as Record<string, unknown>).AIInputGatewayPolicy = { ...policy, decide: () => ({ action: "REQUIRE_APPROVAL", reasonCodes: [] }) };
  resetContentState(features);
  state.serverEnabled = serverEnabled;
  Object.assign(server, { status: "PENDING", note: "", expiresAt: Date.now() + 4 * 3600_000, createError: null, consumeReply: null, statusReply: null, messages: [] });
  stub.sendMessage.mockImplementation((message: unknown, callback?: (response: unknown) => void) => {
    const value = message as Record<string, unknown>;
    if (value.type !== APPROVAL_MESSAGE) {
      callback?.(undefined);
      return;
    }
    server.messages.push(value);
    let reply: ApprovalReply;
    if (value.op === "create") {
      reply = server.createError ?? { ok: true, id: ID, status: "PENDING", expiresAt: server.expiresAt, note: "" };
    } else if (value.op === "status") {
      reply = server.statusReply ?? { ok: true, id: ID, status: server.status, expiresAt: server.expiresAt, note: server.note };
    } else {
      reply = server.consumeReply ?? { ok: true, id: ID, status: "CONSUMED", expiresAt: server.expiresAt, note: "" };
    }
    callback?.(reply);
  });
}

interface Page {
  area: HTMLTextAreaElement;
  send: HTMLButtonElement;
  submitted: () => number;
}

function buildPage(value = `키 ${API_KEY}`): Page {
  document.body.innerHTML = '<form id="f"><textarea id="t"></textarea><button id="s" type="submit">보내기</button></form>';
  const form = document.getElementById("f") as HTMLFormElement;
  const area = document.getElementById("t") as HTMLTextAreaElement;
  let count = 0;
  form.addEventListener("submit", (event) => {
    count += 1;
    event.preventDefault();
  });
  area.value = value;
  area.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
  return { area, send: document.getElementById("s") as HTMLButtonElement, submitted: () => count };
}

function typeText(page: Page, value: string): void {
  page.area.value = value;
  page.area.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
}

function pressEnter(page: Page): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  page.area.dispatchEvent(event);
  return event;
}

const flush = () => vi.advanceTimersByTimeAsync(0);
const ops = () => server.messages.map((message) => message.op);

// 안내창의 "승인 요청 보내기"를 사용자가 누른 것처럼 합니다.
async function clickRequest(purpose = "customer_response", note = "고객 답변 초안"): Promise<void> {
  const select = noticePart<HTMLSelectElement>(".approval-purpose")!;
  select.value = purpose;
  noticePart<HTMLInputElement>(".approval-note")!.value = note;
  noticePart<HTMLButtonElement>(".approval-button")!.click();
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  removeEngines();
});

describe("승인 요청을 쓸 수 있는 조건", () => {
  it.each([
    ["기본(모두 꺼짐)", {}, true, false],
    ["서버가 연결되지 않음", ON, false, false],
    ["승인 요청 동의가 꺼짐", { ...ON, requestApproval: false }, true, false],
    ["로컬 정책 적용이 꺼짐", { ...ON, enforcePolicy: false }, true, false],
    ["승인 확인 단계가 꺼짐", { ...ON, requireConfirm: false }, true, false],
    ["모두 켜짐", ON, true, true],
  ] as const)("%s", (_name, features, connected, expected) => {
    setup(features, connected);
    expect(approvalAvailable()).toBe(expected);
  });

  it("조건이 안 되면 기존 방식(5초 안에 다시 누르면 전송)을 그대로 쓴다", () => {
    setup({ enforcePolicy: true, requireConfirm: true });
    const page = buildPage();
    expect(pressEnter(page).defaultPrevented).toBe(true);
    expect(noticePart(".approval")).toBeNull();
    expect(pressEnter(page).defaultPrevented).toBe(false);
  });
});

describe("전송 차단과 안내창", () => {
  it("승인 없이는 계속 막고(다시 눌러도 통과하지 않음), 요청 양식을 보여 준다", () => {
    setup();
    const page = buildPage();
    expect(pressEnter(page).defaultPrevented).toBe(true);
    expect(noticeTitle()).toBe(APPROVAL_TITLE);
    expect(noticePart(".approval-purpose")).not.toBeNull();
    expect(noticePart(".approval-text")?.textContent).toContain("관리자 승인이 필요합니다");
    // 기존 REQUIRE_APPROVAL처럼 한 번 더 눌러도 통과하지 않는다
    expect(pressEnter(page).defaultPrevented).toBe(true);
    page.send.click();
    expect(page.submitted()).toBe(0);
  });

  it("감지만 되어도(전송 전) 안내창에 요청 양식이 함께 뜬다", () => {
    setup();
    buildPage();
    expect(noticePart(".approval-form")).not.toBeNull();
    expect(noticePart(".approval-hint")?.textContent).toContain("입력한 글은 보내지 않습니다");
  });

  it("승인 대상이 아닌 입력(감지 없음)은 막지 않는다", () => {
    setup();
    const page = buildPage("안녕하세요");
    expect(pressEnter(page).defaultPrevented).toBe(false);
  });
});

describe("요청 → 승인 → 한 번 전송", () => {
  it("요청 메시지에는 범주 ID·목적·사유만 있고 입력 원문이 없다", async () => {
    setup();
    const page = buildPage();
    pressEnter(page);
    await clickRequest("document_review", "계약서 비교");
    const create = server.messages[0]!;
    expect(create).toMatchObject({ op: "create", categories: ["api_key"], purpose: "document_review", note: "계약서 비교" });
    expect(Object.keys(create).sort()).toEqual(["categories", "note", "op", "purpose", "type"]);
    expect(JSON.stringify(server.messages)).not.toContain(API_KEY);
    expect(noticePart(".approval-text")?.textContent).toContain("승인 대기 중");
    expect(noticePart(".approval-form")).toBeNull();
  });

  it("승인되면 수령(사용 처리)하고, 안내가 바뀌고, 다음 전송 한 번만 통과한다", async () => {
    setup();
    const page = buildPage();
    pressEnter(page);
    await clickRequest();
    expect(ops()).toEqual(["create"]);

    // 대기 중에는 계속 막힌다
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(ops()).toEqual(["create", "status"]);
    expect(pressEnter(page).defaultPrevented).toBe(true);

    server.status = "APPROVED";
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(ops()).toEqual(["create", "status", "status", "consume"]);
    expect(state.approval?.phase).toBe("READY");
    expect(noticePart(".approval-text")?.textContent).toContain("승인되었습니다");

    // 한 번 통과
    expect(pressEnter(page).defaultPrevented).toBe(false);
    expect(state.approval).toBeNull();
    // 같은 내용으로 다시 보내려면 다시 승인을 받아야 한다
    expect(pressEnter(page).defaultPrevented).toBe(true);
    // 더 이상 상태를 묻지 않는다
    const before = server.messages.length;
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(server.messages).toHaveLength(before);
  });

  it("클릭으로 보내도 한 번 통과하고, 이어서 오는 제출 이벤트도 막지 않는다", async () => {
    setup();
    const page = buildPage();
    pressEnter(page);
    await clickRequest();
    server.status = "APPROVED";
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    page.send.click();
    expect(page.submitted()).toBe(1);
  });

  it("요청한 뒤 내용이 바뀌면 승인되어도 통과하지 않고, 바뀐 내용으로 다시 요청하게 한다", async () => {
    setup();
    const page = buildPage();
    pressEnter(page);
    await clickRequest();
    server.status = "APPROVED";
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    typeText(page, `다른 키 ${API_KEY}9`);
    expect(pressEnter(page).defaultPrevented).toBe(true);
    expect(noticePart(".approval-text")?.textContent).toContain("입력 내용이 바뀌었습니다");
    expect(noticePart(".approval-form")).not.toBeNull();

    // 원래 내용으로 돌려놓으면 같은 승인이 다시 유효하다
    typeText(page, `키 ${API_KEY}`);
    expect(pressEnter(page).defaultPrevented).toBe(false);
  });

  it("같은 길이로 한 글자만 바꿔도 다른 내용으로 본다", async () => {
    setup();
    const page = buildPage(`키 ${API_KEY}`);
    pressEnter(page);
    await clickRequest();
    server.status = "APPROVED";
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    typeText(page, `키 ${API_KEY.replace("TEST", "TESX")}`);
    expect(pressEnter(page).defaultPrevented).toBe(true);
  });

  it("거절되면 처리 메모를 보여 주고 다시 요청할 수 있다", async () => {
    setup();
    const page = buildPage();
    pressEnter(page);
    await clickRequest();
    server.status = "REJECTED";
    server.note = "사유를 더 적어 주세요";
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(pressEnter(page).defaultPrevented).toBe(true);
    expect(noticePart(".approval-text")?.textContent).toContain("거절되었습니다. (사유를 더 적어 주세요)");
    expect(noticePart(".approval-form")).not.toBeNull();
    // 더는 상태를 묻지 않는다
    const before = server.messages.length;
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    expect(server.messages).toHaveLength(before);
  });

  it("수령한 승인도 유효 시간이 지나면 쓸 수 없다", async () => {
    setup();
    const page = buildPage();
    pressEnter(page);
    server.expiresAt = Date.now() + 60_000;
    await clickRequest();
    server.status = "APPROVED";
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(state.approval?.phase).toBe("READY");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pressEnter(page).defaultPrevented).toBe(true);
    expect(state.approval?.phase).toBe("EXPIRED");
  });

  it("대기 중인 요청이 만료 시각을 넘기면 만료로 본다", async () => {
    setup();
    const page = buildPage();
    pressEnter(page);
    server.expiresAt = Date.now() + 8_000;
    await clickRequest();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    expect(state.approval?.phase).toBe("EXPIRED");
    expect(noticePart(".approval-text")?.textContent).toContain("만료");
  });
});

describe("서버가 응답하지 않거나 이상할 때", () => {
  it("요청 실패는 안내하고 막은 채로 둔다(서버 장애로 통과시키지 않는다)", async () => {
    setup();
    const page = buildPage();
    pressEnter(page);
    server.createError = { ok: false, error: "서버에 연결하지 못했습니다." };
    await clickRequest();
    expect(state.approval).toBeNull();
    expect(noticePart(".approval-text")?.textContent).toContain("서버에 연결하지 못했습니다.");
    expect(noticePart(".approval-form")).not.toBeNull();
    expect(pressEnter(page).defaultPrevented).toBe(true);
  });

  it("백그라운드가 응답하지 않아도(null) 오류로 안내한다", async () => {
    setup();
    const page = buildPage();
    pressEnter(page);
    stub.sendMessage.mockImplementation((_message: unknown, callback?: (response: unknown) => void) => callback?.(undefined));
    await clickRequest();
    expect(state.approval).toBeNull();
    expect(noticePart(".approval-text")?.textContent).toContain("통신하지 못했습니다");
  });

  it("상태 확인이 일시적으로 실패해도 대기를 유지하고 다음 주기에 다시 묻는다", async () => {
    setup();
    const page = buildPage();
    pressEnter(page);
    await clickRequest();
    server.statusReply = { ok: false, error: "서버에 연결하지 못했습니다." };
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(state.approval?.phase).toBe("PENDING");
    server.statusReply = null;
    server.status = "APPROVED";
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(state.approval?.phase).toBe("READY");
  });

  it("서버가 요청을 찾지 못하면(404) 만료로 본다", async () => {
    setup();
    const page = buildPage();
    pressEnter(page);
    await clickRequest();
    server.statusReply = { ok: false, error: "없음", http: 404 };
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(state.approval?.phase).toBe("EXPIRED");
  });

  it("수령(사용 처리)이 이미 사용·만료(409)면 통과시키지 않는다", async () => {
    setup();
    const page = buildPage();
    pressEnter(page);
    await clickRequest();
    server.status = "APPROVED";
    server.consumeReply = { ok: false, error: "이미 사용", http: 409 };
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(state.approval?.phase).toBe("EXPIRED");
    expect(pressEnter(page).defaultPrevented).toBe(true);
  });

  it("수령 중 통신이 끊기면 대기를 유지하고 다시 시도한다", async () => {
    setup();
    const page = buildPage();
    pressEnter(page);
    await clickRequest();
    server.status = "APPROVED";
    server.consumeReply = { ok: false, error: "서버에 연결하지 못했습니다." };
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(state.approval?.phase).toBe("PENDING");
    server.consumeReply = null;
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(state.approval?.phase).toBe("READY");
  });

  it("이미 사용된 상태(CONSUMED)로 보이면 이 탭의 승인이 아니므로 통과시키지 않는다", async () => {
    setup();
    const page = buildPage();
    pressEnter(page);
    await clickRequest();
    server.status = "CONSUMED";
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(state.approval?.phase).toBe("EXPIRED");
  });
});

describe("중복 요청과 설정 변경", () => {
  it("요청을 보내는 동안 다시 눌러도 한 번만 보낸다", async () => {
    setup();
    const page = buildPage();
    pressEnter(page);
    const editor = page.area;
    const first = requestApproval(editor, ["api_key"], "other", "");
    const second = requestApproval(editor, ["api_key"], "other", "");
    await Promise.all([first, second]);
    await flush();
    expect(ops().filter((op) => op === "create")).toHaveLength(1);
  });

  it("승인 요청을 끄면 받아 둔 승인이 있어도 쓰지 않는다", async () => {
    setup();
    const page = buildPage();
    pressEnter(page);
    await clickRequest();
    server.status = "APPROVED";
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(state.approval?.phase).toBe("READY");
    state.features = { ...state.features, requestApproval: false };
    expect(approvalGrantsSend(page.area, ["api_key"])).toBe(false);
    expect(approvalView(page.area, ["api_key"])).toBeNull();
  });

  it("탐지된 범주가 달라지면 같은 글이어도 다른 요청으로 본다", async () => {
    setup();
    const page = buildPage();
    pressEnter(page);
    await clickRequest();
    server.status = "APPROVED";
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(approvalGrantsSend(page.area, ["api_key", "email"])).toBe(false);
    expect(approvalGrantsSend(page.area, ["api_key"])).toBe(true);
  });

  it("승인 대상이 없는 입력에서는 요청을 보내지 않는다", async () => {
    setup();
    const page = buildPage("안녕하세요");
    await requestApproval(page.area, [], "other", "");
    expect(server.messages).toEqual([]);
  });

  it("직접 poll을 불러도 대기 중이 아니면 아무것도 묻지 않는다", async () => {
    setup();
    await poll();
    expect(server.messages).toEqual([]);
    expect(noticeHost()).toBeNull();
  });
});
