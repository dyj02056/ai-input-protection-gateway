// 화면에 나온 세션 토큰([전화_1])을 원래 값으로 바꿔 "보여주기만" 합니다. 전송하거나 저장하지 않습니다.
//
// 지키는 것
// - 이 탭에서 만든 토큰만 되돌립니다(vault에 없는 토큰은 그대로 둡니다).
// - 텍스트 노드를 교체하지 않고 data만 제자리에서 바꿉니다. React 같은 프레임워크가 만든 노드를
//   갈아 끼우면 removeChild 오류가 나므로, 노드는 그대로 두고 글자만 바꿉니다.
//   사이트가 같은 노드의 글자를 다시 쓰면(스트리밍 등) 관찰자가 다시 되돌립니다.
// - 입력창(편집 가능한 곳)과 우리 안내창은 건드리지 않습니다. 입력창의 토큰을 되돌리면 마스킹이 취소됩니다.
// - 첫 토큰이 만들어지기 전에는 아무것도 관찰하지 않습니다(성능 영향 없음).
//
// 한계(문서에도 적어 둡니다)
// - 토큰이 서로 다른 DOM 노드에 걸쳐 쓰이면(예: 굵은 글씨 경계) 되돌리지 못합니다.
// - 사용자 말풍선 제외 선택자는 사이트 구조에 기댄 최선 노력이며, 사이트가 바뀌면 맞지 않을 수 있습니다.
import { EDITABLE_SELECTOR } from "./editable.ts";
import { feature } from "./state.ts";
import { vault } from "./tokens.ts";

// 내가 보낸 메시지(말풍선)는 복원하지 않습니다. 복원한 값을 수정해서 다시 보내면 원문이 그대로 전송되기 때문입니다.
// 사이트별 표식은 바뀔 수 있어 알아볼 수 있는 것만 제외합니다. 알아보지 못하면 복원됩니다.
const USER_MESSAGE_SELECTOR = [
  '[data-message-author-role="user"]', // ChatGPT
  '[data-testid="user-message"]', // Claude
  "user-query", // Gemini
  ".user-query-bubble-with-background", // Gemini
].join(", ");

const NEVER_RESTORE_SELECTOR = [
  EDITABLE_SELECTOR,
  "[data-ai-input-gateway-notice]",
  "script",
  "style",
  "noscript",
  "textarea",
  USER_MESSAGE_SELECTOR,
].join(", ");

let observer: MutationObserver | null = null;

function shouldSkip(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent) return true;
  return parent.closest(NEVER_RESTORE_SELECTOR) !== null;
}

function restoreTextNode(node: Text): void {
  const data = node.data;
  if (data.length < 3 || (!data.includes("_") && !data.includes("＿"))) return;
  if (shouldSkip(node)) return;
  const restored = vault.restoreText(data);
  if (restored !== data) node.data = restored;
}

function restoreWithin(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) {
    restoreTextNode(root as Text);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    restoreTextNode(node as Text);
  }
}

function handleMutations(records: MutationRecord[]): void {
  // 설정에서 복원을 끄면 이후 변화는 건드리지 않습니다(이미 되돌린 글자는 그대로 남습니다).
  if (!feature("restoreTokens") || vault.size === 0) return;
  for (const record of records) {
    if (record.type === "characterData") {
      restoreWithin(record.target);
    } else {
      record.addedNodes.forEach((added) => restoreWithin(added));
    }
  }
  // 우리가 바꾼 글자가 만든 변화는 다시 처리하지 않습니다.
  observer?.takeRecords();
}

// 복원을 시작합니다. 여러 번 불러도 한 번만 시작합니다. 이미 화면에 있는 토큰도 한 번 훑어서 되돌립니다.
export function startRestoring(): void {
  if (!feature("restoreTokens")) return;
  const root = document.body ?? document.documentElement;
  if (!root) return;

  restoreWithin(root);
  if (observer) return;
  observer = new MutationObserver(handleMutations);
  observer.observe(root, { childList: true, subtree: true, characterData: true });
}

export function stopRestoring(): void {
  observer?.disconnect();
  observer = null;
}

export function isRestoring(): boolean {
  return observer !== null;
}
