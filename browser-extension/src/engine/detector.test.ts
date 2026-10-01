// 같은 케이스를 TS 모듈과 빌드 산출물(dist-ext/detector.js)에 모두 돌립니다.
// 산출물은 실제 확장처럼 빈 전역에서 실행해, content.js가 쓰는 전역 AIInputGatewayDetector가 노출되는지도 확인합니다.
import { describe, expect, it } from "vitest";
import { loadArtifactGlobal } from "../test/artifact.ts";
import { detector as moduleDetector, type Detector } from "./detector.ts";

const subjects: Array<[string, () => Detector]> = [
  ["TS 모듈", () => moduleDetector],
  [
    "빌드 산출물 dist-ext/detector.js",
    () => loadArtifactGlobal<Detector>("detector.js", "AIInputGatewayDetector"),
  ],
];

describe.each(subjects)("detector (%s)", (_name, load) => {
  const detector = load();
  // vm 렐름에서 만들어진 값을 평범한 객체로 바꿉니다.
  const inspect = (text: unknown, options?: object) =>
    Array.from(detector.inspect(text, options as never));
  const findMatches = (text: unknown, options?: object) =>
    Array.from(detector.findMatches(text, options as never)).map((match) => ({ ...match }));

  it("탐지 결과가 PDP와 공유하는 범주 ID를 반환한다", () => {
    expect(inspect("테스트 주민번호형식: 000000-1000000")).toEqual(["government_id"]);
    expect(inspect("테스트 전화번호형식: 010-0000-0000")).toEqual(["phone_number"]);
    expect(inspect("테스트 키형식: sk-TESTTESTTESTTESTTEST")).toEqual(["api_key"]);
  });

  it("탐지 결과에는 원문이나 일치한 값이 들어가지 않는다", () => {
    const result = inspect("테스트 전화번호형식: 010-0000-0000");
    expect(result).toEqual(["phone_number"]);
    expect(result.includes("010-0000-0000" as never)).toBe(false);
  });

  it("일부 패턴과 일치하지 않는 문장은 빈 범주 목록을 반환한다", () => {
    expect(inspect("평범한 테스트 문장")).toEqual([]);
  });

  it("수동 마스킹은 탐지된 값을 유형별 자리표시자로 바꾼다", () => {
    expect(detector.mask("테스트 전화번호형식: 010-0000-0000")).toBe("테스트 전화번호형식: [전화번호]");
    expect(detector.mask("테스트 이메일형식: test.user@example.com")).toBe(
      "테스트 이메일형식: [이메일]",
    );
  });

  it("전각 표기 변형도 탐지 범주로 잡힌다", () => {
    expect(inspect("테스트 전각전화: ０１０-００００-００００")).toEqual(["phone_number"]);
  });

  it("마스킹 문자열은 줄바꿈과 감지되지 않은 문장을 유지한다", () => {
    const input = [
      "가짜 주민번호 000000-1000000",
      "가짜 전화번호 010-0000-0000",
      "가짜 키 sk-TESTTESTTESTTESTTEST",
      "그대로 남아야 할 문장",
    ].join("\n");
    const expected = [
      "가짜 주민번호 [주민등록번호]",
      "가짜 전화번호 [전화번호]",
      "가짜 키 [API 키/토큰]",
      "그대로 남아야 할 문장",
    ].join("\n");
    expect(detector.mask(input)).toBe(expected);
  });

  it("설정에서 끈 범주는 탐지와 마스킹에서 모두 제외된다", () => {
    const options = { disabledCategories: ["email"] };
    expect(inspect("테스트 이메일형식: test.user@example.com", options)).toEqual([]);
    expect(detector.mask("테스트 이메일형식: test.user@example.com", options)).toBe(
      "테스트 이메일형식: test.user@example.com",
    );
    // 옵션을 주지 않으면 기존과 같이 이메일이 잡힌다.
    expect(inspect("테스트 이메일형식: test.user@example.com")).toEqual(["email"]);
  });

  it("옵션이 비어 있으면 기존 4종 동작을 그대로 유지한다", () => {
    expect(inspect("테스트 키형식: sk-TESTTESTTESTTESTTEST", {})).toEqual(["api_key"]);
    expect(detector.mask("테스트 전화번호형식: 010-0000-0000", { disabledCategories: [] })).toBe(
      "테스트 전화번호형식: [전화번호]",
    );
  });

  it("findMatches는 일치 구간의 위치와 범주만 돌려준다", () => {
    const text = "전화번호: 010-0000-0000";
    expect(findMatches(text)).toEqual([
      { categoryId: "phone_number", label: "전화번호", start: 6, end: 19 },
    ]);
    expect(text.slice(6, 19)).toBe("010-0000-0000");
    // 일치한 문자열은 결과에 담기지 않는다.
    expect(JSON.stringify(findMatches(text)).includes("010-0000-0000")).toBe(false);
  });

  it("findMatches는 빈 입력과 일치하지 않는 문장에 빈 배열을 돌려준다", () => {
    expect(findMatches("")).toEqual([]);
    expect(findMatches("평범한 테스트 문장")).toEqual([]);
    expect(findMatches(undefined)).toEqual([]);
  });

  it("findMatches는 설정에서 끈 범주를 제외한다", () => {
    expect(
      findMatches("테스트 이메일형식: test.user@example.com", { disabledCategories: ["email"] }),
    ).toEqual([]);
  });

  it("applyMatches(findMatches(x)) 결과가 mask(x)와 같다", () => {
    const samples = [
      "테스트 전화번호형식: 010-0000-0000",
      "가짜 주민번호 000000-1000000",
      "010-0000-0000\n000000-1000000",
      "가짜 주민번호 000000-1000000\n가짜 전화번호 010-0000-0000\n가짜 키 sk-TESTTESTTESTTESTTEST\n그대로 남아야 할 문장",
      "010-0000-0000\r\n000000-1000000",
      "email+key sk-TESTTESTTESTTESTTEST@example.com",
      "test.user@example.com",
      "sk-TESTTESTTESTTESTTEST",
      "같은 줄 두 값: 010-0000-0000 과 010-1111-2222",
      "평범한 테스트 문장",
      "",
    ];
    for (const sample of samples) {
      const matches = detector.findMatches(sample);
      expect(detector.applyMatches(sample, matches), `mask와 위치 기반 치환이 다릅니다: ${JSON.stringify(sample)}`).toBe(
        detector.mask(sample),
      );
    }
  });

  it("전각 표기만 있는 입력은 findMatches가 비어 mask()의 정규화 치환과 구분된다", () => {
    const fullWidth = "테스트 전각전화: ０１０-００００-００００";
    // 위치를 알 수 없으므로 위치 기반 치환 대상이 아니다.
    expect(findMatches(fullWidth)).toEqual([]);
    expect(detector.applyMatches(fullWidth, [])).toBe(fullWidth);
    // mask()는 정규화된 보기로 치환하므로 변형 표기만 있는 경우를 구분할 수 있다.
    expect(detector.mask(fullWidth)).not.toBe(fullWidth);
  });

  it("추가된 API는 원문을 담지 않고 인수 없이도 안전하게 동작한다", () => {
    expect(detector.applyMatches(undefined, [])).toBe("");
    expect(detector.applyMatches("그대로", undefined)).toBe("그대로");
    expect(
      findMatches("테스트 전화번호형식: 010-0000-0000", { disabledCategories: ["phone_number"] }),
    ).toEqual([]);
  });

  it("공개 API가 얼려 있어 바꿀 수 없다", () => {
    expect(Object.isFrozen(detector)).toBe(true);
    expect(Object.keys(detector).sort()).toEqual(["applyMatches", "findMatches", "inspect", "mask"]);
  });
});
