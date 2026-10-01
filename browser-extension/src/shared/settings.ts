// 설정 저장: chrome.storage.local만 사용합니다. 서버 전송 없음.
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
}

export type Enabled = Record<CategoryId, boolean>;
export type MaskStyle = "placeholder" | "token";

export interface Settings {
  enabled: Enabled;
  features: Features;
  maskStyle: string;
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
});

export const DEFAULT_ENABLED: Readonly<Enabled> = Object.freeze({
  government_id: true,
  phone_number: true,
  email: true,
  api_key: true,
});

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  enabled: DEFAULT_ENABLED,
  features: DEFAULT_FEATURES,
  maskStyle: "placeholder",
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

export function coerceSettings(raw: unknown): Settings {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    enabled: coerceEnabled(source.enabled),
    features: coerceFeatures(source.features),
    maskStyle: typeof source.maskStyle === "string" ? source.maskStyle : DEFAULT_SETTINGS.maskStyle,
  };
}

export async function loadSettings(): Promise<Settings> {
  const data = await chrome.storage.local.get(["enabled", "features", "maskStyle"]);
  return coerceSettings(data);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({
    enabled: settings.enabled,
    features: settings.features,
    maskStyle: settings.maskStyle,
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
