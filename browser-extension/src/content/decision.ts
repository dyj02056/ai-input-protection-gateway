// 탐지 범주 ID로 조치 이름을 정하고 안내 문구를 만듭니다. 입력 원문은 다루지 않습니다.
import { CATEGORIES, categoryDef, type ActionName } from "../shared/categories.ts";
import { getPolicyEngine } from "./types.ts";

// detector.js와 PDP가 공유하는 범주 ID를 사용자가 읽을 수 있는 이름으로 바꿉니다.
export const CATEGORY_LABELS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(CATEGORIES.map((category) => [category.id, category.noticeLabel])),
);

const ACTION_PRIORITY: Readonly<Record<ActionName, number>> = {
  ALLOW: 1,
  MASK: 2,
  REQUIRE_APPROVAL: 3,
  BLOCK: 4,
};

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
  // 범주별 기본 조치(등록부) 중 가장 엄격한 것을 고릅니다. 등록되지 않은 범주는 승인 검토입니다.
  let selected: ActionName = "ALLOW";
  for (const category of categories) {
    const action = categoryDef(category)?.defaultAction ?? "REQUIRE_APPROVAL";
    if (ACTION_PRIORITY[action] > ACTION_PRIORITY[selected]) {
      selected = action;
    }
  }
  return selected;
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
