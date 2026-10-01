// 파일 한 개를 이 브라우저 안에서 검사합니다. 파일은 어디로도 보내거나 저장하지 않습니다.
//
// 원칙(계획서 3.5): 지원하지 않는 형식·해석 실패·암호화 파일을 "검사 없이 통과"시키지 않습니다.
// 검사하지 못했다는 사실을 결과(status)로 돌려주고, 안내와 전송 차단이 그것을 다룹니다.
import type { Detector, DetectorOptions } from "../../engine/detector.ts";
import { CATEGORY_IDS, type ActionName, type CategoryId } from "../../shared/categories.ts";
import { decideLocalAction } from "../decision.ts";
import {
  extractDocx,
  extractHwpx,
  extractXlsx,
  hasEncryptedEntry,
  openArchive,
} from "./formats.ts";
import { analyzeTable, MAX_TABLE_ROWS, parseDelimited, type TableAnalysis } from "./table.ts";
import { decodeText, looksBinary, yieldToUi } from "./text.ts";
import { FileInspectError, type FileFinding, type FileStatus, type FlaggedColumn } from "./types.ts";
import { isZip, type Inflate } from "./zip.ts";

export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 이보다 큰 파일은 검사하지 않습니다
export const BULK_RECORD_THRESHOLD = 100; // 감지된 행이 이만큼 이상이면 대량으로 봅니다(계획서의 대량 고객정보 규칙)

const CHUNK_CHARS = 400_000;
const CHUNK_OVERLAP = 256; // 값이 조각 경계에 걸려도 잡히도록 조금 겹칩니다
const MAX_TEXT_CHARS = 4_000_000;

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "log", "json", "yaml", "yml", "xml", "ini", "conf", "cfg", "env", "properties", "toml", "sql",
  "js", "ts", "jsx", "tsx", "py", "java", "go", "rb", "php", "sh", "bat", "ps1", "cs", "cpp", "c", "h", "kt", "swift", "html", "css",
]);
const DELIMITED_EXTENSIONS = new Set(["csv", "tsv"]);
const OOXML_EXTENSIONS = new Set(["docx", "xlsx", "hwpx"]);
const LEGACY_EXTENSIONS = new Set(["doc", "xls", "ppt", "hwp"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "heic", "tif", "tiff", "svg"]);
const ARCHIVE_EXTENSIONS = new Set(["zip", "7z", "rar", "gz", "tar", "tgz"]);

const REASON = {
  encryptedOffice: "암호가 걸려 있어 내용을 검사하지 못했습니다",
  encryptedPdf: "암호가 걸린 PDF라 내용을 검사하지 못했습니다",
  encryptedZip: "암호가 걸린 압축 파일이라 내용을 검사하지 못했습니다",
  legacy: "구형 형식(.doc·.xls·.ppt·.hwp)이라 내용을 검사하지 못합니다. 최신 형식(.docx·.xlsx·.hwpx)으로 저장하면 검사할 수 있습니다",
  pdf: "PDF 내용 검사는 아직 지원하지 않아 파일 이름과 크기만 확인했습니다",
  image: "이미지는 글자 인식(OCR)을 지원하지 않아 내용을 검사하지 못합니다",
  archive: "압축 파일은 내용을 검사하지 못합니다",
  unsupported: "지원하지 않는 형식이라 내용을 검사하지 못합니다",
  binary: "텍스트가 아닌 내용이라 검사하지 못했습니다",
  mismatch: "확장자와 실제 내용이 달라 검사하지 못했습니다",
  failed: "파일을 해석하지 못했습니다(손상됐거나 특이한 형식일 수 있습니다)",
  tooLarge: "파일이 커서(25MB 초과) 검사하지 않았습니다",
  read: "파일을 읽지 못했습니다",
} as const;

export interface InspectDeps {
  readonly detector: Detector;
  readonly options: DetectorOptions;
  // 테스트에서 압축 해제기를 바꿔 끼울 때 씁니다. 기본은 브라우저 내장 DecompressionStream입니다.
  readonly inflate?: Inflate;
}

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
};

type Sniffed = "zip" | "ole" | "pdf" | "image" | "other";

