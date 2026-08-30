# 浮玉四时：甲秀楼数字人文平台


## 项目简介

平台围绕甲秀楼的四季实景、题咏资料和公众协作展开，主要功能包括：

- 春雨、夏日暖阳、秋叶、冬雪等四季场景表现，以及 2D/3D 浏览切换。
- 甲秀楼题咏检索、作品详情、研究说明和引文导览。
- 协作者上传诗词资料与影像扫描，内容先保存为待审核状态。
- 管理员审核、发布或驳回投稿，并管理账号和审计记录。
- 无外部模型密钥时仍可使用确定性导览；配置兼容模型后可启用模型能力。

## 前后端架构

| 层级 | 技术与职责 |
| --- | --- |
| Web 前端 | React 19、TypeScript、Vite、Three.js、SparkJS；负责页面、季节视觉、3D 高斯泼溅展示、投稿与管理界面。 |
| Web 网关 | Nginx；提供静态文件和单页应用路由回退，并将同源 `/api/v1` 请求转发到 API。 |
| API 后端 | FastAPI、Pydantic；提供题咏、导览、登录、投稿、审核、用户管理与审计接口。 |
| 数据层 | SQLite；研究数据库随包只读提供，账号、会话、审核状态和上传记录写入独立持久化卷。 |
| 安全 | Argon2 密码散列、服务端会话、CSRF 校验、角色权限与首次登录强制改密。 |

生产拓扑为浏览器访问 Nginx，Nginx 再转发 API。API 容器不向宿主机暴露端口，外部只需开放 Web 端口。默认数据卷：

- `jiaxiu-app-data`：账号、会话、审核状态和审计数据库。
- `jiaxiu-submissions`：投稿者上传的私有扫描文件。

发布包目录中的关键文件：

```text
jiaxiu-mvp/
├─ apps/api/                  FastAPI 后端
├─ apps/web/                  React 前端与静态资源
├─ data/                      只读研究数据库与高清影像
│   ├─ facsimiles/             题咏影像扫描（只读挂载，共 39 张）
│   └─ submissions/            投稿文件私有目录（空，运行期写入数据卷）
├─ deploy/                    Dockerfile、Nginx 与启动脚本
├─ docker-compose.yml         生产编排
├─ .env.example               环境变量模板
└─ README.md                  本说明
```
面向甲秀楼题咏、四时场景与公众协作的数字人文平台。项目包含可检索的题咏资料、2D/3D 场景、影像查看、投稿审核和“浮玉客”导览问答。

## 快速上线
## 先选择运行方式

### 1. 环境要求
| 场景 | 需要安装 | 命令 | 访问地址 |
| --- | --- | --- | --- |
| Windows 本地开发 | Python 3.12、uv、Node.js、Corepack | `pnpm dev` | `http://127.0.0.1:5173` |
| macOS/Linux 本地开发 | Python 3.12、uv、Node.js、Corepack、POSIX shell | `sh scripts/run-local.sh` | `http://127.0.0.1:5173` |
| Docker 部署或本地验收 | Docker 24+、Docker Compose v2 | `sh scripts/run-docker.sh -d` | `http://127.0.0.1:8080` |

- 安装 Docker 24 或更新版本。
- 安装 Docker Compose v2，命令形式应为 `docker compose`。
- 建议生产域名已配置 HTTPS；TLS 可由宿主机反向代理、负载均衡器或云网关终止。

### 2. 配置环境变量

在解压后的 `jiaxiu-mvp` 目录执行：
运行前都应先创建并配置 `.env`：

```powershell
docker compose up -d --build
```dotenv
JIAXIU_MODEL_BASE_URL=https://模型服务地址/v1
JIAXIU_MODEL_API_KEY=请填写密钥
JIAXIU_MODEL_NAME=模型名称
```

不要执行 `docker compose down -v`，除非明确要删除全部账号、审核记录和投稿文件；该操作不可通过项目包恢复。
模型密钥仅保存在 `.env` 或密钥管理服务中。模型回答中的文献引用只来自当前检索到的数据库证据；无检索证据时会明确作为导览交流而非文献事实。

## 本地源码开发
## 功能概览

上线只需 Docker。需要修改源码时，建议使用 Python 3.12、uv 0.11.26、Node.js 24 和仓库锁定的 pnpm 版本：
- 四季场景：春雨、夏日、秋叶、冬雪，以及 2D/3D 浏览切换。
- 题咏资料：全文检索、作品详情、研究状态、来源与影像对读。
- 浮玉客：题咏导览、季节推荐与开放的诗意交流。
- 公众协作：提交诗词资料或影像，审核后再公开。
- 管理后台：审核投稿、管理用户与审计记录。

```powershell
$env:UV_PROJECT_ENVIRONMENT = Join-Path (Get-Location) ".venv"
uv sync --project apps/api --frozen
corepack pnpm install --frozen-lockfile
corepack pnpm build
```
## 架构与数据

生产前端构建时使用同源 API 前缀 `/api/v1`，无需在浏览器中暴露 API 容器地址。
| 层级 | 技术与职责 |
| --- | --- |
| 前端 | React 19、TypeScript、Vite、Three.js、SparkJS |
| API | FastAPI、Pydantic、SQLite |
| Web 网关 | Nginx；提供 SPA 回退并代理同源 `/api/v1` |
| 容器数据 | 研究数据库与影像只读；账号、投稿与审计信息保存在 Docker 持久卷 |

### 本地一键运行
Docker 仅向外暴露 Web 端口；Nginx 将 `/api/v1` 请求转发给 API。API 镜像使用锁定的 `apps/api/uv.lock` 安装依赖，运行时只包含 API 源码、研究数据库和入口脚本。

在项目根目录准备好 `.env` 后，Linux/macOS 或带 POSIX shell 的环境可执行：
## 首次登录与投稿

```sh
sh scripts/run-local.sh
```
Docker 首次启动会按 `.env` 创建以下账号：

脚本会先同步 Python 与前端依赖，再启动 API（默认 `http://127.0.0.1:8000`）和 Vite 前端（默认 `http://127.0.0.1:5173`）。API 会从项目根目录读取 `.env`，即使 uvicorn 的工作目录是 `apps/api` 也无需复制配置文件。可用 `JIAXIU_API_PORT` 和 `JIAXIU_WEB_DEV_PORT` 覆盖两个本地端口；按 `Ctrl+C` 会同时停止两个子进程。
| 账号 | 角色 |
| --- | --- |
| `admin` | 审核投稿、管理用户与查看审计记录 |
| `contributor` | 提交题咏资料与影像，查看自己的投稿 |

