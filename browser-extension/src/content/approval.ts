// 이 탭의 승인 요청 흐름: 요청 → 대기(상태 확인) → 승인 수령 → 한 번 전송.
//
// - 서버와의 통신은 백그라운드가 합니다. 여기서는 범주 ID·업무 목적·사유만 메시지로 넘기고, 입력 원문은 넘기지 않습니다.
// - "승인받은 내용과 지금 보내는 내용이 같은가"는 이 탭의 메모리에서만 비교합니다. 요청할 때 입력 내용의 지문을
//   (탭마다 무작위인 값을 섞어) 계산해 두고, 보낼 때 다시 계산해 같을 때만 허용합니다. 지문은 서버로 보내지 않으며 저장하지 않습니다.
// - 승인은 한 번만 씁니다. 관리자가 승인한 것을 확인하면 곧바로 서버에 "사용"을 알려(수령) 서버에서도 다시 쓸 수 없게 하고,
//   보내는 순간 이 탭에서도 지웁니다.
import {
  APPROVAL_MESSAGE,
  readApprovalReply,
  sanitizeNote,
  type ApprovalPurpose,
  type ApprovalReply,
} from "../shared/approval.ts";
import { readEditorText } from "./editable.ts";
import { feature, state } from "./state.ts";
import type { Editor } from "./types.ts";

export type ApprovalPhase = "PENDING" | "READY" | "REJECTED" | "EXPIRED";

export interface ApprovalEntry {
  id: string;
  phase: ApprovalPhase;
  // 대기 중에는 요청 만료 시각, 수령한 뒤에는 승인 유효 시각(ms)
  expiresAt: number;
  // 관리자가 남긴 처리 메모
  note: string;
  fingerprint: string;
  categoriesKey: string;
}

export interface ApprovalView {
  text: string;
  canRequest: boolean;
}

export const POLL_INTERVAL_MS = 5000;

const SALT = (() => {
  try {
    const bytes = new Uint32Array(2);
    crypto.getRandomValues(bytes);
    return `${bytes[0]}.${bytes[1]}`;
  } catch {
    return String(Math.random());
  }
})();

// 변경 감지용 해시(cyrb53). 보안 해시가 아니며, 지문은 이 탭 안에서 두 값을 비교하는 데만 씁니다.
function cyrb53(text: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function fingerprint(text: string): string {
  const salted = `${SALT}\n${text}`;
  return `${cyrb53(salted, 0).toString(36)}.${cyrb53(salted, 1).toString(36)}.${text.length}`;
}

const categoriesKey = (categories: readonly string[]): string => [...new Set(categories)].sort().join(",");

let busy = false;
let lastError = "";
let timer = 0;
const listeners = new Set<() => void>();

// 상태가 바뀌면(승인·거절·만료·오류) 안내창을 다시 그리도록 알립니다.
export function onApprovalChange(listener: () => void): void {
  listeners.add(listener);
}

function notify(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // 화면 갱신 실패가 승인 흐름을 멈추면 안 됩니다.
    }
  }
}

export function resetApproval(): void {
  window.clearInterval(timer);
  timer = 0;
  busy = false;
  lastError = "";
}

// 승인 요청을 쓸 수 있는 설정인지: 서버 연결 + 로컬 정책 적용 + 승인 확인 단계 + 승인 요청 동의가 모두 켜져 있어야 합니다.
export function approvalAvailable(): boolean {
  return (
    state.serverEnabled && feature("enforcePolicy") && feature("requireConfirm") && feature("requestApproval")
  );
}

function ask(message: Record<string, unknown>): Promise<ApprovalReply | null> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: APPROVAL_MESSAGE, ...message }, (response: unknown) => {
        void chrome.runtime.lastError;
        resolve(readApprovalReply(response));
      });
    } catch {
      resolve(null);
    }
  });
}

const matchesCurrent = (entry: ApprovalEntry, editor: Editor | null, categories: readonly string[]): boolean =>
  Boolean(
    editor &&
      editor.isConnected &&
      entry.categoriesKey === categoriesKey(categories) &&
      entry.fingerprint === fingerprint(readEditorText(editor)),
  );

