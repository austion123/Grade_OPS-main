"""Create an administrator interactively after running Alembic migrations."""
import asyncio
import getpass

from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy.exc import IntegrityError

from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models.user import Role, User


async def create(email, password):
    async with SessionLocal() as db:
        db.add(User(email=email.lower(), hashed_password=hash_password(password), role=Role.INSTRUCTOR))
        try:
            await db.commit()
        except IntegrityError:
            raise SystemExit("该邮箱已经存在，未更改原账号。") from None


if __name__ == "__main__":
    try:
        email = TypeAdapter(EmailStr).validate_python(input("管理员邮箱：").strip())
    except ValidationError:
        raise SystemExit("邮箱格式不正确。") from None
    password = getpass.getpass("管理员密码：")
    if len(password) < 10 or len(password.encode()) > 72:
        raise SystemExit("密码至少 10 个字符且不超过 72 字节。")
    if getpass.getpass("确认密码：") != password:
        raise SystemExit("两次输入的密码不一致。")
    asyncio.run(create(email, password))
    print("管理员账号已创建。")
