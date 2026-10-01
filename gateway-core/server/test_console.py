"""승인 워크플로·정책 버전 관리·관리 기록·콘솔 화면 테스트 (4-4)."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from server.app import create_app
from server.approvals import ApprovalError, ApprovalStore
from server.policies import PolicyError, PolicyStore
from server.settings import Settings, digest
from server.test_server import ADMIN, ADMIN_KEY, AUTH, KEY, OTHER_KEY, POLICY_DIR, make_client, make_settings

OTHER = {"Authorization": f"Bearer {OTHER_KEY}"}


class FakeClock:
    def __init__(self) -> None:
        self.now = 1_800_000_000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def request(**overrides) -> dict:
    body = {"categories": ["phone_number", "email"], "channel": "prompt", "purpose": "customer_response", "note": "고객 답변 초안"}
    body.update(overrides)
    return body


class ApprovalStoreTests(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()
        self.store = ApprovalStore(None, pending_seconds=3600, valid_seconds=600, clock=self.clock)

    def make(self, requester="acme"):
        return self.store.create(requester, ["email", "phone_number"], "prompt", "other", "")

    def test_happy_path_is_single_use(self):
        record = self.make()
        self.assertEqual(record["status"], "PENDING")
        decided = self.store.decide(record["approval_id"], "boss", True, "ok")
        self.assertEqual(decided["status"], "APPROVED")
        self.assertEqual(self.store.consume(record["approval_id"], "acme")["status"], "CONSUMED")
        with self.assertRaises(ApprovalError) as raised:
            self.store.consume(record["approval_id"], "acme")
        self.assertEqual(raised.exception.status, 409)

    def test_self_approval_and_double_decision_are_refused(self):
        record = self.make()
        with self.assertRaises(ApprovalError) as raised:
            self.store.decide(record["approval_id"], "acme", True, "")
        self.assertEqual(raised.exception.status, 403)
        self.store.decide(record["approval_id"], "boss", False, "no")
        with self.assertRaises(ApprovalError) as raised:
            self.store.decide(record["approval_id"], "boss", True, "")
        self.assertEqual(raised.exception.status, 409)

    def test_rejected_cannot_be_consumed(self):
        record = self.make()
        self.store.decide(record["approval_id"], "boss", False, "")
        with self.assertRaises(ApprovalError):
            self.store.consume(record["approval_id"], "acme")

    def test_pending_expires_and_cannot_be_approved_afterwards(self):
        record = self.make()
        self.clock.advance(3601)
        self.assertEqual(self.store.get(record["approval_id"])["status"], "EXPIRED")
        with self.assertRaises(ApprovalError) as raised:
            self.store.decide(record["approval_id"], "boss", True, "")
        self.assertEqual(raised.exception.status, 409)

    def test_approval_expires_after_the_valid_window(self):
        record = self.make()
        self.store.decide(record["approval_id"], "boss", True, "")
        self.clock.advance(599)
        self.assertEqual(self.store.get(record["approval_id"])["status"], "APPROVED")
        self.clock.advance(2)
        with self.assertRaises(ApprovalError):
            self.store.consume(record["approval_id"], "acme")
        self.assertEqual(self.store.get(record["approval_id"])["status"], "EXPIRED")

    def test_other_requesters_cannot_see_or_use_it(self):
        record = self.make()
        self.assertIsNone(self.store.get(record["approval_id"], requester="beta"))
        self.store.decide(record["approval_id"], "boss", True, "")
        with self.assertRaises(ApprovalError) as raised:
            self.store.consume(record["approval_id"], "beta")
        self.assertEqual(raised.exception.status, 404)

    def test_pending_limit_per_requester(self):
        for _ in range(50):
            self.make()
        with self.assertRaises(ApprovalError) as raised:
            self.make()
        self.assertEqual(raised.exception.status, 429)
        self.make("someone-else")  # 다른 요청자는 영향이 없다

    def test_persists_and_reloads(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ApprovalStore(Path(directory), clock=self.clock)
            record = store.create("acme", ["email"], "prompt", "other", "메모")
            store.decide(record["approval_id"], "boss", True, "ok")
            again = ApprovalStore(Path(directory), clock=self.clock)
            self.assertEqual(again.get(record["approval_id"])["status"], "APPROVED")
            self.assertEqual(again.get(record["approval_id"])["decided_by"], "boss")

    def test_corrupt_file_blocks_startup(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / "approvals.json").write_text("{not json", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "손상"):
                ApprovalStore(Path(directory))

    def test_old_finished_records_are_pruned(self):
        record = self.make()
        self.store.decide(record["approval_id"], "boss", False, "")
        self.clock.advance(91 * 24 * 3600)
        self.assertEqual(self.store.list(), [])


class ApprovalApiTests(unittest.TestCase):
    def setUp(self):
        self.settings = make_settings(api_key_digests={"acme": digest(KEY), "beta": digest(OTHER_KEY)})
        self.client = make_client(self.settings)

    def create(self, **overrides):
        return self.client.post("/v1/approvals", json=request(**overrides), headers=AUTH)

    def test_full_flow(self):
        created = self.create()
        self.assertEqual(created.status_code, 201)
        approval_id = created.json()["approval_id"]
        self.assertEqual(created.json()["status"], "PENDING")

        self.assertEqual(self.client.get(f"/v1/approvals/{approval_id}", headers=AUTH).json()["status"], "PENDING")

        listed = self.client.get("/v1/approvals?status=PENDING", headers=ADMIN).json()["approvals"]
        self.assertEqual([item["approval_id"] for item in listed], [approval_id])
        self.assertEqual(listed[0]["requester"], "acme")
        self.assertEqual(listed[0]["categories"], ["email", "phone_number"])

        decision = self.client.post(f"/v1/approvals/{approval_id}/decision", json={"decision": "approve", "note": "확인함"}, headers=ADMIN)
        self.assertEqual(decision.status_code, 200)
        state = self.client.get(f"/v1/approvals/{approval_id}", headers=AUTH).json()
        self.assertEqual((state["status"], state["decision_note"]), ("APPROVED", "확인함"))

        used = self.client.post(f"/v1/approvals/{approval_id}/consume", headers=AUTH)
        self.assertEqual(used.json()["status"], "CONSUMED")
        self.assertEqual(self.client.post(f"/v1/approvals/{approval_id}/consume", headers=AUTH).status_code, 409)

    def test_requester_view_does_not_leak_other_fields(self):
        approval_id = self.create(note="사유").json()["approval_id"]
        view = self.client.get(f"/v1/approvals/{approval_id}", headers=AUTH).json()
        self.assertEqual(set(view), {"approval_id", "status", "expires_at", "decision_note"})

    def test_keys_are_separated(self):
        approval_id = self.create().json()["approval_id"]
        # 일반 키는 목록·처리를 못 하고, 관리자 키는 요청을 만들지 못한다
        self.assertEqual(self.client.get("/v1/approvals", headers=AUTH).status_code, 401)
        self.assertEqual(self.client.post(f"/v1/approvals/{approval_id}/decision", json={"decision": "approve"}, headers=AUTH).status_code, 401)
        self.assertEqual(self.client.post("/v1/approvals", json=request(), headers=ADMIN).status_code, 401)
        # 다른 호출자는 남의 요청을 보거나 쓸 수 없다
        self.assertEqual(self.client.get(f"/v1/approvals/{approval_id}", headers=OTHER).status_code, 404)
        self.client.post(f"/v1/approvals/{approval_id}/decision", json={"decision": "approve"}, headers=ADMIN)
        self.assertEqual(self.client.post(f"/v1/approvals/{approval_id}/consume", headers=OTHER).status_code, 404)
        # 인증 없음
        for method, path in (("get", "/v1/approvals"), ("post", "/v1/approvals"), ("get", f"/v1/approvals/{approval_id}")):
            self.assertEqual(getattr(self.client, method)(path).status_code, 401, path)

    def test_self_approval_is_forbidden_when_names_match(self):
        settings = make_settings(
            api_key_digests={"same": digest(KEY)}, admin_key_digests={"same": digest(ADMIN_KEY)}
        )
        client = make_client(settings)
        approval_id = client.post("/v1/approvals", json=request(), headers=AUTH).json()["approval_id"]
        response = client.post(f"/v1/approvals/{approval_id}/decision", json={"decision": "approve"}, headers=ADMIN)
        self.assertEqual(response.status_code, 403)

    def test_rejects_raw_text_fields_and_bad_values_without_echo(self):
        secret = "SECRET-INPUT-TEXT"
        for bad in (
            request(text=secret),
            request(content_hash=secret),
            request(categories=[secret]),
            request(categories=[]),
            request(purpose="because"),
            request(note="x" * 101),
            request(channel="mail"),
        ):
            response = self.client.post("/v1/approvals", json=bad, headers=AUTH)
            self.assertEqual(response.status_code, 422, bad)
            self.assertNotIn(secret, response.text)

    def test_decision_validation_and_unknown_ids(self):
        approval_id = self.create().json()["approval_id"]
        for body in ({"decision": "maybe"}, {"decision": "approve", "extra": 1}, {}):
            self.assertEqual(self.client.post(f"/v1/approvals/{approval_id}/decision", json=body, headers=ADMIN).status_code, 422)
        self.assertEqual(self.client.post("/v1/approvals/" + "0" * 32 + "/decision", json={"decision": "approve"}, headers=ADMIN).status_code, 404)
        self.assertEqual(self.client.get("/v1/approvals?status=WHATEVER", headers=ADMIN).status_code, 422)
        self.assertEqual(self.client.get("/v1/approvals?limit=0", headers=ADMIN).status_code, 422)

    def test_decisions_are_written_to_the_admin_log(self):
        approval_id = self.create().json()["approval_id"]
        self.client.post(f"/v1/approvals/{approval_id}/decision", json={"decision": "reject", "note": "no"}, headers=ADMIN)
        records = self.client.get("/v1/admin/events", headers=ADMIN).json()["records"]
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["event"]["kind"], "approval.reject")
        self.assertEqual(records[0]["caller"], "boss")
        self.assertTrue(self.client.get("/v1/admin/events/verify", headers=ADMIN).json()["ok"])

    def test_restart_keeps_approvals(self):
        approval_id = self.create().json()["approval_id"]
        reopened = make_client(self.settings)
        self.assertEqual(reopened.get(f"/v1/approvals/{approval_id}", headers=AUTH).json()["status"], "PENDING")


class PolicyAdminTests(unittest.TestCase):
    def setUp(self):
        self.settings = make_settings()
        self.data = self.settings.data_dir / "policies"
        self.client = TestClient(create_app(self.settings, PolicyStore.from_directory(POLICY_DIR, None, self.data)))

    def draft(self, **overrides):
        base = self.client.get("/v1/admin/policies", headers=ADMIN).json()["versions"][0]
        body = {
            "description": "이메일은 승인 검토로",
            "category_actions": dict(base["category_actions"], email="REQUIRE_APPROVAL"),
            "unknown_category_action": base["unknown_category_action"],
            "bulk_record_threshold": base["bulk_record_threshold"],
        }
        body.update(overrides)
        return body

    def test_requires_admin_key(self):
        for method, path in (("get", "/v1/admin/policies"), ("post", "/v1/admin/policies"), ("post", "/v1/admin/policies/1/activate")):
            kwargs = {"json": {}} if method == "post" else {}
            self.assertEqual(getattr(self.client, method)(path, headers=AUTH, **kwargs).status_code, 401, path)
            self.assertEqual(getattr(self.client, method)(path, **kwargs).status_code, 401, path)

    def test_create_does_not_change_the_active_policy_until_activated(self):
        created = self.client.post("/v1/admin/policies", json=self.draft(), headers=ADMIN)
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.json()["version"], 2)
        self.assertFalse(created.json()["active"])
        self.assertEqual(self.client.get("/v1/policy", headers=AUTH).json()["version"], 1)

        activated = self.client.post("/v1/admin/policies/2/activate", headers=ADMIN)
        self.assertTrue(activated.json()["active"])
        served = self.client.get("/v1/policy", headers=AUTH).json()
        self.assertEqual((served["version"], served["category_actions"]["email"]), (2, "REQUIRE_APPROVAL"))

    def test_etag_changes_so_extensions_pick_up_the_new_policy(self):
        before = self.client.get("/v1/policy", headers=AUTH).headers["etag"]
        self.client.post("/v1/admin/policies", json=self.draft(activate=True), headers=ADMIN)
        after = self.client.get("/v1/policy", headers=AUTH)
        self.assertNotEqual(before, after.headers["etag"])
        self.assertEqual(self.client.get("/v1/policy", headers={**AUTH, "If-None-Match": before}).status_code, 200)

    def test_rollback_and_unknown_version(self):
        self.client.post("/v1/admin/policies", json=self.draft(activate=True), headers=ADMIN)
        self.assertEqual(self.client.post("/v1/admin/policies/1/activate", headers=ADMIN).status_code, 200)
        self.assertEqual(self.client.get("/v1/policy", headers=AUTH).json()["version"], 1)
        self.assertEqual(self.client.post("/v1/admin/policies/99/activate", headers=ADMIN).status_code, 404)
        # 버전은 지워지지 않는다
        self.assertEqual([v["version"] for v in self.client.get("/v1/admin/policies", headers=ADMIN).json()["versions"]], [1, 2])

    def test_secrets_and_payment_cannot_be_weakened(self):
        for category in ("api_key", "credit_card", "password"):
            actions = self.draft()["category_actions"]
            actions[category] = "MASK"
            response = self.client.post("/v1/admin/policies", json=self.draft(category_actions=actions), headers=ADMIN)
            self.assertEqual(response.status_code, 422, category)
            self.assertIn(category, response.json()["detail"])
        # 목록에서 빼도 알 수 없는 범주 조치가 BLOCK이 아니면 약화로 본다
        actions = {k: v for k, v in self.draft()["category_actions"].items() if k != "api_key"}
        self.assertEqual(self.client.post("/v1/admin/policies", json=self.draft(category_actions=actions), headers=ADMIN).status_code, 422)
        self.assertEqual(self.client.get("/v1/admin/policies", headers=ADMIN).json()["versions"][-1]["version"], 1)

    def test_validation(self):
        for bad in (
            self.draft(bulk_record_threshold=0),
            self.draft(unknown_category_action="DELETE"),
            self.draft(category_actions={"Bad Id": "MASK"}),
            self.draft(category_actions={}),
            {**self.draft(), "policy_id": "other"},
        ):
            self.assertEqual(self.client.post("/v1/admin/policies", json=bad, headers=ADMIN).status_code, 422, bad)

    def test_versions_and_active_choice_survive_restart(self):
        self.client.post("/v1/admin/policies", json=self.draft(activate=True), headers=ADMIN)
        reopened = TestClient(create_app(self.settings, PolicyStore.from_directory(POLICY_DIR, 1, self.data)))
        # 콘솔에서 정한 활성 버전이 환경 변수 값(1)보다 우선한다
        self.assertEqual(reopened.get("/v1/policy", headers=AUTH).json()["version"], 2)
        self.assertEqual(len(reopened.get("/v1/admin/policies", headers=ADMIN).json()["versions"]), 2)

    def test_default_policy_files_are_never_modified(self):
        before = {path.name: path.read_bytes() for path in POLICY_DIR.glob("*.json")}
        self.client.post("/v1/admin/policies", json=self.draft(activate=True), headers=ADMIN)
        self.assertEqual(before, {path.name: path.read_bytes() for path in POLICY_DIR.glob("*.json")})
        self.assertTrue((self.data / "policy.v2.json").exists())

    def test_changes_are_recorded_in_a_verifiable_chain(self):
        self.client.post("/v1/admin/policies", json=self.draft(activate=True), headers=ADMIN)
        self.client.post("/v1/admin/policies/1/activate", headers=ADMIN)
        self.client.post("/v1/admin/policies/1/activate", headers=ADMIN)  # 이미 활성: 기록하지 않는다
        records = self.client.get("/v1/admin/events", headers=ADMIN).json()["records"]
        self.assertEqual([r["event"]["kind"] for r in records], ["policy.create", "policy.activate", "policy.activate"])
        self.assertEqual([r["event"].get("version") for r in records], [2, 2, 1])
        self.assertTrue(self.client.get("/v1/admin/events/verify", headers=ADMIN).json()["ok"])

    def test_corrupt_active_file_blocks_startup(self):
        self.client.post("/v1/admin/policies", json=self.draft(activate=True), headers=ADMIN)
        (self.data / "active.json").write_text('{"version": "x"}', encoding="utf-8")
        with self.assertRaises(PolicyError):
            PolicyStore.from_directory(POLICY_DIR, None, self.data)

    def test_oversized_body_rejected_but_policy_sized_body_accepted(self):
        self.assertEqual(self.client.post("/v1/admin/policies", content=b"{" + b" " * 20000 + b"}", headers={**ADMIN, "Content-Type": "application/json"}).status_code, 413)
        long_description = "가" * 500
        self.assertEqual(self.client.post("/v1/admin/policies", json=self.draft(description=long_description), headers=ADMIN).status_code, 201)


class ConsoleTests(unittest.TestCase):
    def setUp(self):
        self.client = make_client()

    def test_page_and_assets_are_served_without_auth_and_without_data(self):
        page = self.client.get("/console")
        self.assertEqual(page.status_code, 200)
        self.assertIn("text/html", page.headers["content-type"])
        self.assertEqual(self.client.get("/console/").status_code, 200)
        self.assertEqual(self.client.get("/console/console.js").status_code, 200)
        self.assertEqual(self.client.get("/console/console.css").status_code, 200)
        self.assertNotIn(ADMIN_KEY, page.text)

    def test_security_headers(self):
        for path in ("/console", "/console/console.js"):
            headers = self.client.get(path).headers
            self.assertIn("script-src 'self'", headers["content-security-policy"])
            self.assertIn("frame-ancestors 'none'", headers["content-security-policy"])
            self.assertIn("connect-src 'self'", headers["content-security-policy"])
            self.assertEqual(headers["x-frame-options"], "DENY")
            self.assertEqual(headers["referrer-policy"], "no-referrer")
            self.assertEqual(headers["cache-control"], "no-store")

    def test_only_listed_assets_are_served(self):
        for path in ("/console/index.html", "/console/../app.py", "/console/%2e%2e/app.py", "/console/secrets.txt"):
            self.assertEqual(self.client.get(path).status_code, 404, path)

    def test_page_has_no_inline_script_or_remote_resources(self):
        html = self.client.get("/console").text
        self.assertNotIn("http://", html)
        self.assertNotIn("https://", html)
        import re

        for match in re.finditer(r"<script\b([^>]*)>", html):
            self.assertIn("src=", match.group(1))
        self.assertNotIn("onclick=", html)

    def test_script_never_renders_server_text_as_html(self):
        source = (Path(__file__).resolve().parent / "console" / "console.js").read_text(encoding="utf-8")
        for forbidden in ("innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "localStorage", "sessionStorage"):
            self.assertNotIn(forbidden, source, forbidden)
        # 키를 주소·쿼리로 보내지 않는다
        self.assertNotIn("?key=", source)

    def test_locked_categories_match_the_server(self):
        from server.policies import LOCKED_BLOCK_CATEGORIES

        source = (Path(__file__).resolve().parent / "console" / "console.js").read_text(encoding="utf-8")
        line = next(item for item in source.splitlines() if item.startswith("const LOCKED"))
        self.assertEqual(set(__import__("re").findall(r'"([a-z_]+)"', line)), set(LOCKED_BLOCK_CATEGORIES))


class SettingsTests(unittest.TestCase):
    def test_approval_windows_and_data_dir(self):
        settings = Settings.from_env(
            {"PDP_ALLOW_NO_AUTH": "1", "PDP_APPROVAL_TTL_MINUTES": "60", "PDP_APPROVAL_VALID_MINUTES": "5", "PDP_DATA_DIR": "x"}
        )
        self.assertEqual((settings.approval_pending_seconds, settings.approval_valid_seconds), (3600, 300))
        self.assertEqual(settings.data_dir, Path("x"))
        defaults = Settings.from_env({"PDP_ALLOW_NO_AUTH": "1"})
        self.assertEqual((defaults.approval_pending_seconds, defaults.approval_valid_seconds), (4 * 3600, 30 * 60))

    def test_bad_values_are_rejected(self):
        from server.settings import ConfigError

        for name in ("PDP_APPROVAL_TTL_MINUTES", "PDP_APPROVAL_VALID_MINUTES"):
            for value in ("0", "abc", "-5"):
                with self.assertRaises(ConfigError):
                    Settings.from_env({"PDP_ALLOW_NO_AUTH": "1", name: value})


if __name__ == "__main__":
    unittest.main()
