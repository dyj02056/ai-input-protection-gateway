// 설정 저장: chrome.storage.local만 사용합니다. 입력 내용은 서버로 보내지 않습니다.
// 이름과 기본값은 content.js의 DEFAULT_FEATURES와 같아야 하며(consistency.test.ts가 대조합니다),
// 차단·승인·정책·감사 기록은 기본 꺼짐이 원칙입니다.
import { CATEGORY_IDS, type CategoryId } from "./constants.ts";

export const BOOL_FEATURES = [
  "persistentAlert",
  "autoCloseWhenClean",
  "undoButton",
  "auditLog",
  "enforcePolicy",
  "blockSend",
  "requireConfirm",
  "strictValidation",
  "restoreTokens",
  "inspectFiles",
  "blockFileSend",
  "uploadAudit",
] as const;
export type BoolFeature = (typeof BOOL_FEATURES)[number];

export type NoticePosition = "top-right" | "bottom-left";

export interface Features {
  persistentAlert: boolean;
  autoCloseWhenClean: boolean;
  resultAutoHideMs: number;
  noticePosition: string;
  undoButton: boolean;
  auditLog: boolean;
  enforcePolicy: boolean;
  blockSend: boolean;
  requireConfirm: boolean;
  // 주민등록번호의 생년월일이 달력에 없는 값은 감지하지 않습니다. 기본은 꺼짐입니다
  // (체험용 가짜 번호 000000-1000000이 감지되지 않기 때문입니다).
  strictValidation: boolean;
  // 세션 토큰으로 가렸을 때, 화면에 나온 토큰([전화_1])을 원래 값으로 바꿔 보여줍니다(이 탭에서만, 표시 전용).
  // 끄면 토큰이 그대로 보입니다. 복원한 값은 화면에 있는 동안 사이트의 스크립트가 읽을 수 있는 상태가 됩니다.
  restoreTokens: boolean;
  // 첨부파일(선택·드롭·붙여넣기)의 내용을 이 브라우저 안에서 검사해 알려 줍니다. 파일은 어디로도 보내지 않습니다.
  inspectFiles: boolean;
  // 위험한 첨부파일이 있으면 첫 보내기를 중단합니다(5초 안에 다시 누르면 전송). "로컬 정책 적용"과 함께 켜야 동작합니다.
  blockFileSend: boolean;
  // 조직 정책 서버에 연결했을 때, 감사 이벤트(시각·조치·범주 ID·정책 버전)를 서버로 보냅니다. 입력 원문·파일 이름은 보내지 않습니다.
  // 별도 동의 스위치이며 기본 꺼짐입니다(서버 연결만으로는 켜지지 않습니다).
  uploadAudit: boolean;
}

export type Enabled = Record<CategoryId, boolean>;
export type MaskStyle = "placeholder" | "token";

// 알 수 없는 값은 기본(자리표시자)으로 돌립니다.
export function coerceMaskStyle(raw: unknown): MaskStyle {
  return raw === "token" ? "token" : "placeholder";
}

export interface Settings {
  enabled: Enabled;
  features: Features;
  maskStyle: MaskStyle;
  // 일치해도 무시할 값(회사 대표번호 등). 사용자가 직접 적은 설정값이며 이 브라우저 밖으로 나가지 않습니다.
  allowlist: string[];
}

export const DEFAULT_FEATURES: Readonly<Features> = Object.freeze({
  persistentAlert: true,
  autoCloseWhenClean: true,
  resultAutoHideMs: 8000,
  noticePosition: "top-right",
  undoButton: true,
  auditLog: false,
  enforcePolicy: false,
  blockSend: false,
  requireConfirm: false,
  strictValidation: false,
  restoreTokens: true,
  inspectFiles: true,
  blockFileSend: false,
  uploadAudit: false,
});

