// 파일에서 읽은 바이트를 글자로 바꾸는 도우미입니다(인코딩 판별, XML에서 글자 뽑기).

// 한국어 CSV는 엑셀이 CP949(EUC-KR)로 저장하는 경우가 많아, UTF-8로 안 읽히면 EUC-KR로 읽습니다.
export function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("euc-kr").decode(bytes);
  }
}

// 앞부분에 NUL(0) 바이트가 있으면 텍스트 파일이 아닙니다(UTF-16 BOM이 있으면 예외).
export function looksBinary(bytes: Uint8Array): boolean {
  if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
    return false;
  }
  const limit = Math.min(bytes.length, 4096);
  for (let index = 0; index < limit; index += 1) {
    if (bytes[index] === 0) return true;
  }
  return false;
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (matched, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : matched;
    }
    return NAMED_ENTITIES[body] ?? matched;
  });
}

// 문단·줄 끝 태그: Word(w:p), 한글(hp:p), 표 셀 등. 이 자리에서 줄을 바꿔 값이 서로 붙지 않게 합니다.
const BREAK_TAGS = /<\/(?:w:p|a:p|hp:p|text:p|p|tr|row|si)>|<(?:w:br|w:cr|hp:lineBreak|br)\b[^>]*\/?>/gi;
const TAB_TAGS = /<(?:w:tab|hp:tab)\b[^>]*\/?>/gi;

// XML에서 사람이 읽는 글자만 뽑습니다. 삭제된 변경 추적 글자(w:delText)도 글자로 남습니다
// (지운 줄 알았던 개인정보가 숨어 있을 수 있어 검사 대상에 넣는 것이 맞습니다).
export function xmlToText(xml: string): string {
  return decodeEntities(
    xml
      .replace(BREAK_TAGS, "\n")
      .replace(TAB_TAGS, "\t")
      .replace(/<[^>]*>/g, ""),
  );
}

// 한 번에 오래 붙잡지 않도록 이벤트 루프에 숨 쉴 틈을 줍니다.
export const yieldToUi = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