function sniff(bytes: Uint8Array): Sniffed {
  if (isZip(bytes)) return "zip";
  const startsWith = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  if (startsWith(0xd0, 0xcf, 0x11, 0xe0)) return "ole"; // 구형 Office·HWP, 그리고 암호가 걸린 최신 Office
  if (startsWith(0x25, 0x50, 0x44, 0x46)) return "pdf"; // %PDF
  if (startsWith(0x89, 0x50, 0x4e, 0x47) || startsWith(0xff, 0xd8, 0xff) || startsWith(0x47, 0x49, 0x46, 0x38) || startsWith(0x42, 0x4d)) {
    return "image";
  }
  if (startsWith(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45) return "image"; // RIFF....WEBP
  return "other";
}

const priority: Readonly<Record<ActionName, number>> = { ALLOW: 1, MASK: 2, REQUIRE_APPROVAL: 3, BLOCK: 4 };

// 파일에 대한 로컬 판정.
// - 감지된 것이 없으면 ALLOW.
// - 감지됐다면 정책 엔진의 판정을 따르되, 파일은 값을 가릴 수 없으므로(MASK 불가) 최소 REQUIRE_APPROVAL.
// - 표에서 감지된 행이 BULK_RECORD_THRESHOLD 이상이면 BLOCK(대량 반출).
// - 검사하지 못한 파일(암호화·미지원·실패·너무 큼)은 REQUIRE_APPROVAL: 조용히 통과시키지 않습니다.
// 이 판정은 브라우저 안의 규칙이며, PDP 서버 정책과는 별개입니다.
export function decideFileAction(
  status: FileStatus,
  categories: readonly CategoryId[],
  recordCount = 0,
): ActionName {
  if (status === "clean") return "ALLOW";
  if (status !== "detected") return "REQUIRE_APPROVAL";
  let action = decideLocalAction(categories) as ActionName;
  if (priority[action] === undefined || priority[action] < priority.REQUIRE_APPROVAL) action = "REQUIRE_APPROVAL";
  if (recordCount >= BULK_RECORD_THRESHOLD) action = "BLOCK";
  return action;
}

function finding(
  file: { name: string; size: number },
  status: FileStatus,
  extra: {
    reason?: string;
    categories?: readonly CategoryId[];
    columns?: readonly FlaggedColumn[];
    recordCount?: number;
    truncated?: boolean;
  } = {},
): FileFinding {
  const categories = extra.categories ?? [];
  return {
    name: file.name,
    size: file.size,
    status,
    ...(extra.reason ? { reason: extra.reason } : {}),
    categories,
    ...(extra.columns && extra.columns.length > 0 ? { columns: extra.columns } : {}),
    ...(extra.recordCount !== undefined ? { recordCount: extra.recordCount } : {}),
    ...(extra.truncated ? { truncated: true } : {}),
    action: decideFileAction(status, categories, extra.recordCount),
  };
}

// 긴 글을 조각으로 나눠 검사합니다(이벤트 루프를 오래 붙잡지 않도록 사이사이 양보합니다).
async function detectInText(text: string, deps: InspectDeps): Promise<{ categories: Set<CategoryId>; truncated: boolean }> {
  const found = new Set<CategoryId>();
  const limited = text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
  for (let start = 0; start < limited.length; start += CHUNK_CHARS) {
    const chunk = limited.slice(Math.max(0, start - CHUNK_OVERLAP), start + CHUNK_CHARS);
    for (const category of deps.detector.inspect(chunk, deps.options)) found.add(category);
    if (start + CHUNK_CHARS < limited.length) await yieldToUi();
  }
  return { categories: found, truncated: text.length > MAX_TEXT_CHARS };
}

function mergeTables(tables: readonly TableAnalysis[]): { columns: FlaggedColumn[]; recordCount: number; categories: CategoryId[]; truncated: boolean } {
  return {
    columns: tables.flatMap((table) => [...table.columns]),
    recordCount: tables.reduce((sum, table) => sum + table.recordCount, 0),
    categories: [...new Set(tables.flatMap((table) => [...table.categories]))],
    truncated: tables.some((table) => table.truncated),
  };
}

// 글자(와 표)를 검사한 결과를 하나의 판정으로 모읍니다.
async function finish(
  file: { name: string; size: number },
  text: string,
  tables: readonly TableAnalysis[],
  deps: InspectDeps,
  extraTruncated = false,
): Promise<FileFinding> {
  const textResult = await detectInText(text, deps);
  const table = mergeTables(tables);
  const categories = CATEGORY_IDS.filter((id) => textResult.categories.has(id) || table.categories.includes(id));
  const truncated = textResult.truncated || table.truncated || extraTruncated;
  const isTable = tables.length > 0;
  return finding(file, categories.length > 0 ? "detected" : "clean", {
    categories,
    columns: table.columns,
    ...(isTable ? { recordCount: table.recordCount } : {}),
    truncated,
  });
}

async function inspectBytes(
  file: { name: string; size: number },
  bytes: Uint8Array,
  deps: InspectDeps,
): Promise<FileFinding> {
  const ext = extensionOf(file.name);
  const kind = sniff(bytes);

  // --- 최신 Office·한글(ZIP 기반) ---
  if (OOXML_EXTENSIONS.has(ext)) {
    if (kind === "ole") return finding(file, "encrypted", { reason: REASON.encryptedOffice }); // 암호가 걸리면 OLE 상자에 담깁니다
    if (kind !== "zip") return finding(file, "uninspected", { reason: REASON.mismatch });
    const archive = openArchive(bytes, deps.inflate);
    if (hasEncryptedEntry(archive)) return finding(file, "encrypted", { reason: REASON.encryptedOffice });
    if (ext === "docx") return finish(file, await extractDocx(archive), [], deps);
    if (ext === "hwpx") return finish(file, await extractHwpx(archive), [], deps);
    const sheets = await extractXlsx(archive, MAX_TABLE_ROWS);
    const tables: TableAnalysis[] = [];
    const flat: string[] = [];
    for (const [index, sheet] of sheets.entries()) {
      tables.push(await analyzeTable(sheet.rows, index, deps.detector, deps.options, sheet.truncated));
      flat.push(sheet.rows.map((row) => row.join("\t")).join("\n"));
    }
    return finish(file, flat.join("\n"), tables, deps);
  }

  // --- 구형 형식 ---
  if (LEGACY_EXTENSIONS.has(ext) || kind === "ole") {
    return finding(file, "uninspected", { reason: REASON.legacy });
  }

  // --- PDF ---
  if (ext === "pdf" || kind === "pdf") {
    if (kind !== "pdf") return finding(file, "uninspected", { reason: REASON.mismatch });
    const raw = new TextDecoder("latin1").decode(bytes);
    if (raw.includes("/Encrypt")) return finding(file, "encrypted", { reason: REASON.encryptedPdf });
    return finding(file, "uninspected", { reason: REASON.pdf });
  }

  // --- 이미지 ---
  if (IMAGE_EXTENSIONS.has(ext) || kind === "image") {
    return finding(file, "uninspected", { reason: REASON.image });
  }

  // --- 압축 파일 ---
  if (ARCHIVE_EXTENSIONS.has(ext) || kind === "zip") {
    if (kind === "zip") {
      try {
        if (hasEncryptedEntry(openArchive(bytes, deps.inflate))) {
          return finding(file, "encrypted", { reason: REASON.encryptedZip });
        }
      } catch {
        // 목록을 못 읽어도 아래에서 "압축 파일은 검사하지 못함"으로 알립니다.
      }
    }
    return finding(file, "uninspected", { reason: REASON.archive });
  }

  // --- 텍스트·CSV (확장자가 낯설어도 내용이 글자이면 검사합니다: .dat, .out 같은 파일에도 값이 들어 있을 수 있습니다) ---
  const knownText = TEXT_EXTENSIONS.has(ext) || DELIMITED_EXTENSIONS.has(ext);
  if (looksBinary(bytes)) {
    return finding(file, "uninspected", { reason: knownText ? REASON.binary : REASON.unsupported });
  }
  const text = decodeText(bytes);
  if (DELIMITED_EXTENSIONS.has(ext)) {
    const parsed = parseDelimited(text, ext === "tsv" ? { delimiter: "\t" } : {});
    const table = await analyzeTable(parsed.rows, 0, deps.detector, deps.options, parsed.truncated);
    return finish(file, text, [table], deps, parsed.truncated);
  }
  return finish(file, text, [], deps);
}

// 파일을 검사합니다. 어떤 일이 생겨도 예외를 던지지 않고, 검사하지 못했다는 결과로 돌려줍니다.
export async function inspectFile(file: File, deps: InspectDeps): Promise<FileFinding> {
  const meta = { name: file.name || "(이름 없음)", size: file.size };
  if (file.size > MAX_FILE_BYTES) return finding(meta, "too-large", { reason: REASON.tooLarge });

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return finding(meta, "failed", { reason: REASON.read });
  }

  try {
    return await inspectBytes(meta, bytes, deps);
  } catch (error) {
    if (error instanceof FileInspectError) {
      if (error.code === "too-large") return finding(meta, "too-large", { reason: "압축을 풀면 너무 커서 검사하지 않았습니다" });
      return finding(meta, "failed", { reason: REASON.failed });
    }
    return finding(meta, "failed", { reason: REASON.failed });
  }
}
