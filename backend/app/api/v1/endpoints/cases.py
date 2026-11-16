from datetime import datetime, timedelta, timezone
import base64
import hashlib
import json
import logging
import re
from pathlib import Path
from typing import Annotated
from uuid import UUID, uuid4
from xml.etree.ElementTree import ParseError
from zipfile import BadZipFile

from cryptography.fernet import Fernet
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from jose import JWTError, jwt
from pydantic import BaseModel, Field, HttpUrl, ValidationError
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import JSONB, insert
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.api.v1.deps import require_role
from app.core.config import get_settings
from app.db.session import SessionLocal, get_db
from app.models.case_review import CaseKnowledge, CaseReview, CaseSettings
from app.models.user import Role, User
from app.services import case_agent, case_documents
from app.services.storage import LocalStorage

router = APIRouter(tags=["engineering cases"])
Employee = Annotated[User, Depends(require_role(Role.TA))]
Admin = Annotated[User, Depends(require_role(Role.INSTRUCTOR))]
DB = Annotated[AsyncSession, Depends(get_db)]
log = logging.getLogger(__name__)
MAX_FILE = 25 * 1024 * 1024


class RequestText(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class ModelConfig(BaseModel):
    base_url: HttpUrl
    model: str = Field(min_length=1, max_length=200)
    api_key: str = Field(default="", max_length=4096)


class ReviewConfig(BaseModel):
    advice: str = Field(max_length=12000)
    rubrics: list[dict] = Field(default_factory=list, max_length=2)
    policy_token: str | None = None


def cipher():
    key = hashlib.sha256(("case-model:" + get_settings().SECRET_KEY).encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


async def read_settings(db):
    row = await db.get(CaseSettings, 1)
    return dict(row.config) if row else {}


async def save_settings(db, values):
    stmt = insert(CaseSettings).values(id=1, config=values)
    # Serialize partial updates so model and review settings do not overwrite each other.
    await db.execute(stmt.on_conflict_do_update(index_elements=[CaseSettings.id],
                     set_={"config": CaseSettings.config.cast(JSONB)
                           .op("||")(stmt.excluded.config.cast(JSONB))}))
    await db.commit()


def runtime(config):
    try:
        key = cipher().decrypt(config["encrypted_key"].encode()).decode() if config.get("encrypted_key") else ""
    except Exception as exc:
        raise HTTPException(422, "无法解密已保存的 API 密钥，请管理员重新录入。") from exc
    return {k: v for k, v in config.items() if k != "encrypted_key"} | {"api_key": key}


def make_token(user, scope, actions):
    return jwt.encode({"sub": str(user.id), "scope": scope, "actions": actions,
                       "exp": datetime.now(timezone.utc) + timedelta(minutes=30)},
                      get_settings().SECRET_KEY, algorithm=get_settings().ALGORITHM)


def read_token(user, scope, token):
    if not token:
        return []
    try:
        payload = jwt.decode(token, get_settings().SECRET_KEY, algorithms=[get_settings().ALGORITHM])
        if payload["sub"] != str(user.id) or payload["scope"] != scope:
            raise ValueError
        return payload["actions"]
    except (JWTError, KeyError, ValueError) as exc:
        raise HTTPException(422, "报告要求确认已失效，请重新识别并确认。") from exc


async def preview(user, db, text, scope):
    config = await read_settings(db)
    if not text.strip():
        raise HTTPException(422, "请输入报告要求。")
    locks = {a["module"] for a in config.get("policy", [])} if scope == "employee" else set()
    try:
        intent = await case_agent.interpret(runtime(config), text.strip())
        if intent.clarification:
            return {"clarification": intent.clarification}
        actions, blocked = case_agent.normalize_actions([a.model_dump() for a in intent.actions], locks)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if not actions and not blocked:
        return {"clarification": "没有识别到具体调整，请说明要保留、隐藏或不计分的模块。"}
    return {"actions": actions, "blocked": blocked, "token": make_token(user, scope, actions)}


@router.get("/case-modules")
async def modules(user: Employee):
    return case_agent.MODULES


@router.post("/case-reviews/intent")
async def employee_intent(body: RequestText, user: Employee, db: DB):
    return await preview(user, db, body.text, "employee")


@router.post("/case-admin/intent")
async def admin_intent(body: RequestText, user: Admin, db: DB):
    return await preview(user, db, body.text, "admin")


@router.get("/case-admin/settings")
async def admin_settings(user: Admin, db: DB):
    config = await read_settings(db)
    return {"base_url": config.get("base_url", ""), "model": config.get("model", ""),
            "key_saved": bool(config.get("encrypted_key")), "advice": config.get("advice", ""),
            "rubrics": config.get("rubrics", []), "policy": config.get("policy", []),
            "modules": case_agent.MODULES}


def model_values(body, current):
    url = str(body.base_url).rstrip("/")
    if body.base_url.username or body.base_url.password or body.base_url.fragment or body.base_url.query:
        raise HTTPException(422, "请输入不含账号、查询参数和片段的 API 基础地址。")
    url = url.removesuffix("/chat/completions")
    key = body.api_key.strip()
    if not key and url != current.get("base_url"):
        raise HTTPException(422, "更换 API 地址时请重新输入该地址对应的 API 密钥。")
    return {"base_url": url, "model": body.model.strip(),
            "encrypted_key": cipher().encrypt(key.encode()).decode() if key else current.get("encrypted_key", "")}


@router.put("/case-admin/model")
async def save_model(body: ModelConfig, user: Admin, db: DB):
    values = model_values(body, await read_settings(db))
    if not values["model"] or not values["encrypted_key"]:
        raise HTTPException(422, "请提供模型名称和密钥。")
    await save_settings(db, values)
    return {"ok": True}


@router.post("/case-admin/model/test")
async def test_model(body: ModelConfig, user: Admin, db: DB):
    class Reply(BaseModel):
        ok: bool
    try:
        reply = await case_agent.ask(runtime(model_values(body, await read_settings(db))),
                                     '请只返回这个 JSON 对象：{"ok": true}', {}, Reply)
        if not reply.ok:
            raise ValueError("模型可访问，但没有通过 JSON 响应测试。")
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"ok": True}


@router.put("/case-admin/review-settings")
async def save_review_config(body: ReviewConfig, user: Admin, db: DB):
    await persist_review_config(db, user, body.advice, body.policy_token, body.rubrics)
    return {"ok": True}


async def persist_review_config(db, user, advice, policy_token, rules):
    config = {"advice": advice.strip()}
    if rules is not None:
        try:
            config["rubrics"] = case_agent.validate_rubrics(rules)
        except ValidationError as exc:
            field = ".".join(map(str, exc.errors(include_input=False)[0]["loc"]))
            raise HTTPException(422, f"评分规则字段「{field}」不符合格式，请参考页面示例。") from exc
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
    if policy_token is not None:
        config["policy"] = read_token(user, "admin", policy_token)
    await save_settings(db, config)
    return config


@router.put("/case-admin/review-settings/import")
async def import_review_config(
    user: Admin,
    db: DB,
    advice: Annotated[str, Form(max_length=12000)] = "",
    policy_token: Annotated[str | None, Form()] = None,
    clear_policy: Annotated[bool, Form()] = False,
    file: Annotated[UploadFile | None, File()] = None,
):
    rules = None
    if file is not None:
        filename, data = await upload_bytes(file)
        if not filename.lower().endswith(".json"):
            raise HTTPException(422, "请选择 .json 评分规则文件。")
        try:
            rules = json.loads(data.decode("utf-8-sig"))
        except json.JSONDecodeError as exc:
            raise HTTPException(422, f"JSON 格式错误，请检查第 {exc.lineno} 行、第 {exc.colno} 列。") from exc
        except (UnicodeDecodeError, ValueError, RecursionError) as exc:
            raise HTTPException(422, "无法读取评分规则，请使用 UTF-8 编码的 JSON 文件。") from exc
        if not isinstance(rules, list) or len(rules) > 2 or any(not isinstance(rule, dict) for rule in rules):
            raise HTTPException(422, "评分规则 JSON 的最外层应为数组，最多包含完整版、简化版各一套规则。")
    saved = await persist_review_config(db, user, advice, "" if clear_policy else policy_token, rules)
    return {"ok": True, "rubrics": saved.get("rubrics")}


async def upload_bytes(file):
    filename = Path(file.filename or "").name.replace("\\", "/").rsplit("/", 1)[-1][:255]
    data = await file.read(MAX_FILE + 1)
    if not data or len(data) > MAX_FILE:
        raise HTTPException(422, "文件为空或超过 25 MB。")
    return filename, data


@router.get("/case-admin/knowledge")
async def list_knowledge(user: Admin, db: DB):
    return [{"id": uid, "filename": name, "size": size} for uid, name, size in
            (await db.execute(select(CaseKnowledge.id, CaseKnowledge.filename,
                                     func.length(CaseKnowledge.content))
                              .order_by(CaseKnowledge.filename))).all()]


@router.post("/case-admin/knowledge", status_code=201)
async def add_knowledge(user: Admin, db: DB, file: Annotated[UploadFile, File()]):
    filename, data = await upload_bytes(file)
    try:
        content = await run_in_threadpool(case_documents.knowledge_text, data, filename)
    except (ValueError, RuntimeError, BadZipFile, KeyError, ParseError) as exc:
        raise HTTPException(422, str(exc) if type(exc) is ValueError else "文档无法解析，请检查文件格式。") from exc
    row = CaseKnowledge(filename=filename, content=content)
    db.add(row)
    await db.commit()
    return {"id": row.id, "filename": filename, "size": len(content)}


@router.delete("/case-admin/knowledge/{key}")
async def remove_knowledge(key: UUID, user: Admin, db: DB):
    row = await db.get(CaseKnowledge, key)
    if not row:
        raise HTTPException(404, "未找到文档。")
    await db.delete(row)
    await db.commit()
    return {"ok": True}


def result(row, detail=False):
    status, error = row.status, row.error
    if status in {"parsing", "reviewing"} and row.created_at < datetime.now(timezone.utc) - timedelta(minutes=10):
        status, error = "failed", "审核超时或服务已重启，请重新提交。"
    return {"id": row.id, "filename": row.filename, "created_at": row.created_at,
            "status": status, "error": error, **({"report": row.report} if detail else {})}


def select_reference(pages, documents):
    case = " ".join(p["text"].lower() for p in pages)
    words = set(re.findall(r"[a-z0-9_-]{3,}|[\u4e00-\u9fff]{2}", case))
    chunks = []
    for filename, content in documents:
        for pos in range(0, len(content), 1800):
            chunk = content[pos:pos+2000]
            tokens = set(re.findall(r"[a-z0-9_-]{3,}|[\u4e00-\u9fff]{2}", chunk.lower()))
            overlap = len(words & tokens)
            if overlap:
                chunks.append((overlap, filename, chunk))
    return [{"filename": fn, "excerpt": chunk} for _, fn, chunk in sorted(chunks, reverse=True)[:5]]


async def run_case(key, filename, config, actions):
    async with SessionLocal() as db:
        row = await db.get(CaseReview, key)
        if not row:
            return
        try:
            store = LocalStorage(Path(get_settings().STORAGE_ROOT))
            data = await run_in_threadpool(store.get, "cases/" + str(key))
            pages = await run_in_threadpool(case_documents.slides, data, filename)
            row.status = "reviewing"
            await db.commit()
            documents = (await db.execute(select(CaseKnowledge.filename, CaseKnowledge.content))).all()
            await db.commit()
            reference = await run_in_threadpool(select_reference, pages, documents)
            output = await case_agent.graph.ainvoke({"config": config, "pages": pages, "employee": actions, "reference": reference})
            row.report = output["report"]
            row.status = "done"
        except (ValueError, BadZipFile, KeyError, ParseError) as exc:
            row.status = "failed"
            row.error = str(exc) if type(exc) is ValueError else "无法解析 PPT，请检查文件是否损坏。"
        except Exception:
            log.exception("Case review failed: %s", key)
            await db.rollback()
            row = await db.get(CaseReview, key)
            row.status = "failed"
            row.error = "审核服务出错，请重试或联系管理员。"
        await db.commit()


@router.post("/case-reviews", status_code=202)
async def submit(user: Employee, db: DB, jobs: BackgroundTasks, file: Annotated[UploadFile, File()],
                 intent: Annotated[str, Form()] = ""):
    filename, data = await upload_bytes(file)
    if Path(filename).suffix.lower() not in {".ppt", ".pptx"}:
        raise HTTPException(422, "请上传 .ppt 或 .pptx 文件。")
    config = runtime(await read_settings(db))
    if not all(config.get(k) for k in ("api_key", "model", "base_url")):
        raise HTTPException(422, "管理员尚未配置大模型 API。")
    actions, blocked = case_agent.normalize_actions(read_token(user, "employee", intent),
                                                     {a["module"] for a in config.get("policy", [])})
    if blocked:
        raise HTTPException(409, "管理员策略已更新，请重新确认报告要求。")
    row = CaseReview(id=uuid4(), owner_id=user.id, filename=filename, status="parsing")
    db.add(row)
    store = LocalStorage(Path(get_settings().STORAGE_ROOT))
    key = "cases/" + str(row.id)
    try:
        await run_in_threadpool(store.put, key, data)
        await db.commit()
    except Exception:
        await run_in_threadpool(store.delete, key)
        raise
    await db.refresh(row)
    jobs.add_task(run_case, row.id, filename, config, actions)
    return result(row)


@router.get("/case-reviews")
async def history(user: Employee, db: DB, offset: int = 0):
    if offset < 0:
        raise HTTPException(422, "无效的历史记录起点。")
    records = (await db.scalars(select(CaseReview).where(CaseReview.owner_id == user.id)
                                 .order_by(CaseReview.created_at.desc(), CaseReview.id).offset(offset).limit(50))).all()
    return [result(row) for row in records]


@router.get("/case-reviews/{key}")
async def report(key: UUID, user: Employee, db: DB):
    row = await db.get(CaseReview, key)
    if not row or row.owner_id != user.id:
        raise HTTPException(404, "未找到审核记录。")
    return result(row, detail=True)
