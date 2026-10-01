// 콘텐츠 스크립트 모듈 테스트용 환경: 엔진 전역 설치, 상태 초기화, 닫힌 shadow root 열기.
import { detector } from "../engine/detector.ts";
import { policy } from "../engine/policy.ts";
import { state } from "../content/state.ts";
import { DEFAULT_FEATURES, type Features } from "../shared/settings.ts";

// manifest의 content_scripts가 detector.js·policy.js를 먼저 읽어 두는 것과 같은 상태를 만듭니다.
export function installEngines(): void {
  const scope = globalThis as Record<string, unknown>;
  scope.AIInputGatewayDetector = detector;
  scope.AIInputGatewayPolicy = policy;
}

export function removeEngines(): void {
  const scope = globalThis as Record<string, unknown>;
  delete scope.AIInputGatewayDetector;
  delete scope.AIInputGatewayPolicy;
}

export function resetContentState(features: Partial<Features> = {}): void {
  Object.assign(state, {
    features: { ...DEFAULT_FEATURES, ...features },
    disabledCategories: [],
    allowlist: [],
    maskStyle: "placeholder",
    activeEditor: null,
    focusedEditor: null,
    activeAlertKey: "",
    dismissedAlertKey: "",
    skipNextInspection: false,
    lastUndo: null,
    blockArmedKey: "",
    blockArmedUntil: 0,
    allowPendingSubmit: false,
    lastAuditKey: "",
    attachedFiles: [],
    serverPolicy: null,
  });
}

// 실제 확장은 닫힌 shadow root를 쓰므로 테스트가 내부를 볼 수 있도록 열린 것으로 바꿔 끼웁니다.
// (tools/dom_test.html이 하는 것과 같은 방법입니다.) 요청된 mode는 requestedModes에 남깁니다.
export const requestedModes: string[] = [];

export function openShadowRoots(): () => void {
  const native = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init: ShadowRootInit) {
    requestedModes.push(init.mode);
    return native.call(this, { ...init, mode: "open" });
  };
  return () => {
    Element.prototype.attachShadow = native;
  };
}

export const noticeHost = (): HTMLElement | null =>
  document.querySelector<HTMLElement>("[data-ai-input-gateway-notice]");

export const noticePart = <T extends Element = HTMLElement>(selector: string): T | null =>
  noticeHost()?.shadowRoot?.querySelector<T>(selector) ?? null;

export const noticeTitle = (): string | null => noticePart(".message strong")?.textContent ?? null;
