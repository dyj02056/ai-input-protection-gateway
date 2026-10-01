// 설정(엄격 검증·허용 목록·새 범주)이 입력 → 안내 흐름에 실제로 반영되는지 확인합니다.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeStub, type ChromeStub } from "../test/chromeStub.ts";
import {
  installEngines,
  noticeHost,
  noticePart,
  noticeTitle,
  openShadowRoots,
  removeEngines,
  resetContentState,
} from "../test/contentEnv.ts";
import { handleEditorEvent } from "./flow.ts";
import { applySettings, state } from "./state.ts";

const ALERT_TITLE = "형식 패턴 감지 — 전송 전 확인";
let restoreShadow: () => void;
let stub: ChromeStub;

beforeAll(() => {
  restoreShadow = openShadowRoots();
  document.addEventListener("input", handleEditorEvent, true);
});
afterAll(() => {
  restoreShadow();
  document.removeEventListener("input", handleEditorEvent, true);
});
beforeEach(() => {
  stub = installChromeStub();
  installEngines();
  resetContentState();
});
afterEach(() => {
  vi.useRealTimers();
  removeEngines();
});

function typeInto(html: string): HTMLElement {
  const editor = document.createElement("div");
  editor.setAttribute("contenteditable", "true");
  editor.innerHTML = html;
  document.body.append(editor);
  editor.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
  return editor;
}

const description = () => noticePart(".message span")?.textContent ?? "";

describe("새 범주", () => {
  it("카드번호는 BLOCK 판정으로 안내하고 마스킹 버튼을 보여준다", () => {
    typeInto("<p>결제 4111 1111 1111 1111</p>");
    expect(noticeTitle()).toBe(ALERT_TITLE);
    expect(description()).toContain("카드번호 형식");
    expect(description()).toContain("BLOCK");
    expect(noticePart<HTMLButtonElement>(".mask-button")!.hidden).toBe(false);
    expect(stub.sendMessage.mock.lastCall![0]).toEqual({ type: "gateway:action", action: "BLOCK" });
  });

  it("카드번호를 마스킹하면 그 구간만 [카드번호]로 바뀐다", () => {
    const editor = typeInto("<p>결제 4111 1111 1111 1111 완료</p>");
    noticePart<HTMLButtonElement>(".mask-button")!.click();
    expect(editor.querySelector("p")!.textContent).toBe("결제 [카드번호] 완료");
  });

  it("계좌번호·여권번호는 MASK 판정이다", () => {
    typeInto("<p>계좌번호 110-123-456789 여권번호 M12345678</p>");
    expect(description()).toContain("계좌번호 형식");
    expect(description()).toContain("여권번호 형식");
    expect(stub.sendMessage.mock.lastCall![0]).toEqual({ type: "gateway:action", action: "MASK" });
  });

  it("비밀번호는 값만 가리고 '비밀번호:'는 남긴다", () => {
    const editor = typeInto("<p>비밀번호: abc12345</p>");
    noticePart<HTMLButtonElement>(".mask-button")!.click();
    expect(editor.querySelector("p")!.textContent).toBe("비밀번호: [비밀번호]");
  });

  it("끈 범주는 감지하지 않는다", () => {
    applySettings({ enabled: { credit_card: false } });
    typeInto("<p>결제 4111 1111 1111 1111</p>");
    expect(noticeTitle()).toBe("간단한 형식 검사 완료");
  });
});

describe("엄격 검증", () => {
  it("꺼져 있으면 체험용 가짜 주민번호도 감지한다", () => {
    typeInto("<p>가짜 주민번호 000000-1000000</p>");
    expect(noticeTitle()).toBe(ALERT_TITLE);
  });

  it("켜면 달력에 없는 생년월일은 감지하지 않고, 실제 날짜는 감지한다", () => {
    applySettings({ features: { strictValidation: true } });
    typeInto("<p>가짜 주민번호 000000-1000000</p>");
    expect(noticeTitle()).toBe("간단한 형식 검사 완료");
    typeInto("<p>주민번호 900101-1234567</p>");
    expect(noticeTitle()).toBe(ALERT_TITLE);
  });
});

describe("허용 목록", () => {
  it("적어 둔 값은 감지하지 않고, 다른 값은 그대로 감지한다", () => {
    applySettings({ allowlist: ["02-123-4567"] });
    typeInto("<p>대표 02-123-4567</p>");
    expect(noticeTitle()).toBe("간단한 형식 검사 완료");
    typeInto("<p>대표 02-123-4567 / 직통 010-1234-5678</p>");
    expect(noticeTitle()).toBe(ALERT_TITLE);
  });

  it("설정을 바꾸면 다음 입력부터 바로 반영된다", () => {
    typeInto("<p>대표 02-123-4567</p>");
    expect(noticeTitle()).toBe(ALERT_TITLE);
    applySettings({ allowlist: ["021234567"] });
    typeInto("<p>대표 02-123-4567 확인</p>");
    expect(noticeTitle()).not.toBe(ALERT_TITLE);
    expect(state.allowlist).toEqual(["021234567"]);
  });
});

describe("우회 입력", () => {
  it("보이지 않는 문자·한글 숫자로 쓴 값도 감지한다", () => {
    typeInto("<p>연락처 010​-1234-5678</p>");
    expect(noticeTitle()).toBe(ALERT_TITLE);
    typeInto("<p>연락처 공일공-일이삼사-오육칠팔</p>");
    expect(noticeTitle()).toBe(ALERT_TITLE);
  });

  it("그런 값은 입력란을 바꾸지 않고 직접 수정하라고 알린다 (위치를 특정할 수 없다)", () => {
    const html = "<p>연락처 공일공-일이삼사-오육칠팔</p>";
    const editor = typeInto(html);
    noticePart<HTMLButtonElement>(".mask-button")!.click();
    expect(editor.innerHTML).toBe(html);
    expect(noticeTitle()).toBe("입력란을 바꾸지 않았습니다");
    expect(description()).toContain("한글로 쓴 숫자");
    expect(noticeHost()).not.toBeNull();
  });

  it("textarea에서도 같다: 값은 그대로 두고 알린다", () => {
    const area = document.createElement("textarea");
    document.body.append(area);
    area.value = "010%2D1234%2D5678";
    area.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
    expect(noticeTitle()).toBe(ALERT_TITLE);
    noticePart<HTMLButtonElement>(".mask-button")!.click();
    expect(area.value).toBe("010%2D1234%2D5678");
    expect(noticeTitle()).toBe("입력란을 바꾸지 않았습니다");
  });
});
