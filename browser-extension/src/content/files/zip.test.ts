import { describe, expect, it } from "vitest";
import { buildZip } from "../../test/fileFixtures.ts";
import { inflateRaw, isZip, listZipEntries, readEntry } from "./zip.ts";
import { FileInspectError } from "./types.ts";

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("ZIP 읽기", () => {
  it("항목 목록과 이름을 읽는다 (한글 이름 포함)", () => {
    const zip = buildZip([
      { name: "a.txt", data: "hello" },
      { name: "폴더/한글.xml", data: "<x/>" },
    ]);
    expect(isZip(zip)).toBe(true);
    expect(listZipEntries(zip).map((entry) => entry.name)).toEqual(["a.txt", "폴더/한글.xml"]);
  });

  it("압축된(deflate) 항목과 저장된(store) 항목을 모두 푼다", async () => {
    const body = "가나다 abc 123 ".repeat(200);
    const zip = buildZip([
      { name: "deflated.txt", data: body },
      { name: "stored.txt", data: body, store: true },
    ]);
    const [deflated, stored] = listZipEntries(zip);
    expect(deflated!.method).toBe(8);
    expect(stored!.method).toBe(0);
    expect(text(await readEntry(zip, deflated!, 1_000_000))).toBe(body);
    expect(text(await readEntry(zip, stored!, 1_000_000))).toBe(body);
  });

  it("끝에 주석이 있는 ZIP도 읽는다", () => {
    const zip = buildZip([{ name: "a.txt", data: "x" }], "이것은 ZIP 주석입니다 ".repeat(20));
    expect(listZipEntries(zip)).toHaveLength(1);
  });

  it("암호화 표시가 있는 항목을 알아보고 풀지 않는다", async () => {
    const zip = buildZip([{ name: "secret.txt", data: "x", encrypted: true }]);
    const [entry] = listZipEntries(zip);
    expect(entry!.encrypted).toBe(true);
    await expect(readEntry(zip, entry!, 1000)).rejects.toMatchObject({ code: "unsupported" });
  });

  it("ZIP이 아니면 not-zip 오류다", () => {
    expect(isZip(new TextEncoder().encode("plain text"))).toBe(false);
    expect(() => listZipEntries(new TextEncoder().encode("plain text"))).toThrow(FileInspectError);
  });

  it("끝 기록이 없거나 디렉터리가 손상된 ZIP은 corrupt 오류다", () => {
    const zip = buildZip([{ name: "a.txt", data: "hello" }]);
    const truncated = zip.subarray(0, zip.length - 10);
    expect(() => listZipEntries(truncated)).toThrowError(expect.objectContaining({ code: "corrupt" }));
  });

  it("압축 폭탄을 막는다: 풀린 크기가 상한을 넘으면 중단한다", async () => {
    const bomb = "A".repeat(5_000_000); // 5MB가 몇 KB로 압축된다
    const zip = buildZip([{ name: "bomb.txt", data: bomb }]);
    const [entry] = listZipEntries(zip);
    expect(entry!.compressedSize).toBeLessThan(20_000);
    // 목록의 크기를 믿고 거부하는 경우
    await expect(readEntry(zip, entry!, 1_000_000)).rejects.toMatchObject({ code: "too-large" });
    // 목록의 크기를 속인 경우: 풀면서 상한을 넘으면 멈춘다
    const lying = { ...entry!, size: 10 };
    await expect(readEntry(zip, lying, 1_000_000)).rejects.toMatchObject({ code: "too-large" });
  });

  it("손상된 압축 데이터는 corrupt 오류다", async () => {
    const zip = buildZip([{ name: "a.txt", data: "hello ".repeat(100) }]);
    const [entry] = listZipEntries(zip);
    const broken = Uint8Array.from(zip);
    for (let index = entry!.offset + 40; index < entry!.offset + 60; index += 1) broken[index] = 0xff;
    await expect(readEntry(broken, entry!, 1_000_000)).rejects.toMatchObject({ code: "corrupt" });
  });

  it("inflateRaw는 limit 이하면 그대로 돌려준다", async () => {
    const zip = buildZip([{ name: "a.txt", data: "abc".repeat(1000) }]);
    const [entry] = listZipEntries(zip);
    const start = entry!.offset + 30 + "a.txt".length;
    const raw = zip.subarray(start, start + entry!.compressedSize);
    expect((await inflateRaw(raw, 10_000)).length).toBe(3000);
  });
});
