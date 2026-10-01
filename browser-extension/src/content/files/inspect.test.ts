import { describe, expect, it } from "vitest";
import { detector } from "../../engine/detector.ts";
import {
  buildZip,
  encodeEucKr,
  makeDocx,
  makeFile,
  makeHwpx,
  makeXlsx,
  OLE_HEADER,
} from "../../test/fileFixtures.ts";
import {
  BULK_RECORD_THRESHOLD,
  decideFileAction,
  inspectFile,
  MAX_FILE_BYTES,
  type InspectDeps,
} from "./inspect.ts";
import type { FileFinding } from "./types.ts";

const deps: InspectDeps = { detector, options: {} };
const inspect = (file: File, extra: Partial<InspectDeps> = {}) => inspectFile(file, { ...deps, ...extra });

const PHONE = "010-1234-5678";
const KEY = "sk-TESTTESTTESTTESTTEST";

describe("텍스트 파일", () => {
  it("개인정보가 있으면 detected이고, 값을 가릴 수 없으므로 최소 REQUIRE_APPROVAL이다", async () => {
    const result = await inspect(makeFile(`연락처는 ${PHONE} 입니다`, "memo.txt"));
    expect(result.status).toBe("detected");
    expect(result.categories).toEqual(["phone_number"]);
    expect(result.action).toBe("REQUIRE_APPROVAL");
  });

  it("API 키는 BLOCK이다", async () => {
    const result = await inspect(makeFile(`API_KEY=${KEY}`, ".env"));
    expect(result.categories).toEqual(["api_key"]);
    expect(result.action).toBe("BLOCK");
  });

  it("감지된 것이 없으면 clean이고 ALLOW이다", async () => {
    const result = await inspect(makeFile("내일 회의는 3시입니다.", "note.txt"));
    expect(result).toMatchObject({ status: "clean", action: "ALLOW", categories: [] });
  });

  it("확장자가 낯설어도 내용이 글자이면 검사한다 (.dat, 확장자 없음)", async () => {
    expect((await inspect(makeFile(`a@b.co`, "export.dat"))).categories).toEqual(["email"]);
    expect((await inspect(makeFile(`a@b.co`, "README"))).categories).toEqual(["email"]);
  });

  it("바이너리(NUL 포함)는 확장자가 .txt여도 검사하지 못한다고 알린다", async () => {
    const bytes = Uint8Array.from([0x41, 0x00, 0x42, 0x00, 0x43, 0x00, 0x01, 0x02]);
    const result = await inspect(makeFile(bytes, "weird.txt"));
    expect(result.status).toBe("uninspected");
    expect(result.reason).toContain("텍스트가 아닌");
    expect(result.action).toBe("REQUIRE_APPROVAL");
  });

  it("긴 텍스트의 조각 경계에 걸친 값도 잡는다", async () => {
    const filler = "가".repeat(399_990);
    const result = await inspect(makeFile(`${filler}${PHONE}${filler}`, "big.txt"));
    expect(result.categories).toEqual(["phone_number"]);
  });

  it("너무 긴 텍스트는 앞부분만 검사하고 truncated로 알린다", async () => {
    const result = await inspect(makeFile("가 ".repeat(2_100_000), "huge.txt"));
    expect(result.status).toBe("clean");
    expect(result.truncated).toBe(true);
  });

  it("설정에서 끈 범주와 허용 목록은 파일에도 똑같이 적용된다", async () => {
    const file = () => makeFile(`${PHONE} / a@b.co`, "x.txt");
    expect((await inspect(file(), { options: { disabledCategories: ["phone_number"] } })).categories).toEqual(["email"]);
    expect((await inspect(file(), { options: { allowlist: [PHONE] } })).categories).toEqual(["email"]);
  });
});

