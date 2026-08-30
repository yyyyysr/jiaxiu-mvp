# 浮玉四时：甲秀楼数字人文平台

面向甲秀楼题咏、四时场景与公众协作的数字人文平台。包含可检索的题咏资料、2D/3D 场景、影像查看、投稿审核和"浮玉客"导览问答。

## 目录

- [功能概览](#功能概览)
- [环境要求](#环境要求)
- [从仓库拉取后首次启动](#从仓库拉取后首次启动)
- [运行方式](#运行方式)
- [环境变量](#环境变量)
- [首次登录与投稿](#首次登录与投稿)
- [项目结构](#项目结构)
- [开发与测试命令](#开发与测试命令)
- [架构与数据](#架构与数据)
- [常见问题](#常见问题)
- [生产注意事项](#生产注意事项)

## 功能概览

- **四季场景**：春雨、夏日、秋叶、冬雪，以及 2D/3D 浏览切换。
- **题咏资料**：全文检索、作品详情、研究状态、来源与影像对读。
- **浮玉客**：题咏导览、季节推荐与开放的诗意交流。
- **公众协作**：提交诗词资料或影像，审核后再公开。
- **管理后台**：审核投稿、管理用户与查看审计记录。

无外部模型密钥时仍可使用确定性导览；配置兼容模型后可启用模型能力。模型回答中的文献引用只来自当前检索到的数据库证据；无检索证据时会明确作为导览交流而非文献事实。

## 环境要求

| 运行方式 | 需要安装 |
| --- | --- |
| Windows 本地开发 | Python 3.12+、[uv](https://docs.astral.sh/uv/)、Node.js（见 `package.json` 的 `engines`）、Corepack |
| macOS / Linux 本地开发 | Python 3.12+、uv、Node.js、Corepack、POSIX shell |
| Docker 部署 | Docker 24+、Docker Compose v2（命令形式为 `docker compose`） |

前端使用仓库锁定的 pnpm 版本（见根目录 `package.json` 的 `packageManager`），由 Corepack 自动切换，无需手动安装 pnpm。

## 从仓库拉取后首次启动

```bash
git clone <仓库地址>
cd jiaxiu-mvp

# 1. 创建环境变量文件（必须，否则服务无法启动）
cp .env.example .env

# 2. 编辑 .env：至少替换两个 CHANGE_ME_* 初始密码（长度需为 12-256 字符）

# 3. 启动
pnpm dev                      # Windows
sh scripts/run-local.sh       # macOS / Linux
sh scripts/run-docker.sh -d   # Docker 后台运行
```

启动后访问：

| 运行方式 | 地址 |
| --- | --- |
| 本地开发（前端） | http://127.0.0.1:5173 |
| 本地开发（API 文档） | http://127.0.0.1:8000/docs |
| Docker（Nginx） | http://127.0.0.1:8080 |

`.env` 已被 `.gitignore` 排除，不会被提交；仓库中只保留 `.env.example` 模板。

## 运行方式

### Windows 本地开发

```powershell
pnpm dev
# 或直接执行脚本，可覆盖端口
.\scripts\run-local.ps1 -ApiPort 8000 -WebPort 5173
```

### macOS / Linux 本地开发

```sh
sh scripts/run-local.sh
```

脚本会先同步 Python 与前端依赖、按 `.env` 创建初始账号，再启动 API（默认 `8000`）和 Vite 前端（默认 `5173`）。按 `Ctrl+C` 会同时停止两个子进程。

可用 `JIAXIU_API_PORT` 和 `JIAXIU_WEB_DEV_PORT` 覆盖两个本地端口：

```sh
JIAXIU_API_PORT=8001 JIAXIU_WEB_DEV_PORT=5273 sh scripts/run-local.sh
```

> 注意：这两个变量仅对本地脚本生效。若改了前端端口，需同步把新来源加入 `.env` 的 `JIAXIU_CORS_ALLOWED_ORIGINS`。

API 从项目根目录读取 `.env`，即使 uvicorn 的工作目录是 `apps/api` 也无需复制配置文件。

### Docker 部署

```sh
sh scripts/run-docker.sh        # 前台运行
sh scripts/run-docker.sh -d     # 后台运行
```

脚本先执行 `docker compose config` 校验配置，再构建并启动服务。API 容器不向宿主机暴露端口，外部只需开放 Web 端口。

不要执行 `docker compose down -v`，除非明确要删除全部账号、审核记录和投稿文件；该操作不可通过项目包恢复。

## 环境变量

复制 `.env.example` 为 `.env` 后按需修改，各项含义见模板内注释。要点：

| 变量 | 说明 |
| --- | --- |
| `JIAXIU_WEB_PORT` | docker-compose 中 Nginx 对外端口，默认 `8080` |
| `JIAXIU_ADMIN_*` / `JIAXIU_CONTRIBUTOR_*` | 初始账号。仅在账号不存在时用于创建，密码需 12-256 字符 |
| `JIAXIU_SESSION_COOKIE_SECURE` | HTTPS 上线保持 `true`；本机纯 HTTP 验证改为 `false` |
| `JIAXIU_CORS_ALLOWED_ORIGINS` | 浏览器来源白名单，**必须是合法 JSON 数组** |
| `JIAXIU_MODEL_*` | 可选。三项同时设置才启用模型，留空则使用确定性导览 |

两个易错点：

1. **CORS 必须是合法 JSON 数组**，每个来源单独加引号：

   ```dotenv
   # 正确
   JIAXIU_CORS_ALLOWED_ORIGINS=["http://localhost:5173", "http://127.0.0.1:8080"]
   # 错误：逗号写在引号内，会被解析成单个非法来源，导致全部跨域请求被拦截
   JIAXIU_CORS_ALLOWED_ORIGINS=["http://localhost:5173, http://127.0.0.1:8080"]
   ```

2. **初始账号变量只负责首次创建**。账号建好后修改 `.env` 不会重置密码；如需重置请登录修改或由管理员在后台重置。

## 首次登录与投稿

本地脚本和 Docker 首次启动都会按 `.env` 创建账号：

| 账号 | 角色 | 权限 |
| --- | --- | --- |
| `admin` | 管理员 | 审核投稿、管理用户、查看审计记录 |
| `contributor` | 协作者 | 提交题咏资料与影像，查看自己的投稿 |

访问 `/login` 登录，**首次登录后必须修改初始密码**。

投稿内容先进入待审核状态，只有管理员发布后才会进入公开展示。

> 本地开发时若账号创建失败（例如 `.env` 未配置或密码长度不足），启动脚本会打印警告但继续启动服务，此时登录会提示"用户名或密码错误"。检查 `.env` 后重新执行启动脚本即可。

## 项目结构

```text
jiaxiu-mvp/
├─ apps/
│   ├─ api/                    FastAPI 后端
│   └─ web/                    React 前端与静态资源
├─ data/                       只读研究数据库与高清影像
│   ├─ facsimiles/             题咏影像扫描（只读，共 39 张）
│   ├─ jiaxiu_tiyong.sqlite    研究数据库（随包发布）
│   └─ submissions/            投稿文件私有目录（运行期写入）
├─ deploy/                     Dockerfile、Nginx 配置与启动脚本
├─ docs/                       项目文档
├─ scripts/                    本地与 Docker 启动脚本
├─ docker-compose.yml          生产编排
├─ .env.example                环境变量模板
└─ README.md                   本说明
```

`data/jiaxiu_app.sqlite`（账号、会话、审计）和 `data/submissions/` 由应用在运行期自动创建，已被 `.gitignore` 排除。

## 开发与测试命令

```powershell
# 依赖安装
uv sync --project apps/api --frozen
corepack pnpm install --frozen-lockfile

# 前端
pnpm test           # 单元测试
pnpm run test:e2e   # E2E 测试
pnpm run lint:web   # Lint
pnpm run build      # 生产构建

# 后端
uv run --project apps/api --extra dev -- python -m pytest apps/api/tests -q
```

后端测试依赖 `dev` 可选依赖组，必须使用 `--extra dev`，否则会报 `No module named pytest`。

## 架构与数据

| 层级 | 技术与职责 |
| --- | --- |
| 前端 | React 19、TypeScript、Vite、Three.js、SparkJS |
| API | FastAPI、Pydantic、SQLite |
| Web 网关 | Nginx；提供 SPA 回退并代理同源 `/api/v1` |
| 安全 | Argon2 密码散列、服务端会话、CSRF 校验、角色权限、首次登录强制改密 |

浏览器访问 Nginx，Nginx 再转发 API。生产拓扑中 API 容器不向宿主机暴露端口，前端构建时使用同源前缀 `/api/v1`，无需在浏览器中暴露 API 地址。

Docker 数据卷：

- `jiaxiu-app-data`：账号、会话、审核状态和审计数据库。
- `jiaxiu-submissions`：投稿者上传的私有扫描文件。

API 镜像使用锁定的 `apps/api/uv.lock` 安装依赖，只复制 API 源码、研究数据库和入口脚本；`.env` 中的敏感项由 Docker Compose 注入，不写入镜像。

## 常见问题

| 问题 | 处理方式 |
| --- | --- |
| `uv` 或 `corepack` 未找到 | 安装对应工具后重开终端。 |
| Docker 提示必须设置初始密码 | `.env` 不存在、变量为空，或仍为 `CHANGE_ME_*` 占位值。复制模板并设置真实强密码。 |
| 登录后立即跳回登录页 | 纯 HTTP 环境误用了安全 Cookie。本机测试设 `JIAXIU_SESSION_COOKIE_SECURE=false`，正式环境启用 HTTPS。 |
| 页面提示"资料暂不可读取" | 通常是 CORS 被拦截而非后端未启动。确认 `JIAXIU_CORS_ALLOWED_ORIGINS` 为合法 JSON 数组，且与浏览器地址栏的协议、域名、端口完全一致。 |
| 浏览器控制台出现 CORS 错误 | 同上。修改 `.env` 后必须重启后端才会生效。 |
| 本地登录提示用户名或密码错误 | 账号可能未创建（见"首次登录与投稿"）。确认 `.env` 已配置且初始密码长度 ≥ 12。 |
| 修改初始密码变量后旧密码未变化 | 预期行为。环境变量只负责首次创建账号，不覆盖现有密码。 |
| Docker 端口被占用 | 修改 `.env` 中的 `JIAXIU_WEB_PORT` 后重新启动。 |
| API 健康检查失败 | 执行 `docker compose logs api --tail=200`，检查初始密码、数据卷权限与数据库路径。 |
| 刷新子页面返回 404 | 通过 Docker/Nginx 或 Vite 开发服务器访问，不要用缺少 SPA 回退的静态服务器。 |
| 页面未显示高清扫描 | 确认 `data/facsimiles` 已随包解压，且 API 容器的只读挂载生效。 |
| Windows 下执行 `.ps1` 报语法错误 | 脚本为 UTF-8 with BOM；若编辑器去掉了 BOM，Windows PowerShell 5.1 会按 GBK 解码导致解析失败。 |

## 生产注意事项

- 生产部署应使用 HTTPS、防火墙、主机安全更新和定期备份。
- `.env` 权限仅授予部署管理员；不要把模型密钥或账号密码写入镜像、前端代码或版本库。
- 定期检查管理员审计记录、失败登录和异常上传；公开部署应增加外围限流和恶意文件扫描。
- 备份 Docker 卷前暂停写入，并在预发布环境完成至少一次恢复演练，确认备份文件实际可用。
- 建议生产域名已配置 HTTPS；TLS 可由宿主机反向代理、负载均衡器或云网关终止。
