"""PDP 서버 테스트 (표준 unittest + FastAPI TestClient).

실행: tools/server.py test   (또는 gateway-core 폴더에서
      python -m unittest discover -s server -p "test_*.py" -t .)
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from policy import Action

from server.app import create_app
from server.decision import FileStatus, decide_file, decide_prompt
from server.policies import PolicyDocument, PolicyError, PolicyStore, parse_policy
from server.settings import ConfigError, Settings, digest

KEY = "test-key-" + "a" * 32  # 테스트 전용 값. 실제 키가 아닙니다.
OTHER_KEY = "other-key-" + "b" * 32
POLICY_DIR = Path(__file__).resolve().parent / "policy_files"


# 테스트가 저장소 안에 감사 로그를 남기지 않도록 임시 폴더를 씁니다.
_AUDIT_TMP = tempfile.TemporaryDirectory()
ADMIN_KEY = "admin-key-" + "c" * 32  # 테스트 전용 값. 실제 키가 아닙니다.


def make_settings(**overrides) -> Settings:
    values = dict(
        api_key_digests={"acme": digest(KEY)},
        admin_key_digests={"boss": digest(ADMIN_KEY)},
        audit_dir=Path(tempfile.mkdtemp(dir=_AUDIT_TMP.name)),
        data_dir=Path(tempfile.mkdtemp(dir=_AUDIT_TMP.name)),
    )
    values.update(overrides)
    return Settings(**values)


def make_client(settings: Settings | None = None, store: PolicyStore | None = None) -> TestClient:
    settings = settings or make_settings()
    store = store or PolicyStore.from_directory(POLICY_DIR)
    return TestClient(create_app(settings, store))


AUTH = {"Authorization": f"Bearer {KEY}"}


def policy_data(**overrides) -> dict:
    data = {
        "policy_id": "default",
        "version": 1,
        "description": "테스트",
        "category_actions": {"email": "MASK", "api_key": "BLOCK"},
        "unknown_category_action": "REQUIRE_APPROVAL",
        "bulk_record_threshold": 100,
    }
    data.update(overrides)
    return data


class SettingsTests(unittest.TestCase):
    def test_requires_api_keys_unless_dev_flag(self):
        with self.assertRaisesRegex(ConfigError, "API 키가 없습니다"):
            Settings.from_env({})
        self.assertTrue(Settings.from_env({"PDP_ALLOW_NO_AUTH": "1"}).allow_no_auth)
        # "1"이 아닌 값은 켜지 않는다
        with self.assertRaises(ConfigError):
            Settings.from_env({"PDP_ALLOW_NO_AUTH": "true"})

    def test_reads_plain_keys_and_stores_only_digests(self):
        settings = Settings.from_env({"PDP_API_KEYS": f"acme={KEY}, beta={OTHER_KEY}"})
        self.assertEqual(set(settings.api_key_digests), {"acme", "beta"})
        self.assertEqual(settings.api_key_digests["acme"], digest(KEY))
        self.assertNotIn(KEY, repr(settings))

    def test_reads_hashed_keys(self):
        settings = Settings.from_env({"PDP_API_KEYS_SHA256": f"acme={digest(KEY).upper()}"})
        self.assertEqual(settings.api_key_digests["acme"], digest(KEY))

    def test_rejects_short_keys_without_echoing_them(self):
        short = "tooshort-secret"
        with self.assertRaises(ConfigError) as caught:
            Settings.from_env({"PDP_API_KEYS": f"acme={short}"})
        self.assertNotIn(short, str(caught.exception))

    def test_rejects_malformed_entries_without_echoing_values(self):
        secret = "x" * 30
        for raw in (f"novalue", f"=({secret})", f"bad name={secret}"):
            with self.assertRaises(ConfigError) as caught:
                Settings.from_env({"PDP_API_KEYS": raw})
            self.assertNotIn(secret, str(caught.exception))

    def test_rejects_bad_digest_and_duplicate_names(self):
        with self.assertRaises(ConfigError):
            Settings.from_env({"PDP_API_KEYS_SHA256": "acme=not-a-digest"})
        with self.assertRaises(ConfigError):
            Settings.from_env({"PDP_API_KEYS": f"acme={KEY}", "PDP_API_KEYS_SHA256": f"acme={digest(OTHER_KEY)}"})

    def test_numeric_settings_are_validated(self):
        base = {"PDP_API_KEYS": f"acme={KEY}"}
        self.assertEqual(Settings.from_env({**base, "PDP_ACTIVE_POLICY_VERSION": "3"}).active_policy_version, 3)
        self.assertEqual(Settings.from_env({**base, "PDP_MAX_BODY_BYTES": "1024"}).max_body_bytes, 1024)
        for name, value in (("PDP_ACTIVE_POLICY_VERSION", "abc"), ("PDP_MAX_BODY_BYTES", "10"), ("PDP_MAX_BODY_BYTES", "999999")):
            with self.assertRaises(ConfigError):
                Settings.from_env({**base, name: value})


class PolicyFileTests(unittest.TestCase):
    def test_bundled_default_policy_loads(self):
        store = PolicyStore.from_directory(POLICY_DIR)
        self.assertEqual(store.active.policy_id, "default")
        self.assertEqual(store.active.category_actions["api_key"], Action.BLOCK)
        self.assertEqual(store.active.unknown_category_action, Action.REQUIRE_APPROVAL)

    def test_rejects_invalid_documents(self):
        bad = [
            policy_data(version=0),
            policy_data(version="1"),
            policy_data(version=True),
            policy_data(policy_id="Bad Name"),
            policy_data(category_actions={}),
            policy_data(category_actions={"email": "DELETE"}),
            policy_data(category_actions={"Email": "MASK"}),
            policy_data(unknown_category_action="NOPE"),
            policy_data(bulk_record_threshold=0),
            policy_data(bulk_record_threshold=True),
            policy_data(extra_field=1),
        ]
        for data in bad:
            with self.assertRaises(PolicyError, msg=str(data)):
                parse_policy(data)
        with self.assertRaises(PolicyError):
            parse_policy([])

    def test_store_rules(self):
        v1 = parse_policy(policy_data(version=1))
        v2 = parse_policy(policy_data(version=2, category_actions={"email": "BLOCK"}))
        store = PolicyStore([v1, v2])
        self.assertEqual(store.active.version, 2)  # 기본은 가장 높은 버전
        self.assertEqual(PolicyStore([v1, v2], active_version=1).active.version, 1)
        with self.assertRaises(PolicyError):
            PolicyStore([v1, v2], active_version=9)
        with self.assertRaises(PolicyError):
            PolicyStore([v1, v1])
        with self.assertRaises(PolicyError):
            PolicyStore([v1, parse_policy(policy_data(policy_id="other", version=2))])
        with self.assertRaises(PolicyError):
            PolicyStore([])

    def test_directory_loading_errors_stop_the_server(self):
        with tempfile.TemporaryDirectory() as empty:
            with self.assertRaisesRegex(PolicyError, "정책 파일"):
                PolicyStore.from_directory(Path(empty))
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "broken.json").write_text("{not json", encoding="utf-8")
            with self.assertRaisesRegex(PolicyError, "broken.json"):
                PolicyStore.from_directory(Path(directory))

    def test_etag_is_stable_and_changes_with_content(self):
        a = parse_policy(policy_data())
        again = parse_policy(policy_data())
        changed = parse_policy(policy_data(category_actions={"email": "BLOCK", "api_key": "BLOCK"}))
        self.assertEqual(a.etag, again.etag)
        self.assertNotEqual(a.etag, changed.etag)
        # 키 순서가 달라도 같은 정책이면 같은 값
        reordered = parse_policy(policy_data(category_actions={"api_key": "BLOCK", "email": "MASK"}))
        self.assertEqual(a.etag, reordered.etag)


class DecisionTests(unittest.TestCase):
    def setUp(self):
        self.document = PolicyStore.from_directory(POLICY_DIR).active

    def test_prompt_matches_policy_module(self):
        self.assertEqual(decide_prompt([], self.document).action, Action.ALLOW)
        self.assertEqual(decide_prompt(["email"], self.document).action, Action.MASK)
        self.assertEqual(decide_prompt(["email", "api_key"], self.document).action, Action.BLOCK)
        self.assertEqual(decide_prompt(["credit_card"], self.document).action, Action.BLOCK)
        unknown = decide_prompt(["something_new"], self.document)
        self.assertEqual(unknown.action, Action.REQUIRE_APPROVAL)
        self.assertIn("UNKNOWN_CATEGORY_PRESENT", unknown.reason_codes)

    def test_file_rules(self):
        file = lambda status, cats=(), n=0: decide_file(status, cats, n, self.document)
        self.assertEqual(file(FileStatus.CLEAN).action, Action.ALLOW)
        for status in (FileStatus.UNINSPECTED, FileStatus.ENCRYPTED, FileStatus.TOO_LARGE, FileStatus.FAILED):
            self.assertEqual(file(status).action, Action.REQUIRE_APPROVAL, status)
        # 감지됐어도 파일은 값을 가릴 수 없어 MASK가 아니라 최소 REQUIRE_APPROVAL
        masked = file(FileStatus.DETECTED, ["email"])
        self.assertEqual(masked.action, Action.REQUIRE_APPROVAL)
        self.assertIn("FILE_CANNOT_MASK", masked.reason_codes)
        self.assertEqual(file(FileStatus.DETECTED, ["credit_card"]).action, Action.BLOCK)

    def test_bulk_rule_uses_the_policy_threshold(self):
        self.assertEqual(decide_file(FileStatus.DETECTED, ["email"], 99, self.document).action, Action.REQUIRE_APPROVAL)
        bulk = decide_file(FileStatus.DETECTED, ["email"], 100, self.document)
        self.assertEqual(bulk.action, Action.BLOCK)
        self.assertIn("BULK_RECORDS", bulk.reason_codes)
        strict = parse_policy(policy_data(bulk_record_threshold=10))
        self.assertEqual(decide_file(FileStatus.DETECTED, ["email"], 10, strict).action, Action.BLOCK)


class AuthTests(unittest.TestCase):
    def setUp(self):
        self.client = make_client()

    def test_healthz_needs_no_auth(self):
        self.assertEqual(self.client.get("/healthz").json(), {"status": "ok"})

    def test_missing_wrong_and_malformed_tokens_are_rejected_identically(self):
        bodies = set()
        for headers in (
            {},
            {"Authorization": "Bearer wrong-key-" + "x" * 30},
            {"Authorization": f"Basic {KEY}"},
            {"Authorization": "Bearer"},
            {"Authorization": "Bearer  "},
            {"Authorization": KEY},
        ):
            response = self.client.get("/v1/policy", headers=headers)
            self.assertEqual(response.status_code, 401, headers)
            self.assertEqual(response.headers["www-authenticate"], "Bearer")
            bodies.add(response.text)
        # 이유를 구분해서 알려주지 않는다
        self.assertEqual(len(bodies), 1)

    def test_every_v1_route_requires_auth(self):
        for method, path in (("get", "/v1/policy"), ("get", "/v1/policy/versions"), ("get", "/v1/policy/1"), ("post", "/v1/decide")):
            response = getattr(self.client, method)(path, **({"json": {}} if method == "post" else {}))
            self.assertEqual(response.status_code, 401, path)

    def test_correct_key_passes_and_multiple_keys_work(self):
        settings = make_settings(api_key_digests={"acme": digest(KEY), "beta": digest(OTHER_KEY)})
        client = make_client(settings)
        self.assertEqual(client.get("/v1/policy", headers=AUTH).status_code, 200)
        self.assertEqual(client.get("/v1/policy", headers={"Authorization": f"Bearer {OTHER_KEY}"}).status_code, 200)

    def test_bearer_scheme_is_case_insensitive(self):
        self.assertEqual(self.client.get("/v1/policy", headers={"Authorization": f"bearer {KEY}"}).status_code, 200)

    def test_dev_mode_without_keys_allows_requests_but_keys_still_win_when_configured(self):
        dev = make_client(Settings(allow_no_auth=True))
        self.assertEqual(dev.get("/v1/policy").status_code, 200)
        both = make_client(make_settings(allow_no_auth=True))
        self.assertEqual(both.get("/v1/policy").status_code, 401)


class PolicyApiTests(unittest.TestCase):
    def setUp(self):
        self.client = make_client()

    def test_active_policy_shape(self):
        response = self.client.get("/v1/policy", headers=AUTH)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(set(body), {"policy_id", "version", "description", "category_actions", "unknown_category_action", "bulk_record_threshold"})
        self.assertEqual(body["version"], 1)
        self.assertEqual(body["category_actions"]["api_key"], "BLOCK")
        self.assertEqual(body["bulk_record_threshold"], 100)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.headers["x-content-type-options"], "nosniff")

    def test_etag_and_conditional_requests(self):
        first = self.client.get("/v1/policy", headers=AUTH)
        etag = first.headers["etag"]
        for header in (etag, f"W/{etag}", f'"other", {etag}', "*"):
            response = self.client.get("/v1/policy", headers={**AUTH, "If-None-Match": header})
            self.assertEqual(response.status_code, 304, header)
            self.assertEqual(response.content, b"")
            self.assertEqual(response.headers["etag"], etag)
        stale = self.client.get("/v1/policy", headers={**AUTH, "If-None-Match": '"stale"'})
        self.assertEqual(stale.status_code, 200)

    def test_versions_endpoints(self):
        v2 = parse_policy(policy_data(version=2, category_actions={"email": "BLOCK"}))
        store = PolicyStore([parse_policy(policy_data(version=1)), v2], active_version=1)
        client = make_client(store=store)
        listing = client.get("/v1/policy/versions", headers=AUTH).json()
        self.assertEqual([(item["version"], item["active"]) for item in listing], [(1, True), (2, False)])
        self.assertEqual(client.get("/v1/policy/2", headers=AUTH).json()["category_actions"], {"email": "BLOCK"})
        self.assertEqual(client.get("/v1/policy/99", headers=AUTH).status_code, 404)
        self.assertEqual(client.get("/v1/policy/abc", headers=AUTH).status_code, 422)

    def test_docs_pages_are_not_exposed(self):
        for path in ("/docs", "/redoc", "/openapi.json"):
            self.assertEqual(self.client.get(path).status_code, 404, path)


class DecideApiTests(unittest.TestCase):
    def setUp(self):
        self.client = make_client()

    def decide(self, **payload):
        return self.client.post("/v1/decide", json=payload, headers=AUTH)

    def test_prompt_decisions(self):
        cases = [
            ([], "ALLOW"),
            (["email"], "MASK"),
            (["email", "api_key"], "BLOCK"),
            (["bank_account"], "MASK"),
            (["not_registered_yet"], "REQUIRE_APPROVAL"),
        ]
        for categories, action in cases:
            response = self.decide(detected_categories=categories)
            self.assertEqual(response.status_code, 200, categories)
            body = response.json()
            self.assertEqual(body["action"], action, categories)
            self.assertEqual((body["policy_id"], body["policy_version"]), ("default", 1))
            self.assertEqual(len(body["decision_id"]), 32)

    def test_decision_ids_are_unique(self):
        ids = {self.decide(detected_categories=["email"]).json()["decision_id"] for _ in range(5)}
        self.assertEqual(len(ids), 5)

    def test_file_decisions(self):
        self.assertEqual(self.decide(channel="file", file_status="clean").json()["action"], "ALLOW")
        self.assertEqual(self.decide(channel="file", file_status="encrypted").json()["action"], "REQUIRE_APPROVAL")
        detected = self.decide(channel="file", file_status="detected", detected_categories=["email"], record_count=5).json()
        self.assertEqual(detected["action"], "REQUIRE_APPROVAL")
        bulk = self.decide(channel="file", file_status="detected", detected_categories=["email"], record_count=150).json()
        self.assertEqual(bulk["action"], "BLOCK")
        self.assertIn("BULK_RECORDS", bulk["reason_codes"])

    def test_policy_version_selection(self):
        relaxed = parse_policy(policy_data(version=2, category_actions={"api_key": "MASK"}))
        store = PolicyStore([parse_policy(policy_data(version=1)), relaxed], active_version=1)
        client = make_client(store=store)
        post = lambda **p: client.post("/v1/decide", json=p, headers=AUTH)
        self.assertEqual(post(detected_categories=["api_key"]).json()["action"], "BLOCK")
        pinned = post(detected_categories=["api_key"], policy_version=2).json()
        self.assertEqual((pinned["action"], pinned["policy_version"]), ("MASK", 2))
        self.assertEqual(post(detected_categories=[], policy_version=9).status_code, 404)

    def test_rejects_anything_that_could_carry_raw_text(self):
        secret = "010-1234-5678 홍길동 sk-secretsecretsecret"
        for extra in ("text", "content", "filename", "input", "prompt"):
            response = self.decide(detected_categories=["email"], **{extra: secret})
            self.assertEqual(response.status_code, 422, extra)
            # 보낸 값을 오류 응답에 되돌려 주지 않는다
            self.assertNotIn("010-1234", response.text)
            self.assertNotIn("홍길동", response.text)
            self.assertNotIn("sk-secret", response.text)

    def test_category_ids_must_look_like_ids_not_text(self):
        for bad in ("010-1234-5678", "Email", "has space", "", "a" * 65, "한글", "email;drop", "api key"):
            response = self.decide(detected_categories=[bad])
            self.assertEqual(response.status_code, 422, bad)
        self.assertEqual(self.decide(detected_categories=["x" * 33 for _ in range(33)]).status_code, 422)

    def test_numeric_and_channel_fields_are_validated(self):
        self.assertEqual(self.decide(channel="file").status_code, 422)  # file_status 필요
        self.assertEqual(self.decide(channel="file", file_status="nope").status_code, 422)
        self.assertEqual(self.decide(channel="prompt", file_status="clean").status_code, 422)
        self.assertEqual(self.decide(channel="prompt", record_count=5).status_code, 422)
        self.assertEqual(self.decide(channel="file", file_status="detected", record_count=-1).status_code, 422)
        self.assertEqual(self.decide(channel="file", file_status="detected", record_count=10**9).status_code, 422)
        self.assertEqual(self.decide(channel="email").status_code, 422)
        self.assertEqual(self.decide(policy_version=0).status_code, 422)

    def test_malformed_bodies(self):
        for content in (b"not json", b"[]", b'"x"', b"null"):
            response = self.client.post("/v1/decide", content=content, headers={**AUTH, "Content-Type": "application/json"})
            self.assertEqual(response.status_code, 422, content)

    def test_oversized_body_is_rejected(self):
        settings = make_settings(max_body_bytes=512)
        client = make_client(settings)
        huge = {"detected_categories": ["email"], "padding": "x" * 2000}
        response = client.post("/v1/decide", json=huge, headers=AUTH)
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json(), {"detail": "요청이 너무 큽니다."})
        # 상한 이하의 정상 요청은 통과
        self.assertEqual(client.post("/v1/decide", json={"detected_categories": ["email"]}, headers=AUTH).status_code, 200)

    def test_validation_errors_do_not_include_input_values(self):
        response = self.decide(detected_categories=["Contains PII 010-9999-8888"])
        self.assertEqual(response.status_code, 422)
        for item in response.json()["detail"]:
            self.assertEqual(set(item), {"loc", "msg", "type"})
        self.assertNotIn("010-9999", response.text)


class LoggingTests(unittest.TestCase):
    def test_logs_contain_counts_and_caller_but_no_categories_or_keys(self):
        client = make_client()
        with self.assertLogs("pdp", level="INFO") as captured:
            client.post("/v1/decide", json={"detected_categories": ["api_key", "email"]}, headers=AUTH)
        text = "\n".join(captured.output)
        self.assertIn("caller=acme", text)
        self.assertIn("categories=2", text)
        self.assertIn("action=BLOCK", text)
        self.assertNotIn("api_key", text)
        self.assertNotIn("email", text)
        self.assertNotIn(KEY, text)


ADMIN = {"Authorization": f"Bearer {ADMIN_KEY}"}


def event(n: int = 1, **overrides) -> dict:
    data = {
        "event_id": f"{n:032x}",
        "at": 1_700_000_000_000 + n,
        "action": "MASK",
        "categories": ["email"],
        "channel": "prompt",
        "policy_version": 1,
    }
    data.update(overrides)
    return data


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.settings = make_settings()
        self.client = make_client(self.settings)

    def post(self, *events, headers=AUTH):
        return self.client.post("/v1/audit", json={"events": list(events)}, headers=headers)

    def test_post_stores_and_chains(self):
        response = self.post(event(1), event(2), event(3))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"accepted": 3, "duplicates": 0, "head_seq": 3})
        records = self.client.get("/v1/audit", headers=ADMIN).json()["records"]
        self.assertEqual([r["seq"] for r in records], [1, 2, 3])
        self.assertEqual(records[0]["prev_hash"], "0" * 64)
        self.assertEqual(records[1]["prev_hash"], records[0]["hash"])
        self.assertEqual(records[0]["caller"], "acme")
        verify = self.client.get("/v1/audit/verify", headers=ADMIN).json()
        self.assertTrue(verify["ok"])
        self.assertEqual(verify["count"], 3)
        head = self.client.get("/v1/audit/head", headers=ADMIN).json()
        self.assertEqual(head, {"seq": 3, "hash": records[2]["hash"]})

    def test_retry_is_idempotent(self):
        self.post(event(1))
        again = self.post(event(1), event(2)).json()
        self.assertEqual((again["accepted"], again["duplicates"], again["head_seq"]), (1, 1, 2))

    def test_client_key_cannot_read_and_admin_key_cannot_write(self):
        self.post(event(1))
        for path in ("/v1/audit", "/v1/audit/head", "/v1/audit/verify"):
            self.assertEqual(self.client.get(path, headers=AUTH).status_code, 401, path)
            self.assertEqual(self.client.get(path).status_code, 401, path)
        self.assertEqual(self.post(event(2), headers=ADMIN).status_code, 401)
        self.assertEqual(self.client.post("/v1/audit", json={"events": [event(3)]}).status_code, 401)

    def test_rejects_extra_fields_and_bad_values_without_echo(self):
        secret = "SECRET-INPUT-TEXT"
        for bad in (
            event(1, text=secret),
            event(1, filename=secret),
            event(1, categories=[secret]),
            event(1, action="DELETE"),
            event(1, event_id="not-hex"),
            event(1, at=-1),
            event(1, channel="other"),
        ):
            response = self.post(bad)
            self.assertEqual(response.status_code, 422, bad)
            self.assertNotIn(secret, response.text)
        self.assertEqual(self.client.post("/v1/audit", json={"events": []}, headers=AUTH).status_code, 422)
        self.assertEqual(self.post(*[event(i) for i in range(1, 52)]).status_code, 422)
        self.assertEqual(self.client.get("/v1/audit/head", headers=ADMIN).json()["seq"], 0)

    def test_batch_of_50_fits_the_audit_body_limit_but_other_paths_stay_small(self):
        self.assertEqual(self.post(*[event(i) for i in range(1, 51)]).status_code, 200)
        big = self.client.post("/v1/decide", content=b"x" * 5000, headers=AUTH)
        self.assertEqual(big.status_code, 413)
        huge = self.client.post("/v1/audit", content=b"x" * 40000, headers=AUTH)
        self.assertEqual(huge.status_code, 413)

    def test_verify_detects_edit_delete_and_reorder(self):
        self.post(event(1), event(2), event(3))
        path = self.settings.audit_dir / "audit.jsonl"
        original = path.read_text(encoding="utf-8")
        lines = original.strip().split("\n")

        def broken_at(new_lines):
            path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
            return self.client.get("/v1/audit/verify", headers=ADMIN).json()

        edited = json.loads(lines[1])
        edited["event"]["action"] = "ALLOW"
        result = broken_at([lines[0], json.dumps(edited), lines[2]])
        self.assertFalse(result["ok"])
        self.assertEqual(result["broken_at"], 2)
        self.assertFalse(broken_at([lines[0], lines[2]])["ok"])  # 중간 삭제
        self.assertFalse(broken_at([lines[1], lines[0], lines[2]])["ok"])  # 순서 바꿈
        self.assertTrue(broken_at(lines)["ok"])  # 원래대로면 통과

    def test_restart_restores_chain_and_dedupe(self):
        self.post(event(1), event(2))
        again = make_client(self.settings)
        ack = again.post("/v1/audit", json={"events": [event(2), event(3)]}, headers=AUTH).json()
        self.assertEqual((ack["accepted"], ack["duplicates"], ack["head_seq"]), (1, 1, 3))
        self.assertTrue(again.get("/v1/audit/verify", headers=ADMIN).json()["ok"])

    def test_corrupt_log_blocks_startup(self):
        self.post(event(1))
        path = self.settings.audit_dir / "audit.jsonl"
        path.write_text(path.read_text(encoding="utf-8").replace("MASK", "BLOCK"), encoding="utf-8")
        with self.assertRaisesRegex(RuntimeError, "손상"):
            make_client(self.settings)

    def test_log_has_no_raw_input_fields(self):
        self.post(event(1))
        text = (self.settings.audit_dir / "audit.jsonl").read_text(encoding="utf-8")
        for field in ("text", "content", "filename", "url"):
            self.assertNotIn(f'"{field}"', text)

    def test_read_paging_and_limits(self):
        self.post(*[event(i) for i in range(1, 6)])
        page = self.client.get("/v1/audit?after=2&limit=2", headers=ADMIN).json()["records"]
        self.assertEqual([r["seq"] for r in page], [3, 4])
        self.assertEqual(self.client.get("/v1/audit?limit=0", headers=ADMIN).status_code, 422)
        self.assertEqual(self.client.get("/v1/audit?after=-1", headers=ADMIN).status_code, 422)

    def test_admin_keys_must_differ_from_api_keys(self):
        with self.assertRaisesRegex(ConfigError, "같은 값"):
            Settings.from_env({"PDP_API_KEYS": f"a={KEY}", "PDP_ADMIN_KEYS": f"b={KEY}"})
        settings = Settings.from_env({"PDP_API_KEYS": f"a={KEY}", "PDP_ADMIN_KEYS_SHA256": f"b={digest(ADMIN_KEY)}"})
        self.assertIn("b", settings.admin_key_digests)


if __name__ == "__main__":
    unittest.main()

