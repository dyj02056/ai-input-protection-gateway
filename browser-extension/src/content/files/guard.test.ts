// 첨부파일 감지(선택·드롭·붙여넣기) → 검사 → 안내, 그리고 첨부파일 전송 차단을 jsdom에서 확인합니다.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildZip, makeDocx, makeFile, makeXlsx } from "../../test/fileFixtures.ts";
import { installChromeStub, type ChromeStub } from "../../test/chromeStub.ts";
import {
  installEngines,
  noticeHost,
  noticePart,
  noticeTitle,
  openShadowRoots,
  removeEngines,
  resetContentState,
} from "../../test/contentEnv.ts";
import type { Features } from "../../shared/settings.ts";
import { handleEditorEvent } from "../flow.ts";
import { installSendGuard } from "../sendGuard.ts";
import { state } from "../state.ts";
import { describeFinding, installFileGuard, resetFileGuard, shortName } from "./guard.ts";
import type { FileFinding } from "./types.ts";

const RESULT_TITLE = "첨부파일 검사 결과 — 전송 전 확인";
const DONE_TITLE = "첨부파일 검사 완료";
const BLOCK_TITLE = "전송을 막았습니다 — 첨부파일 확인 필요";
const PHONE = "010-1234-5678";

let restoreShadow: () => void;
let stub: ChromeStub;

beforeAll(() => {
  restoreShadow = openShadowRoots();
  document.addEventListener("input", handleEditorEvent, true);
  installSendGuard();
  installFileGuard();
});
afterAll(() => {
  restoreShadow();
  document.removeEventListener("input", handleEditorEvent, true);
});

function setup(features: Partial<Features> = {}): void {
  stub = installChromeStub();
  installEngines();
  resetContentState(features);
  resetFileGuard();
}

beforeEach(() => setup());
afterEach(() => {
  vi.useRealTimers();
  removeEngines();
});

const description = () => noticePart(".message span")?.textContent ?? "";

// 선택된 파일이 바뀐 것처럼 change 이벤트를 보냅니다.
function attach(...files: File[]): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "file";
  Object.defineProperty(input, "files", { value: files, configurable: true });
  document.body.append(input);
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return input;
}

const settled = () =>
  vi.waitFor(
    () => {
      const title = noticeTitle();
      expect(title).not.toBeNull();
      expect(title).not.toBe("첨부파일 검사 중…");
    },
    { timeout: 4000 },
  );

const csv = (rows: string[]) => makeFile(rows.join("\n"), "customers.csv");
const phoneCsv = () => csv(["이름,연락처", `김,${PHONE}`, "이,010-2222-3333", "박,010-4444-5555"]);

