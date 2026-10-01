// 승인 요청에 쓰는 공통 정의입니다. 콘텐츠 스크립트(요청·상태 확인)와 백그라운드(서버 호출)가 함께 씁니다.
//
// 서버로 가는 것: 감지된 범주 ID, 업무 목적(고정 선택지), 사용자가 직접 쓴 짧은 사유뿐입니다.
// 입력 원문, 파일 이름, 사이트 주소, 내용의 해시는 보내지 않습니다. "승인받은 내용과 지금 보내는 내용이 같은가"는
// 이 브라우저(탭 메모리) 안에서만 비교합니다.

export const APPROVAL_MESSAGE = "gateway:approval";

export const APPROVAL_PURPOSES = [
  { id: "customer_response", label: "고객 응대" },
  { id: "document_review", label: "문서 검토" },
  { id: "code_work", label: "코드 작업" },
  { id: "data_analysis", label: "데이터 분석" },
  { id: "other", label: "기타" },
] as const;
export type ApprovalPurpose = (typeof APPROVAL_PURPOSES)[number]["id"];

export const APPROVAL_NOTE_MAX = 100;
export const APPROVAL_ID = /^[0-9a-f]{32}$/;

export type ApprovalServerStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "CONSUMED";
const SERVER_STATUSES: ReadonlySet<string> = new Set(["PENDING", "APPROVED", "REJECTED", "EXPIRED", "CONSUMED"]);

export function isApprovalPurpose(value: unknown): value is ApprovalPurpose {
  return typeof value === "string" && APPROVAL_PURPOSES.some((purpose) => purpose.id === value);
}

export function isServerStatus(value: unknown): value is ApprovalServerStatus {
  return typeof value === "string" && SERVER_STATUSES.has(value);
}

// 사유는 제어 문자를 빼고 앞뒤 공백을 정리해 100자로 자릅니다.
export function sanitizeNote(value: unknown): string {
  if (typeof value !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, APPROVAL_NOTE_MAX);
}

// 콘텐츠 스크립트 → 백그라운드
export type ApprovalRequestMessage =
  | { type: typeof APPROVAL_MESSAGE; op: "create"; categories: string[]; purpose: ApprovalPurpose; note: string }
  | { type: typeof APPROVAL_MESSAGE; op: "status"; id: string }
  | { type: typeof APPROVAL_MESSAGE; op: "consume"; id: string };

// 백그라운드 → 콘텐츠 스크립트. 실패하면 사용자에게 보여 줄 문구와 서버의 HTTP 상태(있으면)를 줍니다.
export type ApprovalReply =
  | { ok: true; id: string; status: ApprovalServerStatus; expiresAt: number; note: string }
  | { ok: false; error: string; http?: number };

// 응답이 올바른 모양인지 한 번 더 확인합니다(다른 확장 화면이나 오래된 백그라운드가 보낸 값도 믿지 않습니다).
export function readApprovalReply(value: unknown): ApprovalReply | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (data.ok === true) {
    if (typeof data.id !== "string" || !APPROVAL_ID.test(data.id)) return null;
    if (!isServerStatus(data.status)) return null;
    if (typeof data.expiresAt !== "number" || !Number.isFinite(data.expiresAt)) return null;
    return { ok: true, id: data.id, status: data.status, expiresAt: data.expiresAt, note: sanitizeNote(data.note) };
  }
  if (data.ok === false && typeof data.error === "string") {
    return {
      ok: false,
      error: data.error.slice(0, 200),
      ...(typeof data.http === "number" ? { http: data.http } : {}),
    };
  }
  return null;
}
