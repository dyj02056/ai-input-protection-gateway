// DOCX·XLSX·HWPX에서 글자와 표를 뽑습니다. 모두 ZIP 안의 XML이라 zip.ts와 text.ts만 씁니다.
import { listZipEntries, readEntry, type Inflate, type ZipEntry } from "./zip.ts";
import { decodeEntities, decodeText, xmlToText } from "./text.ts";
import { FileInspectError } from "./types.ts";

export const MAX_ENTRY_BYTES = 30 * 1024 * 1024; // 한 항목이 풀린 뒤의 상한
export const MAX_TOTAL_BYTES = 80 * 1024 * 1024; // 한 파일 전체의 풀린 크기 상한(압축 폭탄 방어)
const MAX_SHEETS = 20;

interface Archive {
  readonly bytes: Uint8Array;
  readonly entries: ZipEntry[];
  readonly inflate?: Inflate;
  budget: number;
}

export function openArchive(bytes: Uint8Array, inflate?: Inflate): Archive {
  const entries = listZipEntries(bytes);
  return { bytes, entries, inflate, budget: MAX_TOTAL_BYTES };
}

export function hasEncryptedEntry(archive: Archive): boolean {
  return archive.entries.some((entry) => entry.encrypted);
}

async function readText(archive: Archive, entry: ZipEntry): Promise<string> {
  const limit = Math.min(MAX_ENTRY_BYTES, archive.budget);
  const bytes = await readEntry(archive.bytes, entry, limit, archive.inflate);
  archive.budget -= bytes.length;
  if (archive.budget < 0) throw new FileInspectError("too-large", "압축을 풀면 너무 커집니다.");
  return decodeText(bytes);
}

const byName = (entries: ZipEntry[], pattern: RegExp): ZipEntry[] =>
  entries.filter((entry) => pattern.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));

// ---- DOCX: 본문·머리글·바닥글·주석·각주(삭제된 변경 추적 글자 포함) ----
export async function extractDocx(archive: Archive): Promise<string> {
  const parts = byName(archive.entries, /^word\/(?:document|header\d*|footer\d*|comments|footnotes|endnotes)\.xml$/i);
  if (parts.length === 0) throw new FileInspectError("corrupt", "DOCX 본문을 찾지 못했습니다.");
  const texts: string[] = [];
  for (const part of parts) texts.push(xmlToText(await readText(archive, part)));
  return texts.join("\n");
}

// ---- HWPX(한글): 구역 본문과 미리보기 텍스트 ----
export async function extractHwpx(archive: Archive): Promise<string> {
  const sections = byName(archive.entries, /^Contents\/section\d+\.xml$/i);
  if (sections.length === 0) throw new FileInspectError("corrupt", "HWPX 본문을 찾지 못했습니다.");
  const texts: string[] = [];
  for (const section of sections) texts.push(xmlToText(await readText(archive, section)));
  const preview = archive.entries.find((entry) => /^Preview\/PrvText\.txt$/i.test(entry.name));
  if (preview) texts.push(await readText(archive, preview));
  return texts.join("\n");
}

// ---- XLSX: 공유 문자열 + 시트의 셀. 숨김 시트도 읽습니다(숨겨 둔 값이 반출되는 경우가 있습니다) ----
function sharedStrings(xml: string): string[] {
  const strings: string[] = [];
  for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    // 발음 표기(rPh)는 제외하고 글자 조각(t)만 이어 붙입니다.
    const inner = match[1]!.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
    const parts = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((part) => decodeEntities(part[1]!));
    strings.push(parts.join(""));
  }
  return strings;
}

function columnIndex(reference: string): number {
  let index = 0;
  for (const char of reference) {
    const code = char.charCodeAt(0);
    if (code < 65 || code > 90) break;
    index = index * 26 + (code - 64);
  }
  return Math.max(0, index - 1);
}

function parseSheet(xml: string, strings: readonly string[], maxRows: number): { rows: string[][]; truncated: boolean } {
  const rows: string[][] = [];
  let truncated = false;
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    if (rows.length >= maxRows) {
      truncated = true;
      break;
    }
    const row: string[] = [];
    for (const cellMatch of rowMatch[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cellMatch[1] ?? "";
      const inner = cellMatch[2] ?? "";
      const reference = /\br="([A-Z]+)\d*"/.exec(attributes)?.[1] ?? "";
      const type = /\bt="(\w+)"/.exec(attributes)?.[1] ?? "n";
      let value = "";
      if (type === "inlineStr") {
        value = xmlToText(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? "");
      } else {
        const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "";
        value = type === "s" ? (strings[Number(raw)] ?? "") : decodeEntities(raw);
      }
      const column = reference ? columnIndex(reference) : row.length;
      while (row.length < column) row.push("");
      row[column] = value;
    }
    rows.push(row);
  }
  return { rows, truncated };
}

export interface Sheet {
  readonly rows: string[][];
  readonly truncated: boolean;
}

export async function extractXlsx(archive: Archive, maxRows: number): Promise<Sheet[]> {
  const sharedEntry = archive.entries.find((entry) => /^xl\/sharedStrings\.xml$/i.test(entry.name));
  const strings = sharedEntry ? sharedStrings(await readText(archive, sharedEntry)) : [];
  const sheetEntries = byName(archive.entries, /^xl\/worksheets\/sheet\d+\.xml$/i).slice(0, MAX_SHEETS);
  if (sheetEntries.length === 0) throw new FileInspectError("corrupt", "XLSX 시트를 찾지 못했습니다.");
  const sheets: Sheet[] = [];
  for (const entry of sheetEntries) sheets.push(parseSheet(await readText(archive, entry), strings, maxRows));
  return sheets;
}
