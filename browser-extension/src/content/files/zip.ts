// 최소한의 ZIP 리더입니다. DOCX·XLSX·HWPX는 모두 ZIP 안의 XML이라 이것만 있으면 읽을 수 있습니다.
//
// 새 의존성 없이 브라우저 내장 DecompressionStream("deflate-raw")으로 풉니다.
// 지원: 저장(0)·deflate(8). 지원하지 않음: ZIP64, 암호화된 항목(감지만 합니다).
//
// 압축 폭탄 방어: 한 항목과 파일 전체의 풀린 크기에 상한을 두고, 풀면서 넘으면 즉시 중단합니다.
import { FileInspectError } from "./types.ts";

export interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly offset: number;
  readonly encrypted: boolean;
}

export type Inflate = (data: Uint8Array, limit: number) => Promise<Uint8Array>;

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

const MAX_ENTRIES = 5000;

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function decodeName(bytes: Uint8Array, utf8Flag: boolean): string {
  if (utf8Flag) return new TextDecoder("utf-8").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // 옛 도구가 CP949/CP437로 만든 이름. 파일을 찾는 데만 쓰므로 정확하지 않아도 됩니다.
    return new TextDecoder("euc-kr").decode(bytes);
  }
}

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5);
}

export function listZipEntries(bytes: Uint8Array): ZipEntry[] {
  if (!isZip(bytes)) throw new FileInspectError("not-zip", "ZIP 형식이 아닙니다.");
  const dv = view(bytes);

  // 끝에서부터 EOCD(디렉터리 끝 기록)를 찾습니다. 주석이 있을 수 있어 최대 64KB를 거슬러 올라갑니다.
  let eocd = -1;
  const lowest = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= lowest; i -= 1) {
    if (dv.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new FileInspectError("corrupt", "ZIP 끝 기록을 찾지 못했습니다.");

  const count = dv.getUint16(eocd + 10, true);
  const dirOffset = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || dirOffset === 0xffffffff) {
    throw new FileInspectError("unsupported", "ZIP64는 지원하지 않습니다.");
  }
  if (count > MAX_ENTRIES) throw new FileInspectError("too-large", "항목이 너무 많습니다.");

  const entries: ZipEntry[] = [];
  let cursor = dirOffset;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > bytes.length || dv.getUint32(cursor, true) !== SIG_CENTRAL) {
      throw new FileInspectError("corrupt", "ZIP 디렉터리가 손상됐습니다.");
    }
    const flags = dv.getUint16(cursor + 8, true);
    const method = dv.getUint16(cursor + 10, true);
    const compressedSize = dv.getUint32(cursor + 20, true);
    const size = dv.getUint32(cursor + 24, true);
    const nameLength = dv.getUint16(cursor + 28, true);
    const extraLength = dv.getUint16(cursor + 30, true);
    const commentLength = dv.getUint16(cursor + 32, true);
    const offset = dv.getUint32(cursor + 42, true);
    if (cursor + 46 + nameLength > bytes.length) {
      throw new FileInspectError("corrupt", "ZIP 항목 이름이 손상됐습니다.");
    }
    const name = decodeName(bytes.subarray(cursor + 46, cursor + 46 + nameLength), (flags & 0x800) !== 0);
    // 비트 0: 암호화. (비트 6, 강한 암호화도 같은 의미로 봅니다.)
    entries.push({ name, method, compressedSize, size, offset, encrypted: (flags & 0x1) !== 0 || (flags & 0x40) !== 0 });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

// 브라우저(Chrome 103+)와 Node 18+에 있는 내장 압축 해제기로 raw deflate를 풉니다.
export const inflateRaw: Inflate = async (data, limit) => {
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(data as unknown as BufferSource);
      controller.close();
    },
  });
  const reader = source.pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new FileInspectError("too-large", "압축을 풀면 너무 커집니다.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let position = 0;
  for (const chunk of chunks) {
    out.set(chunk, position);
    position += chunk.length;
  }
  return out;
};

// 한 항목의 풀린 내용을 돌려줍니다. limit보다 커지면 FileInspectError("too-large")입니다.
export async function readEntry(
  bytes: Uint8Array,
  entry: ZipEntry,
  limit: number,
  inflate: Inflate = inflateRaw,
): Promise<Uint8Array> {
  if (entry.encrypted) throw new FileInspectError("unsupported", "암호화된 항목입니다.");
  if (entry.size > limit) throw new FileInspectError("too-large", "항목이 너무 큽니다.");
  const dv = view(bytes);
  if (entry.offset + 30 > bytes.length || dv.getUint32(entry.offset, true) !== SIG_LOCAL) {
    throw new FileInspectError("corrupt", "ZIP 항목 머리가 손상됐습니다.");
  }
  const start = entry.offset + 30 + dv.getUint16(entry.offset + 26, true) + dv.getUint16(entry.offset + 28, true);
  const end = start + entry.compressedSize;
  if (end > bytes.length) throw new FileInspectError("corrupt", "ZIP 항목 데이터가 잘렸습니다.");
  const raw = bytes.subarray(start, end);

  if (entry.method === 0) {
    if (raw.length > limit) throw new FileInspectError("too-large", "항목이 너무 큽니다.");
    return raw;
  }
  if (entry.method === 8) {
    try {
      return await inflate(raw, limit);
    } catch (error) {
      if (error instanceof FileInspectError) throw error;
      throw new FileInspectError("corrupt", "압축을 풀지 못했습니다.");
    }
  }
  throw new FileInspectError("unsupported", "지원하지 않는 압축 방식입니다.");
}
