// 확장 UI 페이지(popup·options)가 함께 쓰는 상수입니다.
// content.js·background.js는 아직 번들 밖의 별도 파일이라 같은 값을 따로 가지고 있습니다.
// 어긋나지 않도록 shared/consistency.test.ts가 manifest.json·content.js·background.js와 대조합니다.

export const SUPPORTED_HOSTS = [
  "chatgpt.com",
  "chat.openai.com",
  "claude.ai",
  "gemini.google.com",
] as const;

export const CATEGORY_IDS = ["government_id", "phone_number", "email", "api_key"] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];

// 감사 기록에는 원문 대신 범주 ID만 들어옵니다. 화면에서는 한글 이름으로 바꿔 보여줍니다.
export const CATEGORY_LABELS: Readonly<Record<CategoryId, string>> = {
  government_id: "주민등록번호",
  phone_number: "전화번호",
  email: "이메일",
  api_key: "API 키",
};

export const ACTION_LABELS: Readonly<Record<string, string>> = {
  ALLOW: "허용(ALLOW)",
  MASK: "마스킹(MASK)",
  REQUIRE_APPROVAL: "승인 검토(REQUIRE_APPROVAL)",
  BLOCK: "차단(BLOCK)",
};

export function labelForCategory(category: string): string {
  return (CATEGORY_LABELS as Readonly<Record<string, string>>)[category] ?? category;
}
