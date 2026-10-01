// PDP policy.py와 공유하는 범주 ID만 반환합니다.
// 원문이나 정규식과 일치한 문자열은 inspect() 결과에 넣지 않습니다.
// mask()는 사용자가 선택한 경우에만 일치 문자열을 자리표시자로 바꿉니다.
import type { CategoryId } from "../shared/constants.ts";

export interface DetectorOptions {
  // 설정(options)에서 끈 범주. 주지 않으면 4종 전체를 사용합니다.
  readonly disabledCategories?: readonly string[];
}

// 일치한 구간의 위치입니다. 일치한 문자열 자체는 담지 않습니다.
export interface DetectedMatch {
  readonly categoryId: CategoryId;
  readonly label: string;
  readonly start: number;
  readonly end: number;
}

interface Rule {
  readonly categoryId: CategoryId;
  readonly maskLabel: string;
  readonly pattern: RegExp;
}

// [수정] 경계 문자를 캡처/소비하지 않도록 lookbehind(?<!\d), (?<![A-Za-z0-9])를 사용합니다.
//        이렇게 하면 매칭 대상이 실제 민감정보 부분만이 되어 줄바꿈이 보존됩니다.
const RULES: readonly Rule[] = [
  {
    categoryId: "government_id",
    maskLabel: "주민등록번호",
    // 날짜 유효성이나 실제 번호 여부는 확인하지 않습니다.
    pattern: /(?<!\d)\d{6}[- ]?[1-8]\d{6}(?!\d)/,
  },
  {
    categoryId: "phone_number",
    maskLabel: "전화번호",
    // 국내 휴대전화·일부 지역번호·070·050 계열의 간단한 형식 검사입니다.
    pattern: /(?<!\d)0(?:2|[3-6]\d|1[016789]|70|50[2-8])[- .]?\d{3,4}[- .]?\d{4}(?!\d)/,
  },
  {
    categoryId: "api_key",
    maskLabel: "API 키/토큰",
    // 일부 키 접두사만 다룹니다. 모든 서비스의 키를 찾지는 않습니다.
    pattern:
      /(?<![A-Za-z0-9])(?:sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|github_pat_[A-Za-z0-9_]{20,}|(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})(?![A-Za-z0-9])/,
  },
  {
    categoryId: "email",
    maskLabel: "이메일",
    // RFC 전체가 아니라 업무용 식별 목적의 실용 패턴입니다.
    pattern: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?![A-Za-z])/,
  },
];

function normalizeForDetection(text: string): string {
  // 전각 숫자·하이픈 등 표기 변형을 NFKC로 정규화한 뒤 검사합니다.
  // 마스킹은 원문 표기를 최대한 유지하며, 전각 변형은 탐지 우선·마스킹 제한을 README에 명시합니다.
  try {
    return typeof text.normalize === "function" ? text.normalize("NFKC") : text;
  } catch {
    return text;
  }
}

// 설정에서 끈 범주는 탐지·마스킹 대상에서 제외합니다.
// options를 넘기지 않으면 기존과 동일하게 4종 전체를 사용합니다.
function selectRules(options?: DetectorOptions | null): readonly Rule[] {
  const disabled =
    options && Array.isArray(options.disabledCategories) ? options.disabledCategories : [];
  if (disabled.length === 0) {
    return RULES;
  }
  const skip = new Set(disabled);
  return RULES.filter((rule) => !skip.has(rule.categoryId));
}

// 일치한 구간의 위치를 함께 돌려줍니다.
// content.js가 입력란 구조를 통째로 다시 쓰지 않고 해당 구간만 바꾸기 위해 씁니다.
// 여기서 반환하는 값도 범주 ID와 위치뿐이며, 일치한 문자열은 담지 않습니다.
function findMatches(text: unknown, options?: DetectorOptions | null): DetectedMatch[] {
  if (typeof text !== "string" || text.length === 0) {
    return [];
  }

  const found: DetectedMatch[] = [];
  for (const rule of selectRules(options)) {
    const pattern = new RegExp(rule.pattern.source, "g");
    let hit = pattern.exec(text);
    while (hit !== null) {
      found.push({
        categoryId: rule.categoryId,
        label: rule.maskLabel,
        start: hit.index,
        end: hit.index + hit[0].length,
      });
      if (hit[0].length === 0) {
        pattern.lastIndex += 1;
      }
      hit = pattern.exec(text);
    }
  }

  // 앞에서 시작한 구간을 먼저 적용하고, 겹치는 뒤 구간은 건너뜁니다.
  // mask()가 규칙 순서대로 치환한 결과와 같아지도록 하는 규칙입니다.
  found.sort((a, b) => a.start - b.start || a.end - b.end);
  const accepted: DetectedMatch[] = [];
  let lastEnd = 0;
  for (const match of found) {
    if (match.start < lastEnd) {
      continue;
    }
    accepted.push(match);
    lastEnd = match.end;
  }
  return accepted;
}

// matches를 text에 적용한 결과 문자열을 만듭니다.
function applyMatches(text: unknown, matches?: readonly DetectedMatch[] | null): string {
  if (typeof text !== "string") {
    return "";
  }
  if (!Array.isArray(matches) || matches.length === 0) {
    return text;
  }

  let result = "";
  let cursor = 0;
  for (const match of matches) {
    result += text.slice(cursor, match.start) + `[${match.label}]`;
    cursor = match.end;
  }
  return result + text.slice(cursor);
}

function inspect(text: unknown, options?: DetectorOptions | null): CategoryId[] {
  const source = typeof text === "string" ? normalizeForDetection(text) : "";
  return selectRules(options)
    .filter((rule) => rule.pattern.test(source))
    .map((rule) => rule.categoryId);
}

function mask(text: unknown, options?: DetectorOptions | null): string {
  const rules = selectRules(options);
  const source = typeof text === "string" ? text : "";
  const normalized = typeof text === "string" ? normalizeForDetection(text) : "";
  let masked = source;

  for (const rule of rules) {
    // 전역 정규식은 호출 때마다 새로 만들어 lastIndex 상태를 공유하지 않습니다.
    const pattern = new RegExp(rule.pattern.source, "g");
    masked = masked.replace(pattern, () => `[${rule.maskLabel}]`);
  }

  // 전각 변형 등 원문 표기가 달라 치환되지 않은 경우,
  // 정규화된 보기에서 탐지된 부분은 가려 구조 노출을 줄입니다.
  if (normalized !== source) {
    let normalizedMasked = normalized;
    for (const rule of rules) {
      normalizedMasked = normalizedMasked.replace(
        new RegExp(rule.pattern.source, "g"),
        () => `[${rule.maskLabel}]`,
      );
    }
    if (normalizedMasked !== normalized && masked === source) {
      masked = normalizedMasked;
    }
  }

  return masked;
}

export const detector = Object.freeze({ inspect, findMatches, applyMatches, mask });
export type Detector = typeof detector;
