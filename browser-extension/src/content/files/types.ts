import type { ActionName, CategoryId } from "../../shared/categories.ts";

// 파일 검사 결과. 파일의 내용·일치한 값은 담지 않습니다. 범주 ID, 건수, 열 위치만 있습니다.
export type FileStatus =
  | "clean" // 검사했고 감지된 것이 없음 (안전하다는 뜻은 아님)
  | "detected" // 검사했고 개인정보·비밀 형식이 감지됨
  | "uninspected" // 지원하지 않는 형식이라 내용을 검사하지 못함(PDF·이미지·구형 형식·압축 파일 등)
  | "encrypted" // 암호가 걸려 있어 내용을 검사하지 못함
  | "too-large" // 너무 커서 검사하지 않음
  | "failed"; // 읽거나 해석하는 중 문제가 생겨 검사하지 못함

// 표(CSV·XLSX)에서 한 범주가 대부분의 값을 차지하는 열. 열 머리글의 글자는 저장하지 않습니다.
export interface FlaggedColumn {
  readonly sheet: number; // 0부터. CSV는 항상 0
  readonly column: number; // 0부터 (A=0)
  readonly category: CategoryId;
  readonly ratio: number; // 비어 있지 않은 값 중 이 범주가 감지된 비율 (0~1)
}

export interface FileFinding {
  readonly name: string;
  readonly size: number;
  readonly status: FileStatus;
  // 검사하지 못한 이유(사람이 읽는 짧은 문장). uninspected·failed·encrypted에서만 있습니다.
  readonly reason?: string;
  readonly categories: readonly CategoryId[];
  readonly columns?: readonly FlaggedColumn[];
  // 표에서 감지된 값이 있는 행의 수(대량 반출 판단용). 표가 아니면 없습니다.
  readonly recordCount?: number;
  // 일부만 검사했는지(행·글자 수 한도)
  readonly truncated?: boolean;
  // 이 파일에 대한 로컬 판정. 정책 엔진의 판정에, 파일은 값을 가릴 수 없다는 점과 대량 규칙을 더한 것입니다.
  readonly action: ActionName;
}

// 첨부된 것으로 기억하는 파일. 전송 차단 판정에 씁니다.
export interface AttachedFile {
  readonly finding: FileFinding;
  readonly at: number;
}

export class FileInspectError extends Error {
  constructor(
    readonly code: "not-zip" | "corrupt" | "too-large" | "unsupported",
    message: string,
  ) {
    super(message);
    this.name = "FileInspectError";
  }
}
