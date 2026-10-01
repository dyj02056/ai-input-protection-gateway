(() => {
  "use strict";

  // gateway-core/pdp/policy.py와 같은 규칙을 브라우저 안에서 실행하는 로컬 정책 엔진입니다.
  //
  // - 입력 원문이나 일치한 문자열은 받지도 돌려주지도 않습니다. 탐지 범주 ID만 다룹니다.
  // - 네트워크 요청이 없습니다. 이 판정은 브라우저 로컬에서만 이루어집니다.
  // - 조치 이름을 돌려줄 뿐이며, 전송을 막는 일은 부르는 쪽(content.js)이 설정에 따라 결정합니다.

  const ACTION_PRIORITY = Object.freeze({
    ALLOW: 1,
    MASK: 2,
    REQUIRE_APPROVAL: 3,
    BLOCK: 4,
  });

  const ACTION_REASON = Object.freeze({
    ALLOW: "ALLOW_POLICY_MATCHED",
    MASK: "MASK_POLICY_MATCHED",
    REQUIRE_APPROVAL: "APPROVAL_POLICY_MATCHED",
    BLOCK: "BLOCK_POLICY_MATCHED",
  });

  const DEFAULT_CATEGORY_ACTIONS = Object.freeze({
    government_id: "MASK",
    phone_number: "MASK",
    email: "MASK",
    api_key: "BLOCK",
  });

  const UNKNOWN_CATEGORY_ACTION = "REQUIRE_APPROVAL";

  // 원문 문자열이 실수로 범주 목록 자리에 들어오는 것을 막습니다.
  function normalizeCategories(categories) {
    if (categories === null || categories === undefined) {
      return [];
    }
    if (typeof categories === "string") {
      throw new TypeError("원문 문자열이 아니라 범주 ID의 배열을 전달해야 합니다.");
    }
    if (!Array.isArray(categories)) {
      throw new TypeError("탐지 범주는 배열이어야 합니다.");
    }

    const unique = new Set();
    for (const category of categories) {
      if (typeof category !== "string" || category.length === 0) {
        throw new TypeError("탐지 범주는 비어 있지 않은 문자열이어야 합니다.");
      }
      if (category.trim() !== category) {
        throw new TypeError("탐지 범주는 앞뒤 공백이 없어야 합니다.");
      }
      unique.add(category);
    }
    return [...unique];
  }

  function actionOf(category, categoryActions, unknownCategoryAction) {
    if (Object.prototype.hasOwnProperty.call(categoryActions, category)) {
      return categoryActions[category];
    }
    return unknownCategoryAction;
  }

  // policy.py의 decide()와 같은 규칙입니다.
  // 우선순위는 BLOCK > REQUIRE_APPROVAL > MASK > ALLOW이며, 등록되지 않은 범주가 있으면
  // REQUIRE_APPROVAL(기본)을 적용하고 UNKNOWN_CATEGORY_PRESENT를 이유에 더합니다.
  function decide(categories, policy) {
    const list = normalizeCategories(categories);
    const categoryActions = (policy && policy.categoryActions) || DEFAULT_CATEGORY_ACTIONS;
    const unknownCategoryAction =
      (policy && policy.unknownCategoryAction) || UNKNOWN_CATEGORY_ACTION;

    if (list.length === 0) {
      return { action: "ALLOW", reasonCodes: ["NO_DETECTED_CATEGORY"] };
    }

    let selected = "ALLOW";
    for (const category of list) {
      const action = actionOf(category, categoryActions, unknownCategoryAction);
      if (!Object.prototype.hasOwnProperty.call(ACTION_PRIORITY, action)) {
        throw new TypeError("알 수 없는 조치 이름입니다: " + String(action));
      }
      if (ACTION_PRIORITY[action] > ACTION_PRIORITY[selected]) {
        selected = action;
      }
    }

    const reasonCodes = [ACTION_REASON[selected]];
    if (list.some((category) => !Object.prototype.hasOwnProperty.call(categoryActions, category))) {
      reasonCodes.push("UNKNOWN_CATEGORY_PRESENT");
    }

    return { action: selected, reasonCodes: reasonCodes.sort() };
  }

  globalThis.AIInputGatewayPolicy = Object.freeze({
    ACTION_PRIORITY,
    DEFAULT_CATEGORY_ACTIONS,
    UNKNOWN_CATEGORY_ACTION,
    decide,
  });
})();
