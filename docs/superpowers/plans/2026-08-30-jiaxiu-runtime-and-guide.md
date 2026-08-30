# 浮玉客问答与运行体验改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复浮玉客的开放问答能力，并让项目在 Docker 和本地开发两种方式下稳定启动与使用。

**Architecture:** 后端将“是否有检索证据”与“是否调用模型”解耦；模型可处理安全的导览对话，引用只从服务端检索结果筛选。配置改为绝对路径定位，前端删除影像元数据文案并加强小屏布局；根目录脚本分别负责开发和 Compose 启动。

**Tech Stack:** Python 3.12、FastAPI、Pydantic Settings、httpx、pytest、React 19、TypeScript、Vitest、Vite、Docker Compose、POSIX shell。

**Spec:** `docs/superpowers/specs/2026-08-30-jiaxiu-runtime-and-guide-design.md`

## Global Constraints

- `.env` 必须由仓库根目录解析，不能依赖 uvicorn 的工作目录。
- API key 不得写入日志、测试快照或浏览器代码。
- 无证据的回答不得生成或呈现伪造文献引文。
- 影像页面不显示扫描页、印刷页、“影像 / 第 N 幅”或“高清影像”；缩略图保留 `01`、`02` 排序。
- 移动端支持 320px 至 760px 宽度，交互控件最小 44px。
- Docker 必须继续使用锁定依赖。

---

### Task 1: 后端配置与无证据导览

**Files:**
- Create: `apps/api/tests/test_config.py`
- Create: `apps/api/tests/test_agent_service.py`
- Modify: `apps/api/app/core/config.py`
- Modify: `apps/api/app/services/agent.py`
- Modify: `apps/api/pyproject.toml`

**Interfaces:**
- Produces: 绝对的 `Settings.model_config["env_file"]`；`AgentService.chat` 在无证据时仍调用已配置的 `ChatProvider`；模型失败时返回无引用本地导览。

- [ ] **Step 1: Write failing settings-path test**

```python
def test_settings_resolve_the_repository_env_file() -> None:
    assert Settings.model_config["env_file"] == Path(__file__).resolve().parents[3] / ".env"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run --project apps/api pytest apps/api/tests/test_config.py -q`

Expected: FAIL because `env_file` is the relative string `.env`.

- [ ] **Step 3: Write failing no-evidence guide tests**

```python
async def test_chat_uses_provider_for_greeting_without_evidence() -> None:
    provider = RecordingProvider(answer="你好，我是浮玉客。", evidence_ids=[])
    response = await service(provider).chat(ChatRequest(message="你好"))
    assert provider.calls == 1
    assert response.citations == []

async def test_chat_has_local_identity_fallback_without_evidence() -> None:
    response = await service(FailingProvider()).chat(ChatRequest(message="你是谁"))
    assert response.citations == []
    assert "浮玉客" in response.answer
```

- [ ] **Step 4: Run guide tests to verify they fail**

Run: `uv run --project apps/api pytest apps/api/tests/test_agent_service.py -q`

Expected: FAIL because current code bypasses the provider when `evidence` is empty.

- [ ] **Step 5: Implement the minimal behavior**

```python
REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
model_config = SettingsConfigDict(env_file=REPOSITORY_ROOT / ".env", ...)

if self._provider is None:
    return self._demo_response(evidence, season, intent, request.message)
raw_answer = await self._provider.complete(...)
selected = self._selected_evidence(provider_answer.evidence_ids, evidence)
```

Allow social/poetic answer text in the model instruction; only attach citations from `selected`. Add pytest dependencies if absent.

- [ ] **Step 6: Run focused backend tests to verify they pass**

Run: `uv run --project apps/api pytest apps/api/tests/test_config.py apps/api/tests/test_agent_service.py -q`

Expected: PASS.

### Task 2: OpenAI-compatible provider fallback

**Files:**
- Modify: `apps/api/tests/test_agent_service.py`
- Modify: `apps/api/app/services/agent.py`

**Interfaces:**
- Produces: `OpenAIChatProvider.complete` retries once without `response_format` after a 400, 404, or 422 compatibility rejection, then validates JSON server-side.

- [ ] **Step 1: Write the failing fallback test**

```python
async def test_provider_retries_without_response_format_after_rejection() -> None:
    provider = OpenAIChatProvider(..., client=RejectingThenAcceptingClient())
    answer = await provider.complete(system="test", evidence=[], message="你好", history=[])
    assert answer.answer == "你好"
    assert "response_format" in client.requests[0]
    assert "response_format" not in client.requests[1]
```

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run --project apps/api pytest apps/api/tests/test_agent_service.py::test_provider_retries_without_response_format_after_rejection -q`

Expected: FAIL because a 4xx currently becomes `ProviderUnavailableError`.

- [ ] **Step 3: Implement one compatibility retry**

```python
try:
    body = await self._post(structured_payload)