describe("CSV", () => {
  const csv = (rows: string[]) => rows.join("\n");

  it("열 단위로 판정한다: 전화번호 열과 이름 열을 구분하고, 감지된 행 수를 센다", async () => {
    const result = await inspect(
      makeFile(csv(["이름,연락처,메모", `김,${PHONE},첫째`, "이,010-2222-3333,둘째", "박,010-4444-5555,셋째"]), "customers.csv"),
    );
    expect(result.status).toBe("detected");
    expect(result.categories).toEqual(["phone_number"]);
    expect(result.columns).toEqual([{ sheet: 0, column: 1, category: "phone_number", ratio: 1 }]);
    expect(result.recordCount).toBe(3);
  });

  it("머리글은 성격 판단에서 뺀다 (머리글 한 줄 때문에 비율이 낮아지지 않는다)", async () => {
    const result = await inspect(makeFile(csv(["email", "a@b.co", "c@d.co"]), "m.csv"));
    expect(result.columns![0]!.ratio).toBe(1);
    expect(result.recordCount).toBe(2);
  });

  it("따옴표 안의 쉼표·줄바꿈·이중 따옴표를 올바르게 읽는다", async () => {
    const text = `이름,연락처\n"홍, 길동","${PHONE}"\n"한줄\n바꿈","02-123-4567"\n"따옴표""포함","010-9999-0000"`;
    const result = await inspect(makeFile(text, "q.csv"));
    expect(result.recordCount).toBe(3);
    expect(result.columns![0]!.column).toBe(1);
  });

  it("TSV·세미콜론 구분 파일도 읽는다", async () => {
    const tsv = await inspect(makeFile(`이름\t연락처\n김\t${PHONE}\n이\t010-2222-3333`, "a.tsv"));
    expect(tsv.recordCount).toBe(2);
    const semicolon = await inspect(makeFile(`이름;연락처\n김;${PHONE}\n이;010-2222-3333`, "b.csv"));
    expect(semicolon.recordCount).toBe(2);
  });

  it("UTF-8 BOM이 있어도 읽는다", async () => {
    const bytes = new TextEncoder().encode(`﻿이름,연락처\n김,${PHONE}`);
    expect((await inspect(makeFile(bytes, "bom.csv"))).categories).toEqual(["phone_number"]);
  });

  it("엑셀이 CP949(EUC-KR)로 저장한 한글 CSV도 읽는다", async () => {
    const bytes = encodeEucKr(`이름,연락처\n홍길동,${PHONE}\n김철수,010-2222-3333`);
    const result = await inspect(makeFile(bytes, "euckr.csv"));
    expect(result.categories).toEqual(["phone_number"]);
    expect(result.recordCount).toBe(2);
  });

  it("대량 규칙: 감지된 행이 100건 이상이면 MASK 범주라도 BLOCK이다", async () => {
    const rows = ["연락처", ...Array.from({ length: BULK_RECORD_THRESHOLD }, (_, i) => `010-0000-${String(1000 + i)}`)];
    const result = await inspect(makeFile(csv(rows), "bulk.csv"));
    expect(result.recordCount).toBe(BULK_RECORD_THRESHOLD);
    expect(result.action).toBe("BLOCK");
  });

  it("99건이면 대량이 아니다 (REQUIRE_APPROVAL)", async () => {
    const rows = ["연락처", ...Array.from({ length: BULK_RECORD_THRESHOLD - 1 }, (_, i) => `010-0000-${String(1000 + i)}`)];
    const result = await inspect(makeFile(csv(rows), "almost.csv"));
    expect(result.recordCount).toBe(BULK_RECORD_THRESHOLD - 1);
    expect(result.action).toBe("REQUIRE_APPROVAL");
  });

  it("드문 값(많은 행 중 하나)은 열로 판정하지 않지만 감지는 한다", async () => {
    const rows = ["메모", ...Array.from({ length: 300 }, (_, i) => `일반 메모 ${i}`)];
    rows[150] = `급한 연락 ${PHONE}`;
    const result = await inspect(makeFile(csv(rows), "sparse.csv"));
    expect(result.status).toBe("detected");
    expect(result.columns).toBeUndefined();
    expect(result.recordCount).toBe(0);
  });

  it("결과에는 머리글·값이 담기지 않는다 (범주 ID와 숫자뿐)", async () => {
    const result = await inspect(makeFile(`고객비밀연락처,이름\n${PHONE},홍길동\n010-2222-3333,김철수`, "p.csv"));
    const dump = JSON.stringify(result);
    for (const secret of [PHONE, "010-2222-3333", "홍길동", "김철수", "고객비밀연락처"]) {
      expect(dump).not.toContain(secret);
    }
  });
});

