"""Integration test. Run only against a fresh, disposable PostgreSQL database."""
import io
import os
import unittest
from unittest.mock import patch
from zipfile import ZipFile

from fastapi.testclient import TestClient

from app.core.security import hash_password
from app.db.session import SessionLocal, engine
from app.main import app
from app.models.user import Role, User

P = "http://schemas.openxmlformats.org/presentationml/2006/main"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def deck():
    payload = io.BytesIO()
    with ZipFile(payload, "w") as archive:
        # Relationship order must win over filename order.
        archive.writestr("ppt/presentation.xml", f'<p:presentation xmlns:p="{P}" xmlns:r="{R}">'
                          '<p:sldIdLst><p:sldId r:id="a"/><p:sldId r:id="b"/></p:sldIdLst></p:presentation>')
        archive.writestr("ppt/_rels/presentation.xml.rels",
                          '<Relationships><Relationship Id="a" Target="slides/slide2.xml"/>'
                          '<Relationship Id="b" Target="slides/slide1.xml"/></Relationships>')
        archive.writestr("ppt/slides/slide2.xml", f'<p:sld xmlns:p="{P}" xmlns:a="{A}"><a:t>机台初始化故障</a:t></p:sld>')
        archive.writestr("ppt/slides/slide1.xml", f'<p:sld xmlns:p="{P}" xmlns:a="{A}"><a:t>初始化前电源未开启。</a:t></p:sld>')
    return payload.getvalue()


async def mock_model(config, system, data, schema):
    if schema.__name__ == "Intent":
        action = {"隐藏经验总结": "hide", "忽略经验总结的评分": "unscore"}[data["request"]]
        return schema(actions=[{"module": "lessons", "action": action}])
    if schema.__name__ == "Plan":
        assert data["pages"][1]["text"] == "初始化前电源未开启。"
        return schema(case_type="完整版", modules=["timeline"])
    if schema.__name__ == "Report":
        assert data["reference"][0]["filename"] == "sop.txt"
        return schema(metadata={"title": {"value": "机台初始化故障", "evidence": {"page": 1, "quote": "机台初始化故障"}}},
                      admission="待补充信息", findings=[
            {"module": key, "kind": "内容缺失" if key == "timeline" else "内容不充分",
             "conclusion": "请补充材料", "basis": "案例提供了直接原因", "issue": "缺少测试",
             "suggestion": "补充测试日志", "priority": key == "root_cause",
             "evidence": [{"page": 2, "quote": "初始化前电源未开启。"}, {"page": 8, "quote": "编造"}],
             "levels": {c["id"]: next(iter(c["levels"])) for c in data["criteria"] if c["module"] == key}}
            for key in data["modules"]
        ])
    return schema(ok=True)


@unittest.skipUnless(os.getenv("CASE_INTEGRATION_TEST") == "1", "requires disposable PostgreSQL database")
class CaseWorkflowTest(unittest.TestCase):
    def test_employee_and_admin(self):
        async def seed():
            async with SessionLocal() as db:
                db.add(User(email="owner@example.com", hashed_password=hash_password("test-admin-password"),
                            role=Role.INSTRUCTOR))
                await db.commit()

        with TestClient(app) as client, patch("app.services.case_agent.ask", side_effect=mock_model):
            client.portal.call(seed)
            try:
                def request(verb, url, code, **kwargs):
                    response = client.request(verb, "/api/v1" + url, **kwargs)
                    self.assertEqual(response.status_code, code, response.text)
                    return response.json()

                def login(email, password):
                    token = request("POST", "/auth/login", 200, data={"username": email, "password": password})
                    return {"Authorization": "Bearer " + token["access_token"]}

                admin = login("owner@example.com", "test-admin-password")
                for email in ("worker@example.com", "other@example.com"):
                    request("POST", "/users/employees", 201, headers=admin, json={"email": email, "password": "test-employee-password"})
                employee = login("worker@example.com", "test-employee-password")
                other = login("other@example.com", "test-employee-password")
                request("GET", "/case-admin/settings", 403, headers=employee)
                request("POST", "/auth/register", 404)
                model = {"base_url": "http://127.0.0.1:555/llm/v1", "model": "mock", "api_key": "fake-test-key"}
                request("POST", "/case-admin/model/test", 200, headers=admin, json=model)
                request("PUT", "/case-admin/model", 200, headers=admin, json=model)
                settings = request("GET", "/case-admin/settings", 200, headers=admin)
                self.assertTrue(settings["key_saved"])
                self.assertNotIn("fake-test-key", str(settings))
                request("POST", "/case-admin/knowledge", 201, headers=admin,
                        files={"file": ("sop.txt", "初始化前电源未开启。请检查电源。".encode())})
                settings = {"advice": "检查流程", "rubrics": [{"version": "test", "case_type": "完整版", "criteria": [
                    {"id": "root", "module": "root_cause", "weight": 1, "levels": {"仅说明直接原因": 80}},
                    {"id": "notes", "module": "lessons", "weight": 4, "levels": {"经验证据不足": 20}},
                ]}]}
                request("PUT", "/case-admin/review-settings", 200, headers=admin, json=settings)
                intent = request("POST", "/case-reviews/intent", 200, headers=employee, json={"text": "忽略经验总结的评分"})
                request("GET", "/users/me", 401, headers={"Authorization": "Bearer " + intent["token"]})
                row = request("POST", "/case-reviews", 202, headers=employee, data={"intent": intent["token"]},
                              files={"file": ("case.pptx", deck())})
                endpoint = "/case-reviews/" + row["id"]
                request("GET", endpoint, 404, headers=other)
                self.assertEqual(request("GET", "/case-reviews", 200, headers=other), [])
                item = request("GET", endpoint, 200, headers=employee)
                self.assertEqual(item["status"], "done", item)
                report = item["report"]
                self.assertEqual(report["score"]["total"], 80)
                self.assertEqual(report["metadata"]["案例标题"]["value"], "机台初始化故障")
                self.assertEqual(len(report["findings"][0]["evidence"]), 1)
                self.assertTrue(next(row for row in report["findings"] if row["module"] == "timeline")["ai_added"])
                rule = request("POST", "/case-admin/intent", 200, headers=admin, json={"text": "隐藏经验总结"})
                request("PUT", "/case-admin/review-settings", 200, headers=admin,
                        json={"advice": "", "policy_token": rule["token"]})
                request("POST", "/case-reviews", 409, headers=employee, data={"intent": intent["token"]},
                        files={"file": ("case.pptx", deck())})
                self.assertEqual(request("GET", endpoint, 200, headers=employee)["report"], report)
                row = request("POST", "/case-reviews", 202, headers=employee, files={"file": ("broken.pptx", b"bad zip")})
                self.assertEqual(request("GET", "/case-reviews/" + row["id"], 200, headers=employee)["status"], "failed")
                request("PUT", "/users/me/password", 200, headers=employee,
                        json={"current_password": "test-employee-password", "password": "test-updated-password"})
                request("GET", "/users/me", 401, headers=employee)
            finally:
                client.portal.call(engine.dispose)
