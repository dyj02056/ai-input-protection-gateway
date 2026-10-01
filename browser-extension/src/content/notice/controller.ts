// 안내창 한 개의 생명주기(만들기·갱신·숨기기·위치)를 맡습니다. 어떤 안내를 언제 띄울지는 정하지 않습니다.
import { h, render } from "preact";
import { state } from "../state.ts";
import type { NoticeKind } from "../types.ts";
import { Notice, type NoticeApproval } from "./Notice.tsx";

// 안내창을 둘 수 있는 위치입니다. 적용은 CSS의 data-position 규칙이 담당합니다.
const NOTICE_POSITIONS = new Set(["top-right", "bottom-left"]);

export interface NoticeContent {
  kind: NoticeKind;
  title: string;
  description: string;
  showMask: boolean;
  showUndo: boolean;
  approval?: NoticeApproval | null;
}

export interface NoticeHandlers {
  onClose: () => void;
  onMask: () => void;
  onUndo: () => void;
  onApprovalRequest?: (purpose: string, note: string) => void;
  // 안내창이 사라질 때마다(닫기·시간 경과·직접 숨김) 불립니다.
  onHidden: () => void;
}

export interface NoticeController {
  show(content: NoticeContent, autoHideMs: number): void;
  hide(): void;
  refreshPosition(): void;
  readonly kind: NoticeKind | "";
}

export function createNoticeController(handlers: NoticeHandlers): NoticeController {
  let host: HTMLDivElement | null = null;
  let shadow: ShadowRoot | null = null;
  let kind: NoticeKind | "" = "";
  let hideTimer = 0;

  // 안내창 위치는 설정값을 host의 data-position으로 옮겨 CSS가 처리하게 합니다.
  // 기준은 이전에 적용한 값이 아니라 이 host의 현재 값입니다. (1.1.0은 값을 변수에 기억해 두고
  // 비교해서, 안내창을 닫은 뒤 새로 만든 host에는 위치가 적용되지 않는 결함이 있었습니다.)
  function applyPosition(target: HTMLElement): void {
    const wanted = NOTICE_POSITIONS.has(state.features.noticePosition)
      ? state.features.noticePosition
      : "top-right";
    if (target.dataset.position !== wanted) {
      target.dataset.position = wanted;
    }
  }

  function create(): void {
    const element = document.createElement("div");
    element.setAttribute("data-ai-input-gateway-notice", "");
    shadow = element.attachShadow({ mode: "closed" });
    document.documentElement.append(element);
    host = element;
    applyPosition(element);
  }

  function hide(): void {
    window.clearTimeout(hideTimer);
    hideTimer = 0;
    if (host && host.isConnected) {
      // Preact 트리를 정리한 뒤 떼어 냅니다.
      if (shadow) render(null, shadow as unknown as Element);
      host.remove();
    }
    host = null;
    shadow = null;
    kind = "";
    handlers.onHidden();
  }

  function show(content: NoticeContent, autoHideMs: number): void {
    if (!host || !host.isConnected || !shadow) {
      create();
    }
    applyPosition(host!);

    kind = content.kind;
    render(
      h(Notice, {
        title: content.title,
        description: content.description,
        showMask: content.showMask,
        showUndo: content.showUndo,
        approval: content.approval ?? null,
        onClose: handlers.onClose,
        onMask: handlers.onMask,
        onUndo: handlers.onUndo,
        onApprovalRequest: handlers.onApprovalRequest,
      }),
      shadow as unknown as Element,
    );

    window.clearTimeout(hideTimer);
    hideTimer = 0;
    if (autoHideMs > 0) {
      hideTimer = window.setTimeout(hide, autoHideMs);
    }
  }

  function refreshPosition(): void {
    // 안내창 위치는 표시 중인 창에도 즉시 반영합니다.
    if (host && host.isConnected) {
      applyPosition(host);
    }
  }

  return {
    show,
    hide,
    refreshPosition,
    // 바깥(사이트 스크립트 등)에서 안내창이 제거됐다면 더는 표시 중인 안내가 없는 것으로 봅니다.
    get kind() {
      return host && host.isConnected ? kind : "";
    },
  };
}