// 모든 범주가 기본으로 켜져 있습니다. 새 범주가 생긴 버전으로 올라온 기존 사용자도 켜진 채로 시작합니다.
export const DEFAULT_ENABLED: Readonly<Enabled> = Object.freeze(
  Object.fromEntries(CATEGORY_IDS.map((id) => [id, true])) as Enabled,
);

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  enabled: DEFAULT_ENABLED,
  features: DEFAULT_FEATURES,
  maskStyle: "placeholder",
  allowlist: [],
});

// content.js의 coerceFeatures와 같은 규칙: 아는 키만, 타입에 맞게 받아들이고 이상한 값은 기본값으로 되돌립니다.
// 불리언은 정확히 true일 때만 켜집니다.
export function coerceFeatures(raw: unknown): Features {
  const merged: Features = { ...DEFAULT_FEATURES };
  if (!raw || typeof raw !== "object") return merged;
  const source = raw as Record<string, unknown>;
  const target = merged as unknown as Record<string, unknown>;

  for (const [key, expected] of Object.entries(DEFAULT_FEATURES)) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = source[key];
    if (typeof expected === "boolean") {
      target[key] = value === true;
    } else if (typeof expected === "number") {
      const number = Number(value);
      target[key] = Number.isFinite(number) && number >= 0 ? number : expected;
    } else if (typeof expected === "string") {
      target[key] = typeof value === "string" ? value : expected;
    }
  }
  return merged;
}

// 저장된 탐지 on/off는 모르는 키를 버리고, 없는 키는 켜짐(기본값)으로 채웁니다.
export function coerceEnabled(raw: unknown): Enabled {
  const merged: Enabled = { ...DEFAULT_ENABLED };
  if (!raw || typeof raw !== "object") return merged;
  const source = raw as Record<string, unknown>;
  for (const id of CATEGORY_IDS) {
    if (typeof source[id] === "boolean") merged[id] = source[id];
  }
  return merged;
}

export const ALLOWLIST_MAX_ENTRIES = 200;
export const ALLOWLIST_MAX_LENGTH = 100;

// 허용 목록: 문자열만, 앞뒤 공백을 빼고, 비어 있거나 중복이면 버리며, 개수와 길이에 한도를 둡니다.
export function coerceAllowlist(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const list: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const value = item.trim().slice(0, ALLOWLIST_MAX_LENGTH);
    if (value === "" || seen.has(value)) continue;
    seen.add(value);
    list.push(value);
    if (list.length >= ALLOWLIST_MAX_ENTRIES) break;
  }
  return list;
}

// 설정 화면의 입력란(한 줄에 하나)을 목록으로 바꿉니다.
export function parseAllowlistText(text: string): string[] {
  return coerceAllowlist(text.split(/\r?\n/));
}

export function coerceSettings(raw: unknown): Settings {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    enabled: coerceEnabled(source.enabled),
    features: coerceFeatures(source.features),
    maskStyle: coerceMaskStyle(source.maskStyle),
    allowlist: coerceAllowlist(source.allowlist),
  };
}

export async function loadSettings(): Promise<Settings> {
  const data = await chrome.storage.local.get(["enabled", "features", "maskStyle", "allowlist"]);
  return coerceSettings(data);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({
    enabled: settings.enabled,
    features: settings.features,
    maskStyle: settings.maskStyle,
    allowlist: settings.allowlist,
  });
}

// 감사 기록: 시각·조치·범주 ID만 있습니다. 원문은 저장되지 않습니다.
export interface HistoryEntry {
  at: number;
  action: string;
  categories: string[];
}

// 저장소의 값을 신뢰하지 않고 화면에 그릴 수 있는 형태로만 골라냅니다. 최신순으로 돌려줍니다.
export function normalizeHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const rows: HistoryEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    rows.push({
      at: Number(item.at) || 0,
      action: typeof item.action === "string" ? item.action : "",
      categories: Array.isArray(item.categories)
        ? item.categories.filter((c): c is string => typeof c === "string")
        : [],
    });
  }
  return rows.reverse();
}

export async function loadHistory(): Promise<HistoryEntry[]> {
  const { history } = await chrome.storage.local.get({ history: [] });
  return normalizeHistory(history);
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.remove(["history", "lastAction"]);
}
