(() => {
  "use strict";

  // 원문은 inspect 결과에 넣지 않습니다. mask()는 사용자가 선택한 경우에만
  // 현재 입력값 안의 일치 문자열을 유형별 자리표시자로 바꿉니다.
  const RULES = [
    {
      label: "주민등록번호 형식",
      maskLabel: "주민등록번호",
      // 날짜 유효성이나 실제 번호 여부는 확인하지 않습니다.
      pattern: /(^|[^\d])\d{6}[- ]?[1-8]\d{6}(?!\d)/,
    },
    {
      label: "전화번호 형식",
      // 국내 휴대전화·일부 지역번호·070·050 계열의 간단한 형식 검사입니다.
      maskLabel: "전화번호",
      pattern: /(^|[^\d])0(?:2|[3-6]\d|1[016789]|70|50[2-8])[- .]?\d{3,4}[- .]?\d{4}(?!\d)/,
    },
    {
      label: "API 키/토큰 형식",
      // 일부 키 접두사만 다룹니다. 모든 서비스의 키를 찾지는 않습니다.
      maskLabel: "API 키/토큰",
      pattern: /(^|[^A-Za-z0-9])(?:sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|github_pat_[A-Za-z0-9_]{20,}|(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})(?![A-Za-z0-9])/
    },
  ];

  globalThis.AIInputGatewayDetector = Object.freeze({
    inspect(text) {
      const source = typeof text === "string" ? text : "";
      return RULES.filter((rule) => rule.pattern.test(source)).map(
        (rule) => rule.label,
      );
    },

    mask(text) {
      let masked = typeof text === "string" ? text : "";

      for (const rule of RULES) {
        // 전역 정규식은 호출 때마다 새로 만들어 lastIndex 상태를 공유하지 않습니다.
        const pattern = new RegExp(rule.pattern.source, "g");
        masked = masked.replace(
          pattern,
          (_match, boundary = "") => `${boundary}[${rule.maskLabel}]`,
        );
      }

      return masked;
    },
  });
})();