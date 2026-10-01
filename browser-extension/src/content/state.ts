// 콘텐츠 스크립트가 공유하는 상태와 설정입니다. 원문은 어디에도 저장하지 않습니다.
import { CATEGORY_IDS } from "../shared/constants.ts";
import {
  coerceAllowlist,
  coerceFeatures,
  coerceMaskStyle,
  DEFAULT_FEATURES,
  type BoolFeature,
  type Features,
  type MaskStyle,
} from "../shared/settings.ts";
import { POLICY_SYNC_MESSAGE, readStoredPolicy, SERVER_KEYS, type ServerPolicy } from "../shared/serverPolicy.ts";
import type { AttachedFile } from "./files/types.ts";
import type { Editor, UndoEntry } from "./types.ts";

// 설정(options)에서 끈 범주는 안내와 마스킹에서 모두 제외합니다.
// 기본값은 4종 전체 사용이며, 저장소를 읽지 못하면 기본값을 유지합니다.
export const ALL_CATEGORIES: readonly string[] = CATEGORY_IDS;

// 안내창 위치와 시간, 그리고 선택 기능의 기본값(shared/settings.ts의 DEFAULT_FEATURES)입니다.
// persistentAlert(감지 안내 계속 표시)와 undoButton(실행 취소 버튼)은 화면 표시 방식만
// 바꾸므로 기본값을 켭니다. 전송 차단·승인 단계·정책 적용·감사 기록은 이 확장의
// "자동으로 막지 않는다"는 원칙을 바꾸므로 반드시 사용자가 켜야 합니다.
export const state = {
  features: { ...DEFAULT_FEATURES } as Features,
  disabledCategories: [] as string[],
  // 일치해도 무시할 값(설정 화면에서 사용자가 적은 것)
  allowlist: [] as string[],
  // 마스킹 방식: 자리표시자([전화번호]) 또는 세션 토큰([전화_1], 답변에서 되돌려 보여줌)
  maskStyle: "placeholder" as MaskStyle,
  // 안내창의 마스킹 버튼이 가리키는 입력창입니다.
  activeEditor: null as Editor | null,
  // 마지막으로 사용자가 입력한 입력창입니다. 전송 차단 판정에 씁니다.
  focusedEditor: null as Editor | null,
  // 표시 중인 감지 안내의 지문과, 사용자가 직접 닫은 지문입니다.
  // 닫은 뒤 같은 감지가 계속되면 다시 띄우지 않고, 감지가 사라지면 초기화합니다.
  activeAlertKey: "",
  dismissedAlertKey: "",
  // 마스킹으로 우리가 직접 만든 input 이벤트를 다시 검사하지 않도록 1회 건너뜁니다.
  skipNextInspection: false,
  lastUndo: null as UndoEntry | null,
  // 전송 차단에서 "한 번 더 누르면 허용"을 처리하기 위한 상태입니다.
  blockArmedKey: "",
  blockArmedUntil: 0,
  // 클릭·Enter 한 번은 click과 submit 두 경로를 탑니다. 허용한 직후에 오는 제출까지
  // 막으면 "한 번 더 누르면 전송됩니다"가 그대로 동작하지 않으므로, 같은 입력 묶음에
  // 속한 제출만 한 번 통과시킵니다. (플래그는 다음 작업 묶음에서 사라집니다.)
  allowPendingSubmit: false,
  lastAuditKey: "",
  // 첨부로 기억하는 파일의 검사 결과(내용 없음). 첨부파일 전송 차단 판정에 씁니다.
  attachedFiles: [] as AttachedFile[],
  // 조직 PDP 서버에서 내려받아 적용 중인 정책. 없으면 내장 기본 정책으로 판정합니다.
  serverPolicy: null as ServerPolicy | null,
};

export function feature(name: BoolFeature): boolean {
  return state.features[name] === true;
}

export function detectorOptions(): {
  disabledCategories: string[];
  strictValidation: boolean;
  allowlist: string[];
} {
  return {
    disabledCategories: state.disabledCategories,
    strictValidation: state.features.strictValidation,
    allowlist: state.allowlist,
  };
}

interface StoredSettings {
  enabled?: unknown;
  features?: unknown;
  allowlist?: unknown;
  maskStyle?: unknown;
}

export function applySettings(data: StoredSettings | null | undefined): void {
  if (!data || typeof data !== "object") {
    return;
  }
  const enabled = data.enabled;
  if (enabled && typeof enabled === "object") {
    state.disabledCategories = ALL_CATEGORIES.filter(
      (category) => (enabled as Record<string, unknown>)[category] === false,
    );
  }
  if (data.features) {
    state.features = coerceFeatures(data.features);
  }
  if (Array.isArray(data.allowlist)) {
    state.allowlist = coerceAllowlist(data.allowlist);
  }
  if (data.maskStyle !== undefined) {
    state.maskStyle = coerceMaskStyle(data.maskStyle);
  }
}

// 백그라운드가 내려받아 검사를 통과시킨 조직 정책을 적용합니다. 저장소 값도 한 번 더 검사하고,
// 올바르지 않거나 지워졌으면 내장 기본 정책으로 돌아갑니다.
export function applyServerPolicy(stored: unknown): void {
  state.serverPolicy = readStoredPolicy(stored);
}

// 서버 연동이 켜져 있으면 백그라운드가 정책을 확인하도록 요청합니다(너무 잦은 호출은 백그라운드가 막습니다).
// 응답은 쓰지 않습니다. 새 정책은 저장소 변경으로 들어옵니다.
function requestPolicySync(): void {
  try {
    chrome.runtime.sendMessage({ type: POLICY_SYNC_MESSAGE }, () => void chrome.runtime.lastError);
  } catch {
    // 확장이 새로 고쳐진 뒤의 옛 탭 등에서는 메시지를 보낼 수 없습니다. 기존 정책으로 계속 동작합니다.
  }
}

// 저장된 설정을 읽고, 이후 바뀌는 설정을 다음 검사부터 바로 반영합니다.
// chrome.storage를 쓸 수 없는 환경에서는 기본값으로만 동작합니다.
export function watchSettings(onChanged: () => void): void {
  try {
    chrome.storage.local.get({ enabled: null, features: DEFAULT_FEATURES, allowlist: [], maskStyle: "placeholder", [SERVER_KEYS.policy]: null }, (data) => {
      applySettings(data);
      applyServerPolicy(data[SERVER_KEYS.policy]);
      requestPolicySync();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") {
        return;
      }
      // 바뀐 키만 모아서 반영합니다. 설정 변경은 다음 검사부터 바로 적용됩니다.
      const next: StoredSettings = {};
      for (const key of ["enabled", "features", "allowlist", "maskStyle"] as const) {
        if (Object.prototype.hasOwnProperty.call(changes, key)) {
          next[key] = changes[key]?.newValue;
        }
      }
      applySettings(next);
      if (Object.prototype.hasOwnProperty.call(changes, SERVER_KEYS.policy)) {
        applyServerPolicy(changes[SERVER_KEYS.policy]?.newValue);
      }
      onChanged();
    });
  } catch {
    // chrome.storage를 쓸 수 없는 환경에서는 기본값으로만 동작합니다.
  }
}