describe("파일 감지와 안내", () => {
  it("선택한 파일에서 개인정보가 감지되면 경고 안내를 띄운다 (열·행 수 포함)", async () => {
    attach(phoneCsv());
    expect(noticeTitle()).toBe("첨부파일 검사 중…");
    await settled();
    expect(noticeTitle()).toBe(RESULT_TITLE);
    expect(description()).toContain("customers.csv");
    expect(description()).toContain("전화번호 형식 감지");
    expect(description()).toContain("B열");
    expect(description()).toContain("감지된 행 3건");
    expect(noticePart<HTMLButtonElement>(".mask-button")!.hidden).toBe(true);
  });

  it("깨끗한 파일은 완료 안내(안전하다는 뜻은 아님)를 띄운다", async () => {
    attach(makeFile("내일 회의는 3시입니다", "note.txt"));
    await settled();
    expect(noticeTitle()).toBe(DONE_TITLE);
    expect(description()).toContain("안전하다는 뜻은 아닙니다");
    expect(description()).toContain("전송되지 않았습니다");
  });

  it("드롭한 파일도 검사한다 (사이트의 드롭 동작은 막지 않는다)", async () => {
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { files: [makeFile(`a@b.co`, "mail.txt")] } });
    document.body.dispatchEvent(drop);
    await settled();
    expect(noticeTitle()).toBe(RESULT_TITLE);
    expect(drop.defaultPrevented).toBe(false);
  });

  it("붙여넣은 파일(스크린샷 등)도 검사하고, 검사하지 못하면 그렇게 알린다", async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const paste = new Event("paste", { bubbles: true });
    Object.defineProperty(paste, "clipboardData", { value: { files: [makeFile(png, "screenshot.png")] } });
    document.body.dispatchEvent(paste);
    await settled();
    expect(noticeTitle()).toBe(RESULT_TITLE);
    expect(description()).toContain("OCR");
  });

  it("파일이 없는 붙여넣기(글자)는 파일 검사를 하지 않는다", async () => {
    const paste = new Event("paste", { bubbles: true });
    Object.defineProperty(paste, "clipboardData", { value: { files: [] } });
    document.body.dispatchEvent(paste);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(noticeHost()).toBeNull();
  });

  it("같은 파일이 드롭과 change로 연달아 들어와도 한 번만 검사한다", async () => {
    const file = phoneCsv();
    attach(file);
    attach(file);
    await settled();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(state.attachedFiles).toHaveLength(1);
  });

  it("여러 파일은 앞의 3개만 이름으로 적고 나머지는 개수로 알린다", async () => {
    attach(...["a", "b", "c", "d"].map((name) => makeFile(`${PHONE}`, `${name}.txt`)));
    await settled();
    expect(description()).toContain("a.txt");
    expect(description()).toContain("c.txt");
    expect(description()).not.toContain("d.txt");
    expect(description()).toContain("외 1개");
  });

  it("DOCX·XLSX도 검사한다", async () => {
    attach(makeFile(makeDocx(["카드 4111 1111 1111 1111"]), "contract.docx"));
    await settled();
    expect(description()).toContain("카드번호 형식 감지");
    const xlsx = makeXlsx([{ rows: [["메일"], ["a@b.co"], ["c@d.co"]] }]);
    attach(makeFile(xlsx, "list.xlsx"));
    await vi.waitFor(() => expect(description()).toContain("list.xlsx"), { timeout: 4000 });
    expect(description()).toContain("이메일 형식 감지");
  });

  it("검사하지 못한 파일(암호화·압축·구형)은 조용히 넘어가지 않고 알린다", async () => {
    attach(makeFile(buildZip([{ name: "a.txt", data: "x", encrypted: true }]), "locked.zip"));
    await settled();
    expect(noticeTitle()).toBe(RESULT_TITLE);
    expect(description()).toContain("locked.zip");
    expect(description()).toContain("암호가 걸린");
  });

  it("검사 설정을 끄면 아무것도 하지 않는다", async () => {
    setup({ inspectFiles: false });
    attach(phoneCsv());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(noticeHost()).toBeNull();
    expect(state.attachedFiles).toHaveLength(0);
  });

  it("검사기를 읽지 못했으면 그 사실을 알린다 (보호된 것으로 오해하지 않도록)", async () => {
    removeEngines();
    attach(phoneCsv());
    await settled();
    expect(noticeTitle()).toBe("로컬 검사기를 사용할 수 없습니다");
  });

  it("파일을 읽다가 오류가 나도 예외 없이 알린다", async () => {
    const file = makeFile("x", "bad.txt");
    file.arrayBuffer = async () => {
      throw new Error("boom");
    };
    attach(file);
    await settled();
    expect(noticeTitle()).toBe(RESULT_TITLE);
    expect(description()).toContain("읽지 못했습니다");
  });

  it("입력창이 깨끗해져도 파일 안내는 닫지 않는다", async () => {
    attach(phoneCsv());
    await settled();
    const editor = document.createElement("textarea");
    document.body.append(editor);
    editor.value = "깨끗한 글";
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
    expect(noticeTitle()).toBe(RESULT_TITLE);
  });

  it("× 로 닫을 수 있다", async () => {
    attach(phoneCsv());
    await settled();
    noticePart<HTMLButtonElement>(".close-button")!.click();
    expect(noticeHost()).toBeNull();
  });
});

describe("개인정보: 파일의 값은 어디에도 남지 않는다", () => {
  it("안내·상태·배지·저장소에 파일 안의 값이나 머리글이 없다", async () => {
    setup({ auditLog: true });
    attach(csv(["고객비밀연락처,이름", `${PHONE},홍길동`, "010-2222-3333,김철수"]));
    await settled();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const dump = JSON.stringify([
      description(),
      state.attachedFiles,
      stub.store,
      stub.sendMessage.mock.calls,
    ]);
    for (const secret of [PHONE, "010-2222-3333", "홍길동", "김철수", "고객비밀연락처"]) {
      expect(dump, secret).not.toContain(secret);
    }
  });

  it("감사 기록(켠 경우)에는 범주 ID만 남기고 파일 이름은 남기지 않는다", async () => {
    setup({ auditLog: true });
    attach(phoneCsv());
    await settled();
    await vi.waitFor(() => expect(stub.store.history).toBeDefined());
    const history = stub.store.history as Array<Record<string, unknown>>;
    expect(history[0]!.categories).toEqual(["phone_number"]);
    expect(JSON.stringify(history)).not.toContain("customers");
  });

  it("배지에는 가장 엄한 판정 이름만 보낸다", async () => {
    attach(phoneCsv(), makeFile("API_KEY=sk-TESTTESTTESTTESTTEST", "keys.env"));
    await settled();
    await vi.waitFor(() => expect(stub.sendMessage).toHaveBeenCalled());
    expect(stub.sendMessage.mock.lastCall![0]).toEqual({ type: "gateway:action", action: "BLOCK" });
  });
});