### Docker 一键运行
访问 `/login` 登录。首次登录后必须修改初始密码。投稿内容先进入待审核状态，只有管理员发布后才会进入公开展示。

```sh
sh scripts/run-docker.sh
```
## 常用开发命令

该脚本先执行 `docker compose config` 校验配置，再构建并以前台方式启动服务；如需后台运行，可附加 Compose 参数：
```powershell
# 前端测试、Lint、生产构建
pnpm test
pnpm run lint:web
pnpm run build

```sh
sh scripts/run-docker.sh -d
# 后端测试
uv run --project apps/api --extra dev -- python -m pytest apps/api/tests -q
```

Docker 仍是生产运行方式。API 镜像使用锁定的 `apps/api/uv.lock` 安装依赖，只复制 API 源码、研究数据库和入口脚本；`.env` 中的敏感项由 Docker Compose 注入，不写入镜像。

## 常见问题

- **Compose 提示必须设置密码：** `.env` 不存在、变量为空，或仍使用 `CHANGE_ME_*` 占位值。复制模板并设置真实强密码。
- **登录后立即跳回登录页：** 纯 HTTP 环境误用了安全 Cookie。仅本机测试可设置 `JIAXIU_SESSION_COOKIE_SECURE=false`；正式环境应启用 HTTPS。
- **浏览器出现 CORS 错误：** 检查 `JIAXIU_CORS_ALLOWED_ORIGINS` 是否为合法 JSON 数组，并与访问协议、域名和端口完全一致。
- **8080 端口被占用：** 修改 `.env` 中的 `JIAXIU_WEB_PORT` 后重新启动。
- **API 一直不健康：** 执行 `docker compose logs api --tail=200`，重点检查初始密码、数据卷权限和数据库文件。
- **刷新子页面返回 404：** 应通过包内 Nginx 访问，不要把 `apps/web` 目录直接交给缺少 SPA 回退的静态服务器。
- **修改初始密码变量后旧密码未变化：** 这是预期行为。环境变量只负责首次创建账号，不覆盖现有密码；请登录修改或由管理员重置。
- **页面未显示高清扫描：** 确认 `data/facsimiles` 目录已随包解压，且 API 容器的只读挂载已生效；检查 `docker compose logs api` 中的影像路径与文件大小提示。
| 问题 | 处理方式 |
| --- | --- |
| `uv` 或 `corepack` 未找到 | 安装对应工具后重开终端。 |
| Docker 提示初始密码无效 | 检查 `.env` 是否存在，且两个 `CHANGE_ME_*` 已替换。 |
| 本地登录后立即返回登录页 | 纯 HTTP 本地验证时设置 `JIAXIU_SESSION_COOKIE_SECURE=false`；生产环境保持 `true`。 |
| 浏览器出现 CORS 错误 | 确认 `JIAXIU_CORS_ALLOWED_ORIGINS` 为 JSON 数组，且与浏览器实际地址完全一致。 |
| Docker 端口被占用 | 修改 `.env` 中的 `JIAXIU_WEB_PORT`。 |
| API 健康检查失败 | 执行 `docker compose logs api --tail=200`，检查密码、数据卷权限与数据库路径。 |
| 刷新子页面返回 404 | 通过 Docker/Nginx 访问，或使用 Vite 开发服务器，不要用无 SPA 回退的静态服务器。 |

## 上线安全提示
## 生产注意事项

- 正式开放前配置 HTTPS、防火墙、定期备份和主机安全更新。
- `.env` 权限仅授予部署管理员，不要将模型密钥或账号密码写入镜像和版本库。
- 定期检查管理员审计记录、失败登录和异常上传；公开部署应增加外围限流和恶意文件扫描。
- 先在预发布环境恢复一次备份，确认备份文件实际可用。
- 生产部署应使用 HTTPS、防火墙、主机更新和定期备份。
- `.env` 只授予部署管理员访问，不要把密码或模型密钥写入镜像、前端代码或版本库。
- 备份 Docker 卷前暂停写入，并在预发布环境完成至少一次恢复演练。
