// 탐지 범주 ID로 조치 이름을 정하고 안내 문구를 만듭니다. 입력 원문은 다루지 않습니다.
import { getPolicyEngine } from "./types.ts";

// detector.js와 PDP가 공유하는 범주 ID를 사용자가 읽을 수 있는 이름으로 바꿉니다.
export const CATEGORY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  government_id: "주민등록번호 형식",
  phone_number: "전화번호 형식",
  email: "이메일 형식",
  api_key: "API 키/토큰 형식",
});

const hasOwn = (target: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(target, key);

// 판정 규칙은 policy.js(브라우저 로컬 정책 엔진)에 있습니다.
// policy.py와 같은 케이스 표로 양쪽 결과가 같은지 검사합니다.
// policy.js를 읽지 못한 경우에만 아래 폴백으로 같은 규칙을 계산합니다.
export function decideLocalAction(categories: readonly string[]): string {
  const engine = getPolicyEngine();
  if (engine && typeof engine.decide === "function") {
    try {
      return engine.decide(categories).action;
    } catch {
      // 원문이 섞여 들어오는 등 이상한 입력이면 폴백으로 진행합니다.
    }
  }

  if (!Array.isArray(categories) || categories.length === 0) {
    return "ALLOW";
  }
  if (categories.includes("api_key")) {
    return "BLOCK";
  }
  if (categories.some((category) => !hasOwn(CATEGORY_LABELS, category))) {
    return "REQUIRE_APPROVAL";
  }
  return "MASK";
}

export function formatCategoryLabels(categories: readonly string[]): string {
  return categories
    .map((category) =>
      hasOwn(CATEGORY_LABELS, category) ? CATEGORY_LABELS[category] : "알 수 없는 탐지 범주",
    )
    .join(" · ");
}

// 감지 내용이 같은지 비교하기 위한 지문입니다. 범주 ID와 조치만 쓰고 원문은 넣지 않습니다.
export function alertKey(categories: readonly string[]): string {
  return `${decideLocalAction(categories)}|${[...categories].sort().join(",")}`;
}
