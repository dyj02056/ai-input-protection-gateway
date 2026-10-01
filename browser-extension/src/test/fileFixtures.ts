// 테스트용 파일 만들기: ZIP과 그 위에 얹은 DOCX·XLSX·HWPX를 코드로 만듭니다(고정 바이너리 파일 없음).
import { crc32, deflateRawSync } from "node:zlib";

export interface ZipFileSpec {
  readonly name: string;
  readonly data: string | Uint8Array;
  // 압축하지 않고 저장(method 0)
  readonly store?: boolean;
  // 암호화 표시(flag bit 0)만 켭니다. 내용은 풀지 않으므로 그대로 둡니다.
  readonly encrypted?: boolean;
}

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

function u16(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}
function u32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

export function buildZip(files: readonly ZipFileSpec[], comment = ""): Uint8Array {
  const parts: number[] = [];
  const central: number[] = [];
  const push = (target: number[], bytes: ArrayLike<number>) => {
    for (let index = 0; index < bytes.length; index += 1) target.push(bytes[index]!);
  };

  for (const file of files) {
    const raw = typeof file.data === "string" ? utf8(file.data) : file.data;
    const method = file.store ? 0 : 8;
    const compressed = file.store ? raw : new Uint8Array(deflateRawSync(raw));
    const name = utf8(file.name);
    const flags = 0x800 | (file.encrypted ? 0x1 : 0);
    const crc = crc32(raw);
    const offset = parts.length;

    push(parts, [...u32(0x04034b50), ...u16(20), ...u16(flags), ...u16(method), ...u16(0), ...u16(0x21)]);
    push(parts, [...u32(crc), ...u32(compressed.length), ...u32(raw.length), ...u16(name.length), ...u16(0)]);
    push(parts, name);
    push(parts, compressed);

    push(central, [...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(flags), ...u16(method), ...u16(0), ...u16(0x21)]);
    push(central, [...u32(crc), ...u32(compressed.length), ...u32(raw.length), ...u16(name.length), ...u16(0), ...u16(0)]);
    push(central, [...u16(0), ...u16(0), ...u32(0), ...u32(offset)]);
    push(central, name);
  }

  const directoryOffset = parts.length;
  push(parts, central);
  const commentBytes = utf8(comment);
  push(parts, [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length)]);
  push(parts, [...u32(central.length), ...u32(directoryOffset), ...u16(commentBytes.length)]);
  push(parts, commentBytes);
  return Uint8Array.from(parts);
}

const escapeXml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function makeDocx(paragraphs: readonly string[], extraParts: Record<string, readonly string[]> = {}): Uint8Array {
  const body = (items: readonly string[]) =>
    items.map((text) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`).join("");
  const files: ZipFileSpec[] = [
    { name: "[Content_Types].xml", data: "<Types/>" },
    { name: "word/document.xml", data: `<w:document><w:body>${body(paragraphs)}</w:body></w:document>` },
  ];
  for (const [name, items] of Object.entries(extraParts)) {
    files.push({ name, data: `<w:root>${body(items)}</w:root>` });
  }
  return buildZip(files);
}

export interface XlsxSheetSpec {
  readonly rows: readonly (readonly (string | number)[])[];
  readonly inline?: boolean; // 공유 문자열 대신 인라인 문자열로 저장
}

function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

export function makeXlsx(sheets: readonly XlsxSheetSpec[], options: { hiddenSecond?: boolean } = {}): Uint8Array {
  const shared: string[] = [];
  const sharedIndex = (text: string): number => {
    const found = shared.indexOf(text);
    if (found >= 0) return found;
    shared.push(text);
    return shared.length - 1;
  };

  const files: ZipFileSpec[] = [{ name: "[Content_Types].xml", data: "<Types/>" }];
  sheets.forEach((sheet, sheetIndex) => {
    const rows = sheet.rows
      .map((row, rowIndex) => {
        const cells = row
          .map((value, columnIndex) => {
            const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
            if (typeof value === "number") return `<c r="${ref}"><v>${value}</v></c>`;
            if (sheet.inline) return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
            return `<c r="${ref}" t="s"><v>${sharedIndex(value)}</v></c>`;
          })
          .join("");
        return `<row r="${rowIndex + 1}">${cells}</row>`;
      })
      .join("");
    files.push({ name: `xl/worksheets/sheet${sheetIndex + 1}.xml`, data: `<worksheet><sheetData>${rows}</sheetData></worksheet>` });
  });
  files.push({
    name: "xl/sharedStrings.xml",
    data: `<sst>${shared.map((text) => `<si><t>${escapeXml(text)}</t></si>`).join("")}</sst>`,
  });
  files.push({
    name: "xl/workbook.xml",
    data: `<workbook><sheets>${sheets
      .map((_, index) => `<sheet name="S${index + 1}"${options.hiddenSecond && index === 1 ? ' state="hidden"' : ""}/>`)
      .join("")}</sheets></workbook>`,
  });
  return buildZip(files);
}

export function makeHwpx(paragraphs: readonly string[], preview?: string): Uint8Array {
  const files: ZipFileSpec[] = [
    { name: "mimetype", data: "application/hwp+zip", store: true },
    {
      name: "Contents/section0.xml",
      data: `<hs:sec>${paragraphs.map((text) => `<hp:p><hp:run><hp:t>${escapeXml(text)}</hp:t></hp:run></hp:p>`).join("")}</hs:sec>`,
    },
  ];
  if (preview !== undefined) files.push({ name: "Preview/PrvText.txt", data: preview });
  return buildZip(files);
}

// 구형 Office·HWP(그리고 암호가 걸린 최신 Office)의 파일 머리: OLE 복합 문서
export const OLE_HEADER = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0, 0, 0, 0, 0]);

export function makeFile(bytes: Uint8Array | string, name: string, type = ""): File {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  return new File([data as BlobPart], name, { type });
}

// EUC-KR(CP949)로 인코딩한 CSV 바이트를 만들 때 씁니다. TextEncoder는 UTF-8만 지원하므로 표를 직접 만듭니다.
export function encodeEucKr(text: string): Uint8Array {
  // Node의 TextDecoder("euc-kr")로 모든 한글 음절의 코드를 한 번 역산해 표를 만듭니다.
  const decoder = new TextDecoder("euc-kr");
  const table = new Map<string, number[]>();
  for (let high = 0xb0; high <= 0xc8; high += 1) {
    for (let low = 0xa1; low <= 0xfe; low += 1) {
      const char = decoder.decode(Uint8Array.from([high, low]));
      if (char.length === 1 && char !== "�") table.set(char, [high, low]);
    }
  }
  const out: number[] = [];
  for (const char of text) {
    const mapped = table.get(char);
    if (mapped) out.push(...mapped);
    else if (char.charCodeAt(0) < 0x80) out.push(char.charCodeAt(0));
    else throw new Error(`EUC-KR 표에 없는 글자: ${char}`);
  }
  return Uint8Array.from(out);
}