// 안내창에 보여 줄 승인 상태입니다. 승인 요청을 쓸 수 없는 설정이면 null(기존 안내 그대로).
export function approvalView(editor: Editor | null, categories: readonly string[]): ApprovalView | null {
  if (!approvalAvailable()) return null;
  const withError = (text: string): string => (lastError ? `${text} (${lastError})` : text);
  if (busy) return { text: "승인 요청을 보내는 중입니다…", canRequest: false };

  const entry = state.approval;
  if (!entry) {
    return { text: withError("관리자 승인이 필요합니다. 업무 목적을 고르고 승인을 요청하세요."), canRequest: true };
  }
  if (entry.phase !== "EXPIRED" && !matchesCurrent(entry, editor, categories)) {
    return {
      text: "승인을 요청한 뒤 입력 내용이 바뀌었습니다. 승인은 요청한 내용에만 유효하므로 바뀐 내용으로 다시 요청해야 합니다.",
      canRequest: true,
    };
  }
  if (entry.phase === "READY" && Date.now() >= entry.expiresAt) {
    entry.phase = "EXPIRED";
  }
  switch (entry.phase) {
    case "PENDING":
      return { text: withError("승인 대기 중입니다. 관리자가 처리하면 이 안내가 바뀝니다. 내용을 바꾸지 마세요."), canRequest: false };
    case "READY":
      return { text: "승인되었습니다. 내용을 바꾸지 말고 보내기를 다시 누르면 한 번 전송됩니다.", canRequest: false };
    case "REJECTED":
      return {
        text: `거절되었습니다.${entry.note ? ` (${entry.note})` : ""} 내용을 고치거나 사유를 보강해 다시 요청할 수 있습니다.`,
        canRequest: true,
      };
    default:
      return { text: withError("승인 요청이 만료되었습니다. 다시 요청해 주세요."), canRequest: true };
  }
}

// 승인을 요청합니다. 요청하는 순간의 입력 내용 지문을 이 탭에만 기억합니다.
export async function requestApproval(
  editor: Editor | null,
  categories: readonly string[],
  purpose: ApprovalPurpose,
  note: string,
): Promise<void> {
  if (busy || !approvalAvailable() || !editor || !editor.isConnected || categories.length === 0) return;

  const print = fingerprint(readEditorText(editor));
  const key = categoriesKey(categories);
  busy = true;
  lastError = "";
  notify();

  const reply = await ask({ op: "create", categories: [...categories], purpose, note: sanitizeNote(note) });
  busy = false;
  if (!reply) {
    lastError = "확장 프로그램과 통신하지 못했습니다";
  } else if (!reply.ok) {
    lastError = reply.error;
  } else {
    state.approval = { id: reply.id, phase: "PENDING", expiresAt: reply.expiresAt, note: "", fingerprint: print, categoriesKey: key };
    startPolling();
  }
  notify();
}

function startPolling(): void {
  window.clearInterval(timer);
  timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
}

function stopPolling(): void {
  window.clearInterval(timer);
  timer = 0;
}

function settle(entry: ApprovalEntry, phase: ApprovalPhase, note = ""): void {
  entry.phase = phase;
  entry.note = note;
  stopPolling();
  notify();
}

// 대기 중인 요청의 상태를 확인합니다. 승인된 것을 보면 곧바로 사용(수령)을 알려 서버에서도 한 번만 쓰게 합니다.
export async function poll(): Promise<void> {
  const entry = state.approval;
  if (!entry || entry.phase !== "PENDING") {
    stopPolling();
    return;
  }
  if (Date.now() >= entry.expiresAt) {
    settle(entry, "EXPIRED");
    return;
  }

  const reply = await ask({ op: "status", id: entry.id });
  if (state.approval !== entry || entry.phase !== "PENDING") return;
  if (!reply) return; // 일시적인 실패는 다음 주기에 다시 확인합니다
  if (!reply.ok) {
    if (reply.http === 404) settle(entry, "EXPIRED");
    return;
  }

  if (reply.status === "REJECTED") {
    settle(entry, "REJECTED", reply.note);
  } else if (reply.status === "EXPIRED" || reply.status === "CONSUMED") {
    settle(entry, "EXPIRED");
  } else if (reply.status === "APPROVED") {
    const claimed = await ask({ op: "consume", id: entry.id });
    if (state.approval !== entry || entry.phase !== "PENDING") return;
    if (claimed && claimed.ok) {
      entry.expiresAt = claimed.expiresAt;
      settle(entry, "READY");
    } else if (claimed && !claimed.ok && (claimed.http === 409 || claimed.http === 404)) {
      settle(entry, "EXPIRED");
    }
    // 통신 실패면 대기 상태를 유지하고 다음 주기에 다시 시도합니다
  }
}

// 보내려는 순간에 부릅니다. 수령한 승인이 있고, 유효하며, 요청한 내용과 같을 때만 true이고 이때 승인을 지웁니다(한 번만).
export function approvalGrantsSend(editor: Editor | null, categories: readonly string[]): boolean {
  const entry = state.approval;
  if (!approvalAvailable() || !entry || entry.phase !== "READY") return false;
  if (Date.now() >= entry.expiresAt) {
    entry.phase = "EXPIRED";
    return false;
  }
  if (!matchesCurrent(entry, editor, categories)) return false;
  state.approval = null;
  stopPolling();
  return true;
}
