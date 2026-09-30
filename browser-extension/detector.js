(() => {
  "use strict";

  // 원문이나 일치한 문자열은 반환하지 않고, 발견된 유형 이름만 반환합니다.
  const RULES = [
    {
      label: "주민등록번호 형식",
      // 6자리 + 선택적 하이픈/공백 + 성별·세기 코드(1~8)와 6자리.
      // 날짜 유효성이나 실제 번호 여부는 확인하지 않습니다.
      pattern: /(?:^|[^\d])\d{6}[- ]?[1-8]\d{6}(?!\d)/,
    },
    {
      label: "전화번호 형식",
      // 국내 휴대전화·일부 지역번호·070·050 계열의 간단한 형식 검사입니다.
      pattern: /(?:^|[^\d])0(?:2|[3-6]\d|1[016789]|70|50[2-8])[- .]?\d{3,4}[- .]?\d{4}(?!\d)/,
    },
    {
      label: "API 키/토큰 형식",
      // 흔히 쓰이는 일부 키 접두사만 다룹니다. 모든 서비스의 키를 찾지는 않습니다.
      pattern: /(?:^|[^A-Za-z0-9])(?:sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|github_pat_[A-Za-z0-9_]{20,}|(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})(?![A-Za-z0-9])/,
    },
  ];

  globalThis.AIInputGatewayDetector = Object.freeze({
    inspect(text) {
      const source = typeof text === "string" ? text : "";
      return RULES.filter((rule) => rule.pattern.test(source)).map(
        (rule) => rule.label,
      );
    },
  });
})();