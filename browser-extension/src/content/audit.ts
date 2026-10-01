// 판정 이름만 서비스 워커(배지)와 로컬 감사 기록에 남깁니다. 원문·일치한 문자열은 보내지도 저장하지도 않습니다.
import { feature, state } from "./state.ts";

// 판정 이름만 서비스 워커에 알려 배지에 표시합니다. 원문과 범주 ID는 보내지 않습니다.
export function reportAction(action: string): void {
  try {
    chrome.runtime.sendMessage({ type: "gateway:action", action }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    // 서비스 워커가 없으면 배지만 갱신되지 않습니다.
  }
}

// 감사 기록에는 범주 ID·조치·시각만 남깁니다. 원문과 일치한 문자열은 저장하지 않습니다.
// 같은 판정이 반복되면(예: 숫자를 한 자씩 입력) 마지막 기록과 비교해 한 번만 남깁니다.
export const AUDIT_LIMIT = 20;

export function recordAudit(action: string, categories: readonly string[]): void {
  if (!feature("auditLog") || !Array.isArray(categories) || categories.length === 0) {
    return;
  }

  const key = `${action}|${[...categories].sort().join(",")}`;
  if (key === state.lastAuditKey) {
    return;
  }
  state.lastAuditKey = key;

  try {
    chrome.storage.local.get({ history: [] }, (data) => {
      void chrome.runtime.lastError;
      const existing: unknown[] = data && Array.isArray(data.history) ? data.history : [];
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
