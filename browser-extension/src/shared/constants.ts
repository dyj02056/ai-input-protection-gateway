// 확장의 화면·백그라운드·콘텐츠 스크립트가 함께 쓰는 상수입니다.
// 범주 정보는 categories.ts(단일 등록부)에서 오고, 지원 호스트는 manifest.json과
// shared/consistency.test.ts가 대조합니다.
import { CATEGORIES, CATEGORY_IDS, categoryDef, type CategoryId } from "./categories.ts";

export { CATEGORY_IDS };
export type { CategoryId };

export const SUPPORTED_HOSTS = [
  "chatgpt.com",
  "chat.openai.com",
  "claude.ai",
  "gemini.google.com",
] as const;

// 감사 기록에는 원문 대신 범주 ID만 들어옵니다. 화면에서는 한글 이름으로 바꿔 보여줍니다.
export const CATEGORY_LABELS: Readonly<Record<CategoryId, string>> = Object.fromEntries(
  CATEGORIES.map((category) => [category.id, category.shortLabel]),
) as Record<CategoryId, string>;

export const ACTION_LABELS: Readonly<Record<string, string>> = {
  ALLOW: "허용(ALLOW)",
  MASK: "마스킹(MASK)",
  REQUIRE_APPROVAL: "승인 검토(REQUIRE_APPROVAL)",
  BLOCK: "차단(BLOCK)",
};

export function labelForCategory(category: string): string {
  return categoryDef(category)?.shortLabel ?? category;
}
