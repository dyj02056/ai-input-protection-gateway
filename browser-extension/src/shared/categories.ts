// 탐지 범주의 단일 등록부입니다. 범주 하나를 더하려면 여기에 한 줄을 추가하고 detector.ts에 규칙을 쓰면 됩니다.
// 설정 화면·안내 문구·배지·정책 기본값·데모가 모두 이 표에서 나옵니다.
//
// 파이썬 PDP(gateway-core/pdp/policy.py)는 이 표를 읽지 않고 같은 값을 따로 가지고 있습니다.
// 어긋나면 `py tools/policy_parity.py`가 실패합니다.

export type ActionName = "ALLOW" | "MASK" | "REQUIRE_APPROVAL" | "BLOCK";

export interface CategoryDef {
  readonly id: string;
  // 마스킹했을 때 자리표시자로 들어가는 이름: [전화번호]
  readonly maskLabel: string;
  // 감사 기록 표처럼 짧게 쓰는 이름
  readonly shortLabel: string;
  // 안내창 문구에 쓰는 이름: "전화번호 형식과(와) 일치했습니다"
  readonly noticeLabel: string;
  // 세션 토큰 마스킹에서 쓰는 짧은 이름: [전화_1]. 서로 달라야 하고 밑줄·대괄호·숫자가 없어야 합니다.
  readonly tokenLabel: string;
  // 정책 기본 조치(데모 정책). 막는 것은 아니며, 안내 문구와 배지에만 쓰입니다.
  readonly defaultAction: ActionName;
}

export const CATEGORIES = [
  {
    id: "government_id",
    maskLabel: "주민등록번호",
    shortLabel: "주민등록번호",
    noticeLabel: "주민등록번호 형식",
    tokenLabel: "주민",
    defaultAction: "MASK",
  },
  {
    id: "phone_number",
    maskLabel: "전화번호",
    shortLabel: "전화번호",
    noticeLabel: "전화번호 형식",
    tokenLabel: "전화",
    defaultAction: "MASK",
  },
  {
    id: "email",
    maskLabel: "이메일",
    shortLabel: "이메일",
    noticeLabel: "이메일 형식",
    tokenLabel: "메일",
    defaultAction: "MASK",
  },
  {
    id: "api_key",
    maskLabel: "API 키/토큰",
    shortLabel: "API 키",
    noticeLabel: "API 키/토큰 형식",
    tokenLabel: "키",
    defaultAction: "BLOCK",
  },
  {
    id: "credit_card",
    maskLabel: "카드번호",
    shortLabel: "카드번호",
    noticeLabel: "카드번호 형식",
    tokenLabel: "카드",
    defaultAction: "BLOCK",
  },
  {
    id: "bank_account",
    maskLabel: "계좌번호",
    shortLabel: "계좌번호",
    noticeLabel: "계좌번호 형식",
    tokenLabel: "계좌",
    defaultAction: "MASK",
  },
  {
    id: "passport_number",
    maskLabel: "여권번호",
    shortLabel: "여권번호",
    noticeLabel: "여권번호 형식",
    tokenLabel: "여권",
    defaultAction: "MASK",
  },
  {
    id: "driver_license",
    maskLabel: "운전면허번호",
    shortLabel: "운전면허번호",
    noticeLabel: "운전면허번호 형식",
    tokenLabel: "면허",
    defaultAction: "MASK",
  },
  {
    id: "password",
    maskLabel: "비밀번호",
    shortLabel: "비밀번호",
    noticeLabel: "비밀번호 표기",
    tokenLabel: "비번",
    defaultAction: "BLOCK",
  },
] as const satisfies readonly CategoryDef[];

export type CategoryId = (typeof CATEGORIES)[number]["id"];

export const CATEGORY_IDS: readonly CategoryId[] = CATEGORIES.map((category) => category.id);

const BY_ID: ReadonlyMap<string, CategoryDef> = new Map(
  CATEGORIES.map((category) => [category.id, category]),
);

export function categoryDef(id: string): CategoryDef | undefined {
  return BY_ID.get(id);
}
