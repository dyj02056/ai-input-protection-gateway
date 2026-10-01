import type { Detector } from "../engine/detector.ts";
import type { Policy } from "../engine/policy.ts";

export type PlainEditor = HTMLInputElement | HTMLTextAreaElement;
export type Editor = HTMLElement;

// 안내창 종류입니다. 감지 안내(alert)만 사용자가 닫을 때까지 계속 표시합니다.
export const NOTICE_KIND = Object.freeze({
  ALERT: "alert",
  RESULT: "result",
  INFO: "info",
} as const);
export type NoticeKind = (typeof NOTICE_KIND)[keyof typeof NOTICE_KIND];

// 텍스트 노드가 읽은 텍스트에서 차지하는 구간입니다. 마스킹할 때 이 구간만 바꾸면
// 문단 요소·<br>·서식이 그대로 남습니다.
export interface TextRun {
  node: Text;
  start: number;
  end: number;
}

// 실행 취소에 필요한 최소 정보입니다. 되돌릴 DOM 노드나 이전 평문 값만 담습니다.
export type UndoEntry =
  | { kind: "plain"; editor: PlainEditor; previous: string }
  | { kind: "nodes"; editor: Editor; stack: Array<{ node: Text; data: string }> };

export type MaskResult =
  | { outcome: "failed" | "unchanged" | "variant-only" }
  | { outcome: "applied"; undo: UndoEntry };

// detector.js·policy.js는 manifest의 content_scripts가 이 스크립트보다 먼저 읽어 전역에 둡니다.
// 읽지 못한 경우(확장을 새로고침하기 전의 옛 탭 등)에도 안내를 띄울 수 있도록 값은 없을 수 있습니다.
export function getDetector(): Detector | undefined {
  return (globalThis as { AIInputGatewayDetector?: Detector }).AIInputGatewayDetector;
}

export function getPolicyEngine(): Policy | undefined {
  return (globalThis as { AIInputGatewayPolicy?: Policy }).AIInputGatewayPolicy;
}
