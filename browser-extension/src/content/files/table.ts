// 표(CSV·XLSX)를 읽고 열 단위로 판정합니다. "연락처 열의 대부분이 전화번호 형식이다" 같은 판단을 하고,
// 감지된 값이 있는 행의 수를 세어 대량 반출을 알아봅니다. 열 머리글의 글자나 값은 결과에 담지 않습니다.
import type { Detector, DetectorOptions } from "../../engine/detector.ts";
import type { CategoryId } from "../../shared/categories.ts";
import { yieldToUi } from "./text.ts";
import type { FlaggedColumn } from "./types.ts";

export const MAX_TABLE_ROWS = 50_000; // 읽는 행의 상한
const SAMPLE_ROWS = 200; // 열의 성격을 정할 때 보는 행 수
const FLAG_RATIO = 0.5; // 비어 있지 않은 값 중 이 비율 이상이면 그 열을 해당 범주 열로 본다
const COUNT_ROWS = 20_000; // 행 수를 세는 상한
const YIELD_EVERY = 2000;

const DELIMITERS = [",", "\t", ";", "|"] as const;

// 앞쪽 몇 줄에서 가장 일정하게 나오는 구분자를 고릅니다.
function detectDelimiter(text: string, hint?: string): string {
  if (hint) return hint;
  const lines = text.split(/\r?\n/, 8).filter((line) => line.length > 0);
  let best = ",";
  let bestScore = 0;
  for (const delimiter of DELIMITERS) {
    const counts = lines.map((line) => line.split(delimiter).length - 1);
    const first = counts[0] ?? 0;
    if (first === 0) continue;
    const consistent = counts.filter((count) => count === first).length;
    const score = consistent * 1000 + first;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }
  return best;
}

// RFC 4180 방식: 따옴표 안의 구분자·줄바꿈, ""로 쓴 따옴표를 처리합니다.
export function parseDelimited(
  text: string,
  options: { delimiter?: string; maxRows?: number } = {},
): { rows: string[][]; truncated: boolean } {
  const delimiter = detectDelimiter(text, options.delimiter);
  const maxRows = options.maxRows ?? MAX_TABLE_ROWS;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let truncated = false;

  const endRow = (): boolean => {
    row.push(field);
    field = "";
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
    return rows.length >= maxRows;
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === "") {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      if (endRow()) {
        truncated = index < text.length - 1;
        return { rows, truncated };
      }
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) endRow();
  return { rows, truncated };
}

export interface TableAnalysis {
  readonly categories: readonly CategoryId[];
  readonly columns: readonly FlaggedColumn[];
  readonly recordCount: number;
  readonly truncated: boolean;
}

const hasValue = (cell: string | undefined): cell is string => cell !== undefined && cell.trim() !== "";

export async function analyzeTable(
  rows: readonly (readonly string[])[],
  sheet: number,
  detector: Detector,
  options: DetectorOptions,
  alreadyTruncated = false,
): Promise<TableAnalysis> {
  if (rows.length === 0) return { categories: [], columns: [], recordCount: 0, truncated: alreadyTruncated };

  // 첫 줄이 머리글이면(값이 하나도 감지되지 않는 글자뿐) 성격 판단에서 뺍니다.
  const first = rows[0]!;
  const looksLikeHeader = rows.length > 1 && first.every((cell) => !hasValue(cell) || detector.inspect(cell, options).length === 0);
  const dataStart = looksLikeHeader ? 1 : 0;
  const data = rows.slice(dataStart);

  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const sample = data.slice(0, SAMPLE_ROWS);
  const seen = new Set<CategoryId>();
  const flagged: FlaggedColumn[] = [];

  for (let column = 0; column < width; column += 1) {
    let nonEmpty = 0;
    const hits = new Map<CategoryId, number>();
    for (const row of sample) {
      const cell = row[column];
      if (!hasValue(cell)) continue;
      nonEmpty += 1;
      for (const category of detector.inspect(cell, options)) {
        seen.add(category);
        hits.set(category, (hits.get(category) ?? 0) + 1);
      }
    }
    for (const [category, count] of hits) {
      const ratio = count / nonEmpty;
      if (ratio >= FLAG_RATIO) flagged.push({ sheet, column, category, ratio: Math.round(ratio * 100) / 100 });
    }
  }

  // 감지된 값이 있는 행의 수: 열 성격이 정해진 열만 다시 봅니다(전체를 다 훑지 않아 빠릅니다).
  let recordCount = 0;
  const limit = Math.min(data.length, COUNT_ROWS);
  for (let index = 0; index < limit; index += 1) {
    const row = data[index]!;
    for (const column of flagged) {
      const cell = row[column.column];
      if (hasValue(cell) && detector.inspect(cell, options).includes(column.category)) {
        recordCount += 1;
        break;
      }
    }
    if (index % YIELD_EVERY === YIELD_EVERY - 1) await yieldToUi();
  }

  return {
    categories: [...seen],
    columns: flagged,
    recordCount,
    truncated: alreadyTruncated || data.length > COUNT_ROWS,
  };
}

// A, B, ..., Z, AA ... (스프레드시트 열 이름)
export function columnLetter(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}
