# 工程案例审核：升级与运行

既有 `INSTRUCTOR` 对应管理员，`TA` 对应员工。原有用户可以继续使用，升级后需重新登录。迁移 `0006` 只新增案例记录、配置和知识库表；旧试卷及查重数据不删除，旧业务入口已下线。

## 在已有 Python 和 PostgreSQL 的本地环境启动

1. 用 `backend/.env.example` 补齐 `backend/.env`，保留已有数据库账号和连接配置。若 PostgreSQL 在本机，`POSTGRES_HOST=127.0.0.1`；`STORAGE_ROOT` 设置为应用有写权限的本地绝对路径。设置一个随机、长期固定的 `SECRET_KEY`：它用于登录会话和 API 密钥加密，更换后需重新录入模型密钥。
2. 在项目根目录执行：

   ```bash
   python -m venv .venv
   source .venv/bin/activate
   python -m pip install -r backend/requirements.txt
   cd backend
   alembic upgrade head
   # 仅在数据库中没有管理员时执行；按提示输入邮箱和密码
   python -m scripts.create_admin
   python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
   ```

3. 在另一个终端进入 `frontend`，执行 `npm ci` 和 `npm run dev -- --host 127.0.0.1`，访问 `http://127.0.0.1:5173`。API 默认地址为 `http://localhost:8000`；可在 `frontend/.env.local` 中用 `VITE_API_URL` 指定其他地址，并让后端的 `BACKEND_CORS_ORIGINS` 包含前端实际来源。
4. 对旧版 `.ppt`，本机还需安装 LibreOffice Impress，并让 `soffice` 或 `libreoffice` 可从 `PATH` 调用。`.pptx` 不依赖 LibreOffice。

## Docker Compose 启动后端

准备 `backend/.env` 后，在项目根目录执行 `docker compose up -d --build`，容器自动应用迁移并安装 LibreOffice Impress。没有管理员时执行 `docker compose exec backend python -m scripts.create_admin`。后端绑定宿主机的 `127.0.0.1:8000`；远程开发可用 SSH 转发或按部署环境接入反向代理。内网离线服务器需要事先导入镜像和依赖。

## 首次使用

- 管理员先填写 OpenAI 兼容 API 的基础地址（通常以 `/v1` 结尾）、模型名和密钥，测试通过后保存。模型应能按要求返回 JSON；无需 Tool Calling。没有凭据的情况下无法执行真实审核。
- 在「评分建议」填写工程判断标准，按需配置报告策略。正式评分规则按案例类型以 JSON 配置。权重和等级由管理员提供；未配置适用规则时不显示分数。排除计分会同时移除该模块得分和权重。
- 上传知识库资料，按需创建员工账号。员工只能看到自己的审核历史。账户密码使用哈希保存，修改和重置密码后旧登录令牌失效。旧演示账号不应用于实际环境。
- 员工上传 PPT/PPTX，如需调整，先用「报告内容设置」识别并确认要求，再提交。报告页和历史只可查看当时的结果。

## 当前边界

审核提取逐页的文字和表格文本，并记录图片和图表所在页，但尚未识别图片、图表及扫描件的视觉内容。知识库提取文档文字，以关键词匹配给模型提供参考片段。模型提出的原文引用会按页核对；知识库资料不会被当作案例原文。

后台审核在 API 进程中运行。服务重启中断的审核不会自动续跑，超时后显示失败，可重新提交。建议部署时在反向代理设置上传大小限制（单文件上限 25 MB）并使用 HTTPS。

## 集成验证

对空的临时 PostgreSQL 库先执行 `alembic upgrade head`，然后在 `backend` 执行 `CASE_INTEGRATION_TEST=1 python -m unittest discover -s tests -v`。测试会创建测试账号并写入数据库，模型调用由本地替身提供。前端可通过 `npm run build` 检查 TypeScript 和构建。
