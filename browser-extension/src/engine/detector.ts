// PDP policy.py와 공유하는 범주 ID만 반환합니다.
// 원문이나 정규식과 일치한 문자열은 inspect() 결과에 넣지 않습니다.
// mask()는 사용자가 선택한 경우에만 일치 문자열을 자리표시자로 바꿉니다.
import { categoryDef, type CategoryId } from "../shared/categories.ts";

export interface DetectorOptions {
  // 설정(options)에서 끈 범주. 주지 않으면 모든 범주를 사용합니다.
  readonly disabledCategories?: readonly string[];
  // 켜면 주민등록번호의 생년월일이 달력에 없는 값(예: 월이 00)은 무시합니다. 기본은 꺼짐입니다.
  // 꺼 두는 이유: 이 확장의 체험 문구(000000-1000000)가 일부러 실제로 없는 번호이기 때문입니다.
  readonly strictValidation?: boolean;
  // 일치해도 무시할 값(회사 대표번호 등). 공백·구분 기호·대소문자를 뺀 값으로 비교합니다.
  readonly allowlist?: readonly string[];
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
  // 플래그(i 등)는 그대로 쓰고 전역(g) 검색은 호출할 때마다 새로 만듭니다.
  readonly pattern: RegExp;
  // 정규식이 찾은 값이 정말 그 범주인지 한 번 더 확인합니다(카드번호 Luhn 검사 등).
  readonly validate?: (matched: string, options: DetectorOptions) => boolean;
}

const digitsOf = (value: string): string => value.replace(/\D/g, "");

// 같은 숫자만 반복하는 값(0000…, 1111…)은 실제 번호가 아닙니다.
const isRepeatedDigit = (digits: string): boolean => /^(\d)\1+$/.test(digits);

// Luhn 검사: 카드번호의 검증 숫자 규칙입니다.
function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = digits.charCodeAt(index) - 48;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (lengths[month - 1] ?? 0);
}

// 주민(외국인)등록번호의 앞 6자리가 달력에 있는 날짜인지 확인합니다. 성별 자리 1·2·5·6은 1900년대,
// 3·4·7·8은 2000년대입니다. 체크섬은 쓰지 않습니다(2020년 10월 이후 발급 번호는 규칙이 다릅니다).
function hasValidBirthDate(matched: string): boolean {
  const digits = digitsOf(matched);
  const gender = Number(digits[6]);
  const century = [1, 2, 5, 6].includes(gender) ? 1900 : 2000;
  return isValidCalendarDate(
    century + Number(digits.slice(0, 2)),
    Number(digits.slice(2, 4)),
    Number(digits.slice(4, 6)),
  );
}

// 카드번호 앞자리: 3(Amex·JCB·Diners)·4(Visa)·5와 2(Mastercard)·6(Discover·UnionPay)·9(국내 전용카드).
// 0·1·7·8로 시작하면 전화번호 등일 가능성이 큽니다.
function looksLikeCardNumber(matched: string): boolean {
  const digits = digitsOf(matched);
  return (
    digits.length >= 14 &&
    digits.length <= 19 &&
    /^[234569]/.test(digits) &&
    !isRepeatedDigit(digits) &&
    passesLuhn(digits)
  );
}

function looksLikeBankAccount(matched: string): boolean {
  const digits = digitsOf(matched);
  if (digits.length < 9 || digits.length > 16 || isRepeatedDigit(digits)) return false;
  // 날짜(2024-01-01)는 계좌번호가 아닙니다.
  return !/^\d{4}-\d{2}-\d{2}$/.test(matched);
}

// 운전면허번호의 앞 두 자리는 지역 코드(11~28)입니다.
function hasLicenseRegionCode(matched: string): boolean {
  const region = Number(digitsOf(matched).slice(0, 2));
  return region >= 11 && region <= 28;
}

