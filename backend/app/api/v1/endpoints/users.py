from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.api.v1.deps import get_current_user, require_role
from app.core.security import hash_password, verify_password
from app.db.session import get_db
from app.models.user import Role, User
from app.schemas.user import UserOut

router = APIRouter(prefix="/users", tags=["users"])
Current = Annotated[User, Depends(get_current_user)]
Admin = Annotated[User, Depends(require_role(Role.INSTRUCTOR))]
DB = Annotated[AsyncSession, Depends(get_db)]


class Password(BaseModel):
    password: str = Field(min_length=10, max_length=72)


class NewEmployee(Password):
    email: EmailStr


class ChangePassword(Password):
    current_password: str = Field(max_length=256)


class Active(BaseModel):
    is_active: bool


async def encoded(password):
    if len(password.encode()) > 72:
        raise HTTPException(422, "密码不能超过 72 字节。")
    return await run_in_threadpool(hash_password, password)


@router.get("/me", response_model=UserOut)
async def me(user: Current):
    return user


@router.put("/me/password")
async def change_password(body: ChangePassword, user: Current, db: DB):
    if not await run_in_threadpool(verify_password, body.current_password, user.hashed_password):
        raise HTTPException(422, "当前密码错误。")
    user.hashed_password = await encoded(body.password)
    await db.commit()
    return {"ok": True}


@router.get("/employees", response_model=list[UserOut])
async def employees(admin: Admin, db: DB):
    return (await db.scalars(select(User).where(User.role == Role.TA).order_by(User.email))).all()


@router.post("/employees", response_model=UserOut, status_code=201)
async def create_employee(body: NewEmployee, admin: Admin, db: DB):
    row = User(email=body.email.lower(), role=Role.TA, hashed_password=await encoded(body.password))
    db.add(row)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "此邮箱已存在。") from exc
    await db.refresh(row)
    return row


async def employee(db, key):
    row = await db.get(User, key)
    if not row or row.role != Role.TA:
        raise HTTPException(404, "员工账号不存在。")
    return row


@router.put("/employees/{key}/password")
async def reset_password(key: UUID, body: Password, admin: Admin, db: DB):
    row = await employee(db, key)
    row.hashed_password = await encoded(body.password)
    await db.commit()
    return {"ok": True}


@router.patch("/employees/{key}", response_model=UserOut)
async def activate(key: UUID, body: Active, admin: Admin, db: DB):
    row = await employee(db, key)
    row.is_active = body.is_active
    await db.commit()
    return row
