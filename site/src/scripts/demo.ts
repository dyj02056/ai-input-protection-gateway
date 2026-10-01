// 공개 데모: 확장에 들어가는 것과 같은 탐지기·정책 코드를 브라우저 안에서만 실행합니다. 저장·전송 없음.
// (이전에는 확장의 detector.js를 docs/에 복사해 두고 읽었습니다. 이제 소스를 직접 가져오므로 사본이 없습니다.)
import { detector } from "../../../browser-extension/src/engine/detector.ts";
import { policy } from "../../../browser-extension/src/engine/policy.ts";

const LABELS: Readonly<Record<string, string>> = {
  government_id: "주민등록번호 형식",
  phone_number: "전화번호 형식",
  email: "이메일 형식",
  api_key: "API 키/토큰 형식",
};

export const SAMPLE =
  "가짜 주민번호 000000-1000000\n가짜 전화번호 010-0000-0000\n가짜 이메일 test.user@example.com\n가짜 키 sk-TESTTESTTESTTESTTEST\n그대로 남아야 할 문장";

const MASK_PLACEHOLDER = "(마스킹 버튼을 눌러주세요)";

function byId<T extends HTMLElement>(root: Document, id: string): T {
  const element = root.getElementById(id);
  if (!element) throw new Error(`#${id} 요소를 찾을 수 없습니다.`);
  return element as T;
}

function decide(categories: readonly string[]): string {
  try {
    return policy.decide(categories).action;
  } catch {
    return "-";
  }
}

export function initDemo(root: Document = document): void {
  const input = byId<HTMLTextAreaElement>(root, "input");
  const cats = byId(root, "cats");
  const catJson = byId(root, "catJson");
  const masked = byId(root, "masked");
  const pdp = byId(root, "pdp");

  function render(): string[] {
    let found: string[] = [];
    try {
      found = [...detector.inspect(input.value)];
    } catch {
      found = [];
    }

    cats.textContent = "";
    if (found.length === 0) {
      cats.textContent = "감지 없음 (안전 판정 아님)";
    }
    for (const category of found) {
      const badge = root.createElement("span");
      badge.className = "badge";
      badge.textContent = `${category} · ${LABELS[category] ?? "알 수 없는 범주"}`;
      cats.append(badge);
    }

    catJson.textContent = JSON.stringify(found);
    pdp.textContent = `PDP: ${decide(found)}`;
    return found;
  }

  byId(root, "check").addEventListener("click", () => {
    masked.textContent = MASK_PLACEHOLDER;
    render();
  });

  byId(root, "mask").addEventListener("click", () => {
    render();
    try {
      masked.textContent = detector.mask(input.value);
    } catch {
      masked.textContent = "마스킹 실패";
    }
  });

  byId(root, "copy").addEventListener("click", () => {
    const text = masked.textContent ?? "";
    if (navigator.clipboard) void navigator.clipboard.writeText(text);
  });

  byId(root, "reset").addEventListener("click", () => {
    input.value = SAMPLE;
    masked.textContent = MASK_PLACEHOLDER;
    render();
  });

  render();
}