describe("DOCX", () => {
  it("본문의 값을 찾는다 (글자 조각이 나뉘어 있어도)", async () => {
    const bytes = makeDocx(["안녕하세요", `카드는 4111 1111 1111 1111 입니다`]);
    const result = await inspect(makeFile(bytes, "contract.docx"));
    expect(result.categories).toEqual(["credit_card"]);
    expect(result.action).toBe("BLOCK");
  });

  it("머리글·바닥글·주석에 숨은 값도 찾는다", async () => {
    const bytes = makeDocx(["본문은 깨끗합니다"], {
      "word/header1.xml": [`담당 ${PHONE}`],
      "word/comments.xml": ["a@b.co"],
    });
    expect((await inspect(makeFile(bytes, "x.docx"))).categories).toEqual(["phone_number", "email"]);
  });

  it("깨끗한 문서는 clean이다", async () => {
    expect((await inspect(makeFile(makeDocx(["내용 없음"]), "x.docx"))).status).toBe("clean");
  });

  it("암호가 걸린 문서(OLE 상자에 담긴 .docx)는 encrypted다", async () => {
    const result = await inspect(makeFile(OLE_HEADER, "secret.docx"));
    expect(result.status).toBe("encrypted");
    expect(result.action).toBe("REQUIRE_APPROVAL");
  });

  it("확장자만 .docx이고 내용이 다르면 검사하지 못한다고 알린다 (확장자 위장)", async () => {
    const result = await inspect(makeFile("그냥 글자입니다", "fake.docx"));
    expect(result.status).toBe("uninspected");
    expect(result.reason).toContain("확장자와 실제 내용이 달라");
  });

  it("본문이 없는 ZIP이나 손상된 파일은 failed다", async () => {
    expect((await inspect(makeFile(buildZip([{ name: "other.xml", data: "<x/>" }]), "empty.docx"))).status).toBe("failed");
    const good = makeDocx(["내용"]);
    expect((await inspect(makeFile(good.subarray(0, good.length - 25), "broken.docx"))).status).toBe("failed");
  });

  it("압축 폭탄 문서는 풀지 않고 too-large로 알린다", async () => {
    const bomb = buildZip([{ name: "word/document.xml", data: "A".repeat(40_000_000) }]);
    const result = await inspect(makeFile(bomb, "bomb.docx"));
    expect(result.status).toBe("too-large");
    expect(result.action).toBe("REQUIRE_APPROVAL");
  });
});

describe("XLSX", () => {
  it("열 단위로 판정한다 (공유 문자열)", async () => {
    const bytes = makeXlsx([
      { rows: [["이름", "이메일"], ["김", "a@b.co"], ["이", "c@d.co"], ["박", "e@f.co"]] },
    ]);
    const result = await inspect(makeFile(bytes, "customers.xlsx"));
    expect(result.categories).toEqual(["email"]);
    expect(result.columns).toEqual([{ sheet: 0, column: 1, category: "email", ratio: 1 }]);
    expect(result.recordCount).toBe(3);
  });

  it("인라인 문자열과 숫자 셀도 읽는다", async () => {
    const bytes = makeXlsx([{ inline: true, rows: [["이름", "연락처"], ["김", PHONE], ["이", 12345]] }]);
    expect((await inspect(makeFile(bytes, "inline.xlsx"))).categories).toEqual(["phone_number"]);
  });

  it("숨김 시트와 둘째 시트의 값도 찾는다 (시트 번호를 구분한다)", async () => {
    const bytes = makeXlsx(
      [
        { rows: [["메모"], ["깨끗"]] },
        { rows: [["연락처"], [PHONE], ["010-2222-3333"]] },
      ],
      { hiddenSecond: true },
    );
    const result = await inspect(makeFile(bytes, "hidden.xlsx"));
    expect(result.categories).toEqual(["phone_number"]);
    expect(result.columns![0]!.sheet).toBe(1);
  });

  it("대량 규칙이 시트 합계로 적용된다", async () => {
    const rows = [["이메일"], ...Array.from({ length: 60 }, (_, i) => [`user${i}@example.com`])];
    const bytes = makeXlsx([{ rows }, { rows }]);
    const result = await inspect(makeFile(bytes, "bulk.xlsx"));
    expect(result.recordCount).toBe(120);
    expect(result.action).toBe("BLOCK");
  });

  it("암호가 걸린 통합 문서는 encrypted다", async () => {
    expect((await inspect(makeFile(OLE_HEADER, "secret.xlsx"))).status).toBe("encrypted");
  });

  it("결과에 셀 값이 담기지 않는다", async () => {
    const bytes = makeXlsx([{ rows: [["비밀열"], ["secret.person@example.com"]] }]);
    expect(JSON.stringify(await inspect(makeFile(bytes, "p.xlsx")))).not.toContain("secret.person");
  });
});