except httpx.HTTPStatusError as error:
    if error.response.status_code not in {400, 404, 422}:
        raise ProviderUnavailableError("provider unavailable") from None
    body = await self._post(compatibility_payload)
```

`compatibility_payload` is the same request without `response_format`; both paths retain current size and schema validation.

- [ ] **Step 4: Run provider and guide tests**

Run: `uv run --project apps/api pytest apps/api/tests/test_agent_service.py -q`

Expected: PASS.

### Task 3: 影像文案与移动端布局

**Files:**
- Create: `apps/web/src/features/facsimiles/FacsimileViewer.test.tsx`
- Modify: `apps/web/src/features/facsimiles/FacsimileViewer.tsx`
- Modify: `apps/web/src/app/styles/global.css`
- Modify: `apps/web/src/app/styles/guide.css`

**Interfaces:**
- Produces: 影像卡使用作品标题与“查看影像”；弹窗标题只显示作品标题；缩略图显示 `01`、`02`；窄屏控件可换行且无横向溢出。

- [ ] **Step 1: Write the failing render test**

```tsx
it("hides page and high-resolution labels while retaining thumbnail order", async () => {
  render(<FacsimileViewer items={items} workTitle="甲秀楼题咏" />)
  expect(screen.queryByText(/扫描页|印刷页|高清影像|影像 1/)).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "查看甲秀楼题咏" }))
  expect(screen.getByText("01")).toBeInTheDocument()
  expect(screen.getByText("02")).toBeInTheDocument()
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm --dir apps/web test --run src/features/facsimiles/FacsimileViewer.test.tsx`

Expected: FAIL because the existing component renders page labels and “查看高清影像”.

- [ ] **Step 3: Implement component and CSS behavior**

```tsx
<h3>{workTitle}</h3>
<button aria-label={`查看${workTitle}`} ...>查看影像</button>
<h2 id={titleId}>{workTitle}</h2>
```

Remove visible page metadata and page-based image titles/alt text. Preserve `String(index + 1).padStart(2, "0")`. In existing mobile media queries, constrain header text with `min-width: 0`, wrap controls, and give the guide panel viewport-safe max-height.

- [ ] **Step 4: Run frontend validation**

Run: `corepack pnpm --dir apps/web test --run src/features/facsimiles/FacsimileViewer.test.tsx && corepack pnpm --dir apps/web lint && corepack pnpm --dir apps/web build`

Expected: all commands exit 0.

### Task 4: 本地与 Docker 一键启动

**Files:**
- Create: `scripts/run-local.sh`
- Create: `scripts/run-docker.sh`
- Modify: `deploy/api.Dockerfile`
- Modify: `deploy/api-entrypoint.sh`
- Modify: `README.md`

**Interfaces:**
- Produces: `run-local.sh` 同时启动 `uvicorn app.main:app --reload --port 8000` 与 Vite；`run-docker.sh` 运行 `docker compose config` 后执行 `up --build`。

- [ ] **Step 1: Write shell existence/content checks**

```sh
test -x scripts/run-local.sh
test -x scripts/run-docker.sh
rg 'uvicorn app.main:app' scripts/run-local.sh
rg 'docker compose config' scripts/run-docker.sh
```

- [ ] **Step 2: Run them to verify they fail**

Run: `sh -c 'test -x scripts/run-local.sh'`

Expected: FAIL because the script does not exist.

- [ ] **Step 3: Create conservative scripts and validate image inputs**

```sh
#!/usr/bin/env sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
uv sync --project apps/api --frozen
corepack pnpm install --frozen-lockfile
(cd apps/api && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000) &
api_pid=$!
trap 'kill "$api_pid" "$web_pid" 2>/dev/null || true' INT TERM EXIT
corepack pnpm --dir apps/web dev --host 0.0.0.0
```

The Docker script runs `docker compose config` then `docker compose up --build`, never removes volumes. Confirm the API Dockerfile copies `uv.lock`, app source, required database, and executable entrypoint.

- [ ] **Step 4: Run shell and Compose verification**

Run: `sh -n scripts/run-local.sh scripts/run-docker.sh && docker compose config`

Expected: both commands exit 0.

### Task 5: Fresh final verification

**Files:** none unless a verification failure exposes a defect.

- [ ] **Step 1: Run backend suite**

Run: `uv run --project apps/api pytest apps/api/tests -q`

Expected: PASS.

- [ ] **Step 2: Run frontend suite, lint, and build**

Run: `corepack pnpm --dir apps/web test --run && corepack pnpm --dir apps/web lint && corepack pnpm --dir apps/web build`

Expected: all commands exit 0.

- [ ] **Step 3: Verify packaging and inspect small screens**

Run: `docker compose config`

Expected: exit 0. Inspect the facsimile view at 320px and 760px widths: no horizontal overflow; title, actions and thumbnail ordering remain operable.

- [ ] **Step 4: Review scoped changes**

Run: `git diff --check`

Expected: no whitespace errors.