// 비밀번호 값은 숫자나 기호가 섞여 있어야 하고(문장 속 단어 제외), 가려 둔 값(****)은 제외합니다.
function looksLikePasswordValue(matched: string): boolean {
  if (/^[*•●xX#]+$/.test(matched)) return false;
  return /[0-9]/.test(matched) || /[^\p{L}\p{N}]/u.test(matched);
}

// 규칙의 순서가 곧 우선순위입니다. 두 규칙이 겹쳐 일치하면 앞선 규칙을 씁니다.
// (예: sk-…@example.com 에서는 이메일보다 API 키가 먼저입니다.)
// 경계 문자를 캡처/소비하지 않도록 lookbehind(?<!\d), (?<![A-Za-z0-9])를 사용합니다.
// 이렇게 하면 매칭 대상이 실제 민감정보 부분만이 되어 줄바꿈이 보존됩니다.
// "문맥 필수" 규칙(계좌·여권·면허·비밀번호)은 앞의 키워드를 lookbehind로 확인해, 키워드는 가리지 않고 값만 가립니다.
const RULES: readonly Rule[] = [
  {
    categoryId: "government_id",
    // 기본은 날짜 유효성이나 실제 번호 여부를 확인하지 않습니다(strictValidation으로 켤 수 있습니다).
    pattern: /(?<!\d)\d{6}[- ]?[1-8]\d{6}(?!\d)/,
    validate: (matched, options) => !options.strictValidation || hasValidBirthDate(matched),
  },
  {
    categoryId: "phone_number",
    // 국내 휴대전화·일부 지역번호·070·050 계열의 간단한 형식 검사입니다.
    pattern: /(?<!\d)0(?:2|[3-6]\d|1[016789]|70|50[2-8])[- .]?\d{3,4}[- .]?\d{4}(?!\d)/,
  },
  {
    categoryId: "api_key",
    // 일부 키 접두사만 다룹니다. 모든 서비스의 키를 찾지는 않습니다.
    pattern:
      /(?<![A-Za-z0-9])(?:sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|github_pat_[A-Za-z0-9_]{20,}|(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})(?![A-Za-z0-9])/,
  },
  {
    categoryId: "api_key",
    // JWT: 헤더와 본문이 모두 base64url의 {"로 시작합니다(eyJ).
    pattern:
      /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?![A-Za-z0-9_-])/,
  },
  {
    categoryId: "api_key",
    // 개인키 블록. 끝줄이 아직 없으면 시작줄만 일치합니다. 여러 줄에 걸치므로 편집기가 문단으로 나뉘어 있으면
    // 자동 마스킹이 안전하게 중단됩니다(안내는 뜹니다).
    pattern:
      /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----(?:[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----)?/,
  },
  {
    categoryId: "email",
    // RFC 전체가 아니라 업무용 식별 목적의 실용 패턴입니다.
    pattern: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?![A-Za-z])/,
  },
  {
    categoryId: "credit_card",
    // 4-4-4-(1~7) 또는 Amex·Diners 형식(4-6-4/5). 구분자는 공백 또는 하이픈입니다. Luhn 검사를 통과해야 합니다.
    pattern:
      /(?<![\d-])(?:\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{1,7}|\d{4}[ -]?\d{6}[ -]?\d{4,5})(?![\d-])/,
    validate: looksLikeCardNumber,
  },
  {
    categoryId: "bank_account",
    // 단독 숫자열은 너무 흔해서, 앞에 "계좌"나 은행 이름이 있을 때만 계좌번호로 봅니다.
    pattern:
      /(?<=(?:계좌\s*번호|계좌|입금\s*계좌|송금\s*계좌|account(?:\s*(?:no\.?|number|num))?|(?:국민|신한|우리|하나|기업|농협|새마을금고|우체국|SC제일|씨티|수협|IBK|KB)\s*은행|농협|카카오뱅크|토스뱅크|케이뱅크)\s*[:：]?\s*)(?<![\d-])(?:\d{2,6}(?:-\d{2,8}){1,3}|\d{10,14})(?![\d-])/i,
    validate: looksLikeBankAccount,
  },
  {
    categoryId: "passport_number",
    // 대한민국 여권번호: 영문 1자 + 숫자 7~8자. 문맥 단어("여권", "passport")가 앞에 있을 때만 봅니다.
    pattern:
      /(?<=(?:여권\s*번호|여권|passport(?:\s*(?:no\.?|number|num))?)\s*[:：]?\s*)(?<![A-Za-z0-9])[A-Za-z][0-9]{7,8}(?![A-Za-z0-9])/i,
  },
  {
    categoryId: "driver_license",
    // 11-12-123456-78 형식은 그 자체로 충분히 특이해서 문맥 없이 봅니다.
    pattern: /(?<![\d-])\d{2}-\d{2}-\d{6}-\d{2}(?![\d-])/,
    validate: hasLicenseRegionCode,
  },
  {
    categoryId: "driver_license",
    // 하이픈 없는 12자리는 앞에 "운전면허"·"면허번호"가 있을 때만 봅니다.
    pattern: /(?<=(?:운전\s*면허(?:\s*번호)?|면허\s*번호|면허증)\s*[:：]?\s*)(?<!\d)\d{12}(?!\d)/,
    validate: hasLicenseRegionCode,
  },
  {
    categoryId: "password",
    // "비밀번호: 값", "password=값", "비밀번호는 값"처럼 키워드와 값이 붙어 있을 때 값만 봅니다.
    pattern:
      /(?<=(?:password|passwd|pwd|비밀\s*번호|패스워드|암호)\s*(?:[:=：]|은|는|이|가|\bis\b)\s*)[^\s"'`,;]{6,64}/i,
    validate: looksLikePasswordValue,
  },
];

const labelOf = (rule: Rule): string => categoryDef(rule.categoryId)?.maskLabel ?? rule.categoryId;

function normalizeForDetection(text: string): string {
  // 전각 숫자·하이픈 등 표기 변형을 NFKC로 정규화한 뒤 검사합니다.
  // 마스킹은 원문 표기를 최대한 유지하며, 전각 변형은 탐지 우선·마스킹 제한을 README에 명시합니다.
  try {
    return typeof text.normalize === "function" ? text.normalize("NFKC") : text;
  } catch {
    return text;
  }
}

// --- 우회 입력 대응 -------------------------------------------------------------------------
// 사용자가 일부러(또는 우연히) 값을 알아보기 어렵게 쓴 경우를 위한 "탐지용 보기"입니다.
// inspect()만 이 보기를 쓰며, 마스킹은 원문 표기 그대로(전각은 정규화 보기까지만) 치환합니다.
// 그래서 이 보기에서만 찾은 값은 "있지만 위치를 특정할 수 없다"로 안내됩니다.

// 눈에 보이지 않는 문자: 소프트 하이픈, 제로폭 문자, 방향 표시, 단어 결합자, BOM
const INVISIBLE_CHARS = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g;

const KOREAN_DIGITS: Readonly<Record<string, string>> = {
  영: "0", 공: "0", 일: "1", 이: "2", 삼: "3", 사: "4", 오: "5", 육: "6", 륙: "6", 칠: "7", 팔: "8", 구: "9",
};
// 숫자 글자가 9개 이상 이어질 때만 숫자로 봅니다. 평범한 문장("이 일이 …")에서는 이렇게 길게 이어지지 않습니다.
const KOREAN_DIGIT_RUN = /[영공일이삼사오육륙칠팔구](?:[ .-]?[영공일이삼사오육륙칠팔구]){8,}/g;

function restoreHiddenForms(text: string): string {
  return text
    .replace(INVISIBLE_CHARS, "")
    .replace(KOREAN_DIGIT_RUN, (run) => run.replace(/[영공일이삼사오육륙칠팔구]/g, (c) => KOREAN_DIGITS[c] ?? c));
}

const MAX_ENCODED_BLOBS = 20;
const MAX_BLOB_LENGTH = 4096;

// 문자열을 UTF-8 텍스트로 풀 수 있고 대부분 읽을 수 있는 글자일 때만 돌려줍니다.
function decodeBase64Text(token: string): string | null {
  if (typeof atob !== "function") return null;
  try {
    const normalized = token.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    const text = decodeURIComponent(
      Array.from(binary, (c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join(""),
    );
    if (text.length < 6) return null;
    const readable = Array.from(text).filter((c) => c >= " " || c === "\n" || c === "\t").length;
    return readable / text.length >= 0.9 ? text : null;
  } catch {
    return null;
  }
}

// URL 인코딩(%2D)과 Base64로 감싼 값을 한 단계만 풉니다. 개수와 길이에 제한이 있습니다.
function decodeEmbedded(text: string): string[] {
  const decoded: string[] = [];

  if (/%[0-9A-Fa-f]{2}/.test(text)) {
    let url: string;
    try {
      url = decodeURIComponent(text);
    } catch {
      url = text.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
        try {
          return decodeURIComponent(run);
        } catch {
          return run;
        }
      });
    }
    if (url !== text) decoded.push(url);
  }

  const tokens = text.match(/[A-Za-z0-9+/_-]{16,}={0,2}/g) ?? [];
  for (const token of tokens.slice(0, MAX_ENCODED_BLOBS)) {
    if (token.length > MAX_BLOB_LENGTH) continue;
    const plain = decodeBase64Text(token);
    if (plain !== null) decoded.push(plain);
  }
  return decoded;
}

// 탐지용 보기: 정규화한 원문 + (숨은 문자·한글 숫자를 되돌린 것) + (풀어낸 인코딩). 줄바꿈으로 이어 붙입니다.
function detectionView(text: string): string {
  const normalized = normalizeForDetection(text);
  const views = [normalized];
  const restored = restoreHiddenForms(normalized);
  if (restored !== normalized) views.push(restored);
  views.push(...decodeEmbedded(restored));
  return views.join("\n");
}

// 설정에서 끈 범주는 탐지·마스킹 대상에서 제외합니다.
// options를 넘기지 않으면 모든 범주를 사용합니다.
function selectRules(options?: DetectorOptions | null): readonly Rule[] {
  const disabled =
    options && Array.isArray(options.disabledCategories) ? options.disabledCategories : [];
  if (disabled.length === 0) {
    return RULES;
  }
  const skip = new Set(disabled);
  return RULES.filter((rule) => !skip.has(rule.categoryId));
}

// 허용 목록 비교용 값: 공백·구분 기호·대소문자를 뺍니다. (010-0000-0000 과 01000000000 은 같은 값입니다.)
function allowKey(value: string): string {
  return normalizeForDetection(value).toLowerCase().replace(/[^0-9a-zㄱ-ㆎ가-힣]/g, "");
}

const allowCache = new WeakMap<readonly string[], ReadonlySet<string>>();

function allowedKeys(options?: DetectorOptions | null): ReadonlySet<string> | null {
  const list = options && Array.isArray(options.allowlist) ? options.allowlist : null;
  if (!list || list.length === 0) return null;
  let keys = allowCache.get(list);
  if (!keys) {
    keys = new Set(list.map((item) => allowKey(String(item))).filter((key) => key.length > 0));
    allowCache.set(list, keys);
  }
  return keys;
}

// 정규식이 찾은 값이 정말 그 범주인지(검증 함수)와 허용 목록에 없는지 확인합니다.
function accepts(
  rule: Rule,
  matched: string,
  options: DetectorOptions,
  allowed: ReadonlySet<string> | null,
): boolean {
  if (rule.validate && !rule.validate(matched, options)) return false;
  return !(allowed && allowed.has(allowKey(matched)));
}

// 전역 정규식은 호출 때마다 새로 만들어 lastIndex 상태를 공유하지 않습니다.
function globalPattern(rule: Rule): RegExp {
  return new RegExp(rule.pattern.source, rule.pattern.flags.replace("g", "") + "g");
}

// 일치한 구간의 위치를 함께 돌려줍니다.
// content.js가 입력란 구조를 통째로 다시 쓰지 않고 해당 구간만 바꾸기 위해 씁니다.
// 여기서 반환하는 값도 범주 ID와 위치뿐이며, 일치한 문자열은 담지 않습니다.
function findMatches(text: unknown, options?: DetectorOptions | null): DetectedMatch[] {
  if (typeof text !== "string" || text.length === 0) {
    return [];
  }

  const resolved = options ?? {};
  const allowed = allowedKeys(options);
  const found: DetectedMatch[] = [];
  for (const rule of selectRules(options)) {
    const pattern = globalPattern(rule);
    let hit = pattern.exec(text);
    while (hit !== null) {
      if (accepts(rule, hit[0], resolved, allowed)) {
        found.push({
          categoryId: rule.categoryId,
          label: labelOf(rule),
          start: hit.index,
          end: hit.index + hit[0].length,
        });
      }
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
  const source = typeof text === "string" ? detectionView(text) : "";
  const resolved = options ?? {};
  const allowed = allowedKeys(options);
  const found = new Set<CategoryId>();

  for (const rule of selectRules(options)) {
    if (found.has(rule.categoryId)) continue;
    const pattern = globalPattern(rule);
    let hit = pattern.exec(source);
    while (hit !== null) {
      if (accepts(rule, hit[0], resolved, allowed)) {
        found.add(rule.categoryId);
        break;
      }
      if (hit[0].length === 0) {
        pattern.lastIndex += 1;
      }
      hit = pattern.exec(source);
    }
  }
  return [...found];
}

// 규칙 순서대로 한 규칙씩 치환합니다.
function replaceAll(source: string, rules: readonly Rule[], options: DetectorOptions): string {
  const allowed = allowedKeys(options);
  let masked = source;
  for (const rule of rules) {
    masked = masked.replace(globalPattern(rule), (matched) =>
      accepts(rule, matched, options, allowed) ? `[${labelOf(rule)}]` : matched,
    );
  }
  return masked;
}

function mask(text: unknown, options?: DetectorOptions | null): string {
  const rules = selectRules(options);
  const resolved = options ?? {};
  const source = typeof text === "string" ? text : "";
  const normalized = typeof text === "string" ? normalizeForDetection(text) : "";
  const masked = replaceAll(source, rules, resolved);

  // 전각 변형 등 원문 표기가 달라 치환되지 않은 경우,
  // 정규화된 보기에서 탐지된 부분은 가려 구조 노출을 줄입니다.
  if (normalized !== source && masked === source) {
    const normalizedMasked = replaceAll(normalized, rules, resolved);
    if (normalizedMasked !== normalized) {
      return normalizedMasked;
    }
  }
  return masked;
}

export const detector = Object.freeze({ inspect, findMatches, applyMatches, mask });
export type Detector = typeof detector;
