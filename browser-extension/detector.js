(() => {
  "use strict";

  // PDP policy.py와 공유하는 범주 ID만 반환합니다.
  // 원문이나 정규식과 일치한 문자열은 inspect() 결과에 넣지 않습니다.
  // mask()는 사용자가 선택한 경우에만 일치 문자열을 자리표시자로 바꿉니다.
  //
  // [수정] 경계 문자를 캡처/소비하지 않도록 lookbehind(?<!\d), (?<![A-Za-z0-9])를 사용합니다.
  //        이렇게 하면 매칭 대상이 실제 민감정보 부분만이 되어 줄바꿈이 보존됩니다.
  const RULES = [
    {
      categoryId: "government_id",
      maskLabel: "주민등록번호",
      // 날짜 유효성이나 실제 번호 여부는 확인하지 않습니다.
      pattern: /(?<!\d)\d{6}[- ]?[1-8]\d{6}(?!\d)/,
    },
    {
      categoryId: "phone_number",
      maskLabel: "전화번호",
      // 국내 휴대전화·일부 지역번호·070·050 계열의 간단한 형식 검사입니다.
      pattern: /(?<!\d)0(?:2|[3-6]\d|1[016789]|70|50[2-8])[- .]?\d{3,4}[- .]?\d{4}(?!\d)/,
    },
    {
      categoryId: "api_key",
      maskLabel: "API 키/토큰",
      // 일부 키 접두사만 다룹니다. 모든 서비스의 키를 찾지는 않습니다.
      pattern: /(?<![A-Za-z0-9])(?:sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|github_pat_[A-Za-z0-9_]{20,}|(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})(?![A-Za-z0-9])/,
    },
    {
      categoryId: "email",
      maskLabel: "이메일",
      // RFC 전체가 아니라 업무용 식별 목적의 실용 패턴입니다.
      pattern: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?![A-Za-z])/,
    },
  ];

  function normalizeForDetection(text) {
    // 전각 숫자·하이픈 등 표기 변형을 NFKC로 정규화한 뒤 검사합니다.
    // 마스킹은 원문 표기를 최대한 유지하며, 전각 변형은 탐지 우선·마스킹 제한을 README에 명시합니다.
    try {
      return typeof text.normalize === "function" ? text.normalize("NFKC") : text;
    } catch {
      return text;
    }
  }

  globalThis.AIInputGatewayDetector = Object.freeze({
    inspect(text) {
      const source = typeof text === "string" ? normalizeForDetection(text) : "";
      return RULES.filter((rule) => rule.pattern.test(source)).map(
        (rule) => rule.categoryId,
      );
    },

    mask(text) {
      const source = typeof text === "string" ? text : "";
      const normalized = typeof text === "string" ? normalizeForDetection(text) : "";
      let masked = source;

      for (const rule of RULES) {
        // 전역 정규식은 호출 때마다 새로 만들어 lastIndex 상태를 공유하지 않습니다.
        const pattern = new RegExp(rule.pattern.source, "g");
        masked = masked.replace(
          pattern,
          () => `[${rule.maskLabel}]`,
        );
      }

      // 전각 변형 등 원문 표기가 달라 치환되지 않은 경우,
      // 정규화된 보기에서 탐지된 부분은 가려 구조 노출을 줄입니다.
      if (normalized !== source) {
        let normalizedMasked = normalized;
        for (const rule of RULES) {
          normalizedMasked = normalizedMasked.replace(
            new RegExp(rule.pattern.source, "g"),
            () => `[${rule.maskLabel}]`,
          );
        }
        if (normalizedMasked !== normalized && masked === source) {
          masked = normalizedMasked;
        }
      }

      return masked;
    },
  });
})();