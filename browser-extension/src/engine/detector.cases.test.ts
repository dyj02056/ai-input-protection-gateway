// 평가용 데이터 세트(detection_cases.json)로 탐지기를 점검합니다. TS 모듈과 빌드 산출물 양쪽에 돌립니다.
// 개별 사례가 모두 맞아야 하고, 범주별 정밀도·재현율도 계산해 기준 아래로 떨어지면 실패합니다.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CATEGORY_IDS } from "../shared/categories.ts";
import { loadArtifactGlobal } from "../test/artifact.ts";
import { detector as moduleDetector, type Detector, type DetectorOptions } from "./detector.ts";

interface Case {
  id: string;
  text?: string;
  // 비밀 스캐너가 진짜 키로 오인할 값은 조각으로 나눠 적고 여기서 합칩니다
  textParts?: string[];
  expect: string[];
  options?: DetectorOptions;
  masked?: string;
}

const CASES = (
  JSON.parse(readFileSync(resolve(import.meta.dirname, "detection_cases.json"), "utf8")) as {
    cases: Case[];
  }
).cases;

const textOf = (item: Case): string => item.text ?? (item.textParts ?? []).join("");

const subjects: Array<[string, () => Detector]> = [
  ["TS 모듈", () => moduleDetector],
  [
    "빌드 산출물 dist-ext/detector.js",
    // 브라우저가 제공하는 atob만 넣습니다(Base64로 감싼 값을 풀 때 씁니다). 없으면 그 검사는 조용히 건너뜁니다.
    () => loadArtifactGlobal<Detector>("detector.js", "AIInputGatewayDetector", { atob }),
  ],
];

describe("평가 데이터 세트 구성", () => {
  it("사례 ID가 겹치지 않는다", () => {
    const ids = CASES.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("모든 범주마다 잡혀야 하는 사례와 잡히면 안 되는 사례가 각각 5개 이상 있다", () => {
    for (const category of CATEGORY_IDS) {
      const positives = CASES.filter((item) => item.expect.includes(category)).length;
      // 이 범주가 아닌 다른 값(또는 아무것도 아닌 값)이라 이 범주가 잡히면 안 되는 사례
      const negatives = CASES.filter((item) => !item.expect.includes(category)).length;
      expect(positives, `${category} 양성`).toBeGreaterThanOrEqual(5);
      expect(negatives, `${category} 음성`).toBeGreaterThanOrEqual(5);
    }
  });
});

describe.each(subjects)("탐지 평가 (%s)", (_name, load) => {
  const detector = load();
  const run = (item: Case) => [...detector.inspect(textOf(item), item.options)].sort();

  it.each(CASES.map((item) => [item.id, item] as const))("%s", (_id, item) => {
    expect(run(item)).toEqual([...item.expect].sort());
    if (item.masked !== undefined) {
      expect(detector.mask(textOf(item), item.options)).toBe(item.masked);
    }
  });

  it("범주별 정밀도·재현율이 모두 100%다 (이 데이터 세트 기준)", () => {
    const report: string[] = [];
    for (const category of CATEGORY_IDS) {
      let truePositive = 0;
      let falsePositive = 0;
      let falseNegative = 0;
      for (const item of CASES) {
        const detected = run(item).includes(category);
        const expected = item.expect.includes(category);
        if (detected && expected) truePositive += 1;
        else if (detected) falsePositive += 1;
        else if (expected) falseNegative += 1;
      }
      const precision = truePositive / Math.max(1, truePositive + falsePositive);
      const recall = truePositive / Math.max(1, truePositive + falseNegative);
      report.push(`${category}: 정밀도 ${precision.toFixed(2)} 재현율 ${recall.toFixed(2)}`);
      expect(precision, `${category} 정밀도`).toBe(1);
      expect(recall, `${category} 재현율`).toBe(1);
    }
    expect(report).toHaveLength(CATEGORY_IDS.length);
  });
});
