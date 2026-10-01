import { beforeEach, describe, expect, it, vi } from "vitest";
import { initDemo, SAMPLE } from "./demo.ts";

const text = (id: string) => document.getElementById(id)!.textContent;
const click = (id: string) => document.getElementById(id)!.click();
const input = () => document.getElementById("input") as HTMLTextAreaElement;
const badges = () => [...document.querySelectorAll("#cats .badge")].map((b) => b.textContent);

beforeEach(() => {
  document.body.innerHTML = `
    <textarea id="input">${SAMPLE}</textarea>
    <button id="check"></button><button id="mask"></button><button id="copy"></button><button id="reset"></button>
    <div id="cats"></div><pre id="catJson">[]</pre><pre id="masked">(마스킹 버튼을 눌러주세요)</pre>
    <span id="pdp">PDP: -</span>`;
  initDemo();
});

describe("공개 데모", () => {
  it("처음 열면 예시를 바로 검사한다 (4종, BLOCK)", () => {
    expect(badges()).toEqual([
      "government_id · 주민등록번호 형식",
      "phone_number · 전화번호 형식",
      "api_key · API 키/토큰 형식",
      "email · 이메일 형식",
    ]);
    expect(text("catJson")).toBe('["government_id","phone_number","api_key","email"]');
    expect(text("pdp")).toBe("PDP: BLOCK");
  });

  it("마스킹 버튼은 값만 가리고 줄바꿈과 나머지 문장은 유지한다", () => {
    click("mask");
    expect(text("masked")).toBe(
      "가짜 주민번호 [주민등록번호]\n가짜 전화번호 [전화번호]\n가짜 이메일 [이메일]\n가짜 키 [API 키/토큰]\n그대로 남아야 할 문장",
    );
  });

  it("감지가 없으면 안전하다는 뜻이 아니라고 알리고 ALLOW로 판정한다", () => {
    input().value = "평범한 문장";
    click("check");
    expect(text("cats")).toBe("감지 없음 (안전 판정 아님)");
    expect(text("catJson")).toBe("[]");
    expect(text("pdp")).toBe("PDP: ALLOW");
  });

  it("전화번호·이메일만 있으면 MASK, 키가 섞이면 BLOCK이다", () => {
    input().value = "메일 a@b.co";
    click("check");
    expect(text("pdp")).toBe("PDP: MASK");
    input().value = "키 sk-TESTTESTTESTTESTTEST 메일 a@b.co";
    click("check");
    expect(text("pdp")).toBe("PDP: BLOCK");
  });

  it("검사하기는 이전 마스킹 미리보기를 지운다", () => {
    click("mask");
    click("check");
    expect(text("masked")).toBe("(마스킹 버튼을 눌러주세요)");
  });

  it("예시로 되돌리기는 입력과 결과를 처음 상태로 만든다", () => {
    input().value = "";
    click("mask");
    click("reset");
    expect(input().value).toBe(SAMPLE);
    expect(badges()).toHaveLength(4);
    expect(text("masked")).toBe("(마스킹 버튼을 눌러주세요)");
  });

  it("복사 버튼은 마스킹 결과를 클립보드에 쓴다", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    click("mask");
    click("copy");
    expect(writeText).toHaveBeenCalledWith(text("masked"));
  });

  it("클립보드를 쓸 수 없는 환경에서도 오류가 나지 않는다", () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    click("mask");
    expect(() => click("copy")).not.toThrow();
  });

  it("필요한 요소가 없으면 숨기지 않고 오류로 알린다", () => {
    document.body.innerHTML = "";
    expect(() => initDemo()).toThrow("#input");
  });
});
