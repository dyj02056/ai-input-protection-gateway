"""PDP의 데모 정책을 확인하는 표준 라이브러리 단위 테스트."""

import unittest

from policy import Action, InspectionSummary, Policy, decide


class PolicyDecisionTests(unittest.TestCase):
    def test_no_findings_returns_allow(self):
        result = decide(InspectionSummary())
        self.assertEqual(result.action, Action.ALLOW)
        self.assertEqual(result.reason_codes, ("NO_DETECTED_CATEGORY",))

    def test_government_id_category_returns_mask(self):
        result = decide(InspectionSummary({"government_id"}))
        self.assertEqual(result.action, Action.MASK)

    def test_api_key_category_returns_block(self):
        result = decide(InspectionSummary({"api_key"}))
        self.assertEqual(result.action, Action.BLOCK)

    def test_unknown_category_defaults_to_approval(self):
        result = decide(InspectionSummary({"unlisted_category"}))
        self.assertEqual(result.action, Action.REQUIRE_APPROVAL)
        self.assertIn("UNKNOWN_CATEGORY_PRESENT", result.reason_codes)

    def test_stricter_action_wins_when_categories_are_mixed(self):
        result = decide(InspectionSummary({"government_id", "api_key"}))
        self.assertEqual(result.action, Action.BLOCK)

    def test_custom_policy_can_require_approval(self):
        policy = Policy(
            category_actions={"contract_data": Action.REQUIRE_APPROVAL}
        )
        result = decide(InspectionSummary({"contract_data"}), policy)
        self.assertEqual(result.action, Action.REQUIRE_APPROVAL)

    def test_raw_text_is_not_a_valid_summary(self):
        with self.assertRaises(TypeError):
            InspectionSummary("원문은 전달하지 않습니다")


if __name__ == "__main__":
    unittest.main()