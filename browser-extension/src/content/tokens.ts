// 세션 토큰 저장소: 마스킹한 값과 토큰([전화_1])의 대응표입니다.
//
// - 이 탭의 메모리에만 있습니다. chrome.storage·sessionStorage·네트워크 어디에도 쓰지 않습니다.
//   탭을 새로고침하거나 닫으면 사라집니다(그 뒤에는 토큰을 원래 값으로 되돌릴 수 없습니다).
// - 같은 값은 같은 토큰입니다. 모델이 "같은 사람"임을 알 수 있게 하기 위해서입니다.
//   (010-1234-5678 과 01012345678 처럼 표기만 다른 값도 같은 값으로 봅니다.)
import { CATEGORIES, categoryDef } from "../shared/categories.ts";

// 모델이 토큰을 조금 바꿔 써도(예: [전화_1]님, 전화_1 , [ 전화_1 ], 【전화_1】) 되돌립니다.
// 괄호 없이 쓴 경우는 다른 단어의 일부(예: 휴대전화_1)를 건드리지 않도록 앞뒤 글자를 확인합니다.
//
// 스트리밍 안전: 답변은 한 글자씩 도착하므로 "끝이 확정된" 토큰만 되돌립니다.
// - 여는 괄호 뒤의 토큰([전화_1)은 닫는 괄호가 올 때까지 기다립니다. 먼저 바꾸면 [010-…] 처럼 괄호가 남습니다.
// - 괄호 없는 토큰은 뒤에 숫자·밑줄이 아닌 글자가 이어질 때만 바꿉니다(전화_1 다음에 0이 오면 전화_10입니다).
//   그래서 글 맨 끝의 괄호 없는 토큰은 되돌리지 않습니다. 이 확장이 만든 토큰에는 괄호가 있습니다.
const LABELS = CATEGORIES.map((category) => category.tokenLabel)
  .sort((a, b) => b.length - a.length)
  .join("|");

function tokenPattern(): RegExp {
  return new RegExp(
    `[\\[［【]\\s*(${LABELS})\\s*[_＿]\\s*(\\d+)\\s*[\\]］】]` +
      `|(?<![\\p{L}\\p{N}_\\[［【])(${LABELS})[_＿](\\d+)(?=[^\\d_])`,
    "gu",
  );
}

// 같은 값인지 비교하는 열쇠: 공백·기호·대소문자를 뺍니다.
function valueKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^0-9a-zㄱ-ㆎ가-힣]/g, "");
}

export class TokenVault {
  // "카테고리|값 열쇠" → "전화_1"
  private readonly byValue = new Map<string, string>();
  // "전화_1" → 처음 입력된 원래 값
  private readonly byToken = new Map<string, string>();
  private readonly counters = new Map<string, number>();

  get size(): number {
    return this.byToken.size;
  }

  // 마스킹 결과로 입력창에 들어갈 토큰을 돌려줍니다. 처음 보는 값이면 새 번호를 붙입니다.
  tokenFor(categoryId: string, value: string): string {
    const label = categoryDef(categoryId)?.tokenLabel ?? categoryId;
    const key = `${categoryId}|${valueKey(value)}`;
    let name = this.byValue.get(key);
    if (name === undefined) {
      const next = (this.counters.get(label) ?? 0) + 1;
      this.counters.set(label, next);
      name = `${label}_${next}`;
      this.byValue.set(key, name);
      this.byToken.set(name, value);
    }
    return `[${name}]`;
  }

  // 텍스트 안의 알려진 토큰을 원래 값으로 바꿉니다. 모르는 토큰(이 탭에서 만들지 않은 것)은 그대로 둡니다.
  restoreText(text: string): string {
    if (this.byToken.size === 0 || !text.includes("_") && !text.includes("＿")) return text;
    return text.replace(tokenPattern(), (matched, bracketLabel, bracketNumber, bareLabel, bareNumber) => {
      const label = (bracketLabel ?? bareLabel) as string;
      const number = (bracketNumber ?? bareNumber) as string;
      return this.byToken.get(`${label}_${Number(number)}`) ?? matched;
    });
  }

  clear(): void {
    this.byValue.clear();
    this.byToken.clear();
    this.counters.clear();
  }
}

// 이 탭의 저장소(콘텐츠 스크립트마다 하나)
export const vault = new TokenVault();