describe("안내 문구 도우미", () => {
  const base: FileFinding = { name: "a.csv", size: 1, status: "detected", categories: ["email"], action: "REQUIRE_APPROVAL" };

  it("긴 이름은 줄이되 확장자는 남긴다", () => {
    expect(shortName("짧은.txt")).toBe("짧은.txt");
    const long = `${"가".repeat(60)}.xlsx`;
    expect(shortName(long)).toBe(`${"가".repeat(28)}….xlsx`);
  });

  it("여러 시트의 열은 시트 번호를 붙이고, 많으면 줄인다", () => {
    const text = describeFinding({
      ...base,
      columns: [
        { sheet: 0, column: 0, category: "email", ratio: 1 },
        { sheet: 1, column: 27, category: "email", ratio: 1 },
      ],
      recordCount: 250,
      truncated: true,
    });
    expect(text).toContain("1번 시트 A열");
    expect(text).toContain("2번 시트 AB열");
    expect(text).toContain("감지된 행 250건(대량)");
    expect(text).toContain("일부만 검사");
  });
});

describe("첨부파일 전송 차단", () => {
  const BLOCKING: Partial<Features> = { enforcePolicy: true, blockFileSend: true };

  function page() {
    document.body.innerHTML =
      '<form id="f"><textarea id="t"></textarea><button id="s" type="submit">보내기</button></form>';
    const form = document.getElementById("f") as HTMLFormElement;
    const area = document.getElementById("t") as HTMLTextAreaElement;
    const send = document.getElementById("s") as HTMLButtonElement;
    let submitted = 0;
    form.addEventListener("submit", (event) => {
      submitted += 1;
      event.preventDefault();
    });
    return { area, send, submitted: () => submitted };
  }

  const enter = (target: Element): KeyboardEvent => {
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };

  async function attachRisky(): Promise<void> {
    attach(phoneCsv());
    await settled();
  }

  beforeEach(() => {
    setup(BLOCKING);
  });

  it("위험한 첨부파일이 있으면 첫 Enter를 막고 안내한다", async () => {
    const { area } = page();
    await attachRisky();
    expect(enter(area).defaultPrevented).toBe(true);
    expect(noticeTitle()).toBe(BLOCK_TITLE);
    expect(description()).toContain("customers.csv");
    expect(description()).toContain("5초 안에 다시 누르면 그대로 전송됩니다");
  });

  it("5초 안에 다시 누르면 통과하고, 그 뒤에는 같은 파일 때문에 다시 막지 않는다", async () => {
    const { area } = page();
    await attachRisky();
    expect(enter(area).defaultPrevented).toBe(true);
    expect(enter(area).defaultPrevented).toBe(false);
    expect(state.attachedFiles).toHaveLength(0);
    expect(enter(area).defaultPrevented).toBe(false);
  });

  it("보내기 버튼: 첫 클릭은 막고, 두 번째 클릭은 제출까지 통과한다", async () => {
    const { send, submitted } = page();
    await attachRisky();
    send.click();
    expect(submitted()).toBe(0);
    expect(noticeTitle()).toBe(BLOCK_TITLE);
    send.click();
    expect(submitted()).toBe(1);
  });

  it("스위치를 끄면 막지 않는다 (기본값)", async () => {
    setup({ enforcePolicy: true, blockFileSend: false });
    const { area } = page();
    await attachRisky();
    expect(enter(area).defaultPrevented).toBe(false);
  });

  it("로컬 정책 적용이 꺼져 있으면 첨부파일 전송 차단만 켜도 동작하지 않는다", async () => {
    setup({ enforcePolicy: false, blockFileSend: true });
    const { area } = page();
    await attachRisky();
    expect(enter(area).defaultPrevented).toBe(false);
  });

  it("깨끗한 첨부파일만 있으면 막지 않는다", async () => {
    const { area } = page();
    attach(makeFile("회의록입니다", "ok.txt"));
    await settled();
    expect(enter(area).defaultPrevented).toBe(false);
  });

  it("검사하지 못한 첨부파일(PDF 등)도 첫 시도를 막는다 (조용히 통과시키지 않는다)", async () => {
    const { area } = page();
    attach(makeFile("%PDF-1.7\n%%EOF", "doc.pdf"));
    await settled();
    expect(enter(area).defaultPrevented).toBe(true);
  });

  it("오래된 첨부 기록(15분 초과)은 믿지 않는다 — 사이트에서 파일을 뺐을 수 있다", async () => {
    const { area } = page();
    await attachRisky();
    const later = Date.now() + 16 * 60 * 1000;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(later);
    expect(enter(area).defaultPrevented).toBe(false);
  });

  it("입력창 밖에서 누른 Enter는 막지 않는다", async () => {
    page();
    await attachRisky();
    expect(enter(document.body).defaultPrevented).toBe(false);
  });

  it("글자 쪽 차단 사유가 있으면 그 안내가 먼저다", async () => {
    setup({ ...BLOCKING, blockSend: true }); // 글자 쪽 차단(blockSend)도 켠다
    const { area } = page();
    await attachRisky();
    area.value = "키 sk-TESTTESTTESTTESTTEST";
    area.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
    expect(enter(area).defaultPrevented).toBe(true);
    expect(noticeTitle()).toBe("전송을 막았습니다 — 형식 패턴 감지");
  });
});