describe("HWPX(한글)", () => {
  it("본문과 미리보기 텍스트에서 값을 찾는다", async () => {
    const body = makeHwpx(["보고서", `연락처 ${PHONE}`]);
    expect((await inspect(makeFile(body, "report.hwpx"))).categories).toEqual(["phone_number"]);
    const previewOnly = makeHwpx(["깨끗"], "미리보기 a@b.co");
    expect((await inspect(makeFile(previewOnly, "p.hwpx"))).categories).toEqual(["email"]);
  });

  it("구형 HWP(.hwp)는 내용을 검사하지 못한다고 알린다", async () => {
    const result = await inspect(makeFile(OLE_HEADER, "old.hwp"));
    expect(result.status).toBe("uninspected");
    expect(result.reason).toContain("구형 형식");
  });
});

describe("검사하지 못하는 형식은 조용히 통과시키지 않는다", () => {
  it.each(["old.doc", "old.xls", "old.ppt"])("%s: 구형 형식", async (name) => {
    const result = await inspect(makeFile(OLE_HEADER, name));
    expect(result.status).toBe("uninspected");
    expect(result.action).toBe("REQUIRE_APPROVAL");
  });

  it("PDF는 이름·크기만 확인한다고 알리고, 암호가 걸린 PDF는 encrypted다", async () => {
    const pdf = await inspect(makeFile("%PDF-1.7\n1 0 obj\n<< >>\nendobj\n%%EOF", "doc.pdf"));
    expect(pdf).toMatchObject({ status: "uninspected", action: "REQUIRE_APPROVAL" });
    expect(pdf.reason).toContain("PDF");
    const locked = await inspect(makeFile("%PDF-1.7\ntrailer\n<< /Encrypt 5 0 R >>\n%%EOF", "locked.pdf"));
    expect(locked.status).toBe("encrypted");
  });

  it("이미지는 OCR을 지원하지 않는다고 알린다 (확장자나 내용으로 알아본다)", async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect((await inspect(makeFile(png, "scan.png"))).reason).toContain("OCR");
    // 확장자가 위장돼도 내용이 이미지이면 이미지다
    expect((await inspect(makeFile(png, "report.txt"))).reason).toContain("OCR");
  });

  it("압축 파일은 내용을 검사하지 못하고, 암호가 걸린 압축 파일은 encrypted다", async () => {
    const plain = await inspect(makeFile(buildZip([{ name: "a.txt", data: PHONE }]), "bundle.zip"));
    expect(plain).toMatchObject({ status: "uninspected", action: "REQUIRE_APPROVAL" });
    expect(plain.categories).toEqual([]);
    const locked = await inspect(makeFile(buildZip([{ name: "a.txt", data: "x", encrypted: true }]), "locked.zip"));
    expect(locked.status).toBe("encrypted");
  });

  it("너무 큰 파일은 읽지 않고 too-large로 알린다", async () => {
    const file = makeFile("x", "huge.csv");
    Object.defineProperty(file, "size", { value: MAX_FILE_BYTES + 1 });
    let read = false;
    file.arrayBuffer = async () => {
      read = true;
      return new ArrayBuffer(0);
    };
    const result = await inspect(file);
    expect(result.status).toBe("too-large");
    expect(read).toBe(false);
  });

  it("읽다가 오류가 나면 예외를 던지지 않고 failed로 알린다", async () => {
    const file = makeFile("x", "a.txt");
    file.arrayBuffer = async () => {
      throw new Error("read error");
    };
    expect(await inspect(file)).toMatchObject({ status: "failed", action: "REQUIRE_APPROVAL" });
  });
});

describe("파일 판정 규칙", () => {
  const decide = (status: FileFinding["status"], categories: FileFinding["categories"] = [], recordCount = 0) =>
    decideFileAction(status, categories, recordCount);

  it("clean은 ALLOW, 검사하지 못한 모든 상태는 REQUIRE_APPROVAL", () => {
    expect(decide("clean")).toBe("ALLOW");
    for (const status of ["uninspected", "encrypted", "too-large", "failed"] as const) {
      expect(decide(status), status).toBe("REQUIRE_APPROVAL");
    }
  });

  it("감지됐으면 정책 판정을 따르되 최소 REQUIRE_APPROVAL (파일은 값을 가릴 수 없다)", () => {
    expect(decide("detected", ["email"])).toBe("REQUIRE_APPROVAL");
    expect(decide("detected", ["credit_card"])).toBe("BLOCK");
    expect(decide("detected", ["email", "api_key"])).toBe("BLOCK");
  });

  it("대량(100행 이상)이면 BLOCK", () => {
    expect(decide("detected", ["email"], 99)).toBe("REQUIRE_APPROVAL");
    expect(decide("detected", ["email"], 100)).toBe("BLOCK");
  });
});
