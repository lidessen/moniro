# CLI Agent 第三方模型调研

日期：2026-02-12
会话：setup-local-claude-cli

## 背景

调研主流 CLI agent 工具（Claude Code、Codex CLI、Cursor Agent CLI）使用第三方模型（DeepSeek）的可行性。npm 安装方式已废弃，Claude Code 改用独立安装脚本。

## 发现

### Claude Code v2.1.39 — 可用

DeepSeek 提供了 Anthropic 兼容端点 `https://api.deepseek.com/anthropic`，Claude Code 通过 `ANTHROPIC_BASE_URL` 环境变量即可指向。

**验证结果**：
- API 调用成功（debug 日志确认 `Stream started - received first chunk`）
- 工具使用正常：TodoWrite, Read, Bash, Glob, Skill 全部工作
- 每次 API 往返 ~3 秒
- `--print` 模式下，CLAUDE.md 指令会触发大量 agent 操作，导致简单提示需要 2-3 分钟才输出

**关键 env vars**：
- `ANTHROPIC_BASE_URL` → `https://api.deepseek.com/anthropic`
- `ANTHROPIC_AUTH_TOKEN` → DeepSeek API key
- `ANTHROPIC_API_KEY` → `""` （防止冲突）
- `ANTHROPIC_MODEL` → `deepseek-chat`
- `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` → `1`

**安装方式变更**：
- 旧：`npm i -g @anthropic-ai/claude-code`（已废弃）
- 新：`curl -fsSL https://claude.ai/install.sh | bash`（下载到 `~/.local/bin/claude`）
- 本项目：下载 standalone binary 到 `.local/bin/claude-bin`，用 wrapper 脚本配置

**已知限制**：DeepSeek 不支持 image inputs、MCP tools、web search。

### Codex CLI v0.98.0 — 需要代理

`wire_api = "chat"`（Chat Completions API）已被废弃，必须用 `wire_api = "responses"`（OpenAI Responses API）。DeepSeek 原生 `/v1/responses` 返回 404。

**可用方案**：
1. **ZenMux**（已确认可用）— 支持 Responses API 的代理。配置 `wire_api = "responses"` + ZenMux base_url。已知问题：`reasoning_effort` 参数在带 `openai/` 前缀的模型下不转发。
2. **Vercel AI Gateway** — 支持 OpenAI 兼容端点，可代理 100+ 模型。Responses API 支持未明确文档化。
3. **LiteLLM** — 确认支持 Responses API，可桥接 Anthropic Claude 和 Google Gemini。
4. **Azure OpenAI** — 确认支持 Responses API（含 Foundry Models: DeepSeek、Grok）。

**不可用方案**：
- DeepSeek 原生 API（不支持 Responses API）
- 降级旧版 Codex（`wire_api = "chat"` 已硬性废弃）

**Codex 配置示例**（ZenMux）：
```toml
[model_providers.zenmux]
name = "ZenMux"
base_url = "https://zenmux.ai/api/v1"
env_key = "ZENMUX_API_KEY"
wire_api = "responses"
```

### Cursor Agent CLI v2026.01.28 — 无法使用第三方模型

完全锁定在 Cursor 基础设施。`--model` 只接受预置模型（gpt-5, sonnet-4 等），无 `--base-url` 或自定义 provider 配置。

**认证方式**：
1. `agent login` — 浏览器交互式认证，token 存 OS keyring
2. `CURSOR_API_KEY` 环境变量 — key 从 https://cursor.com/dashboard?tab=background-agents 获取
3. `--api-key` 命令行参数

**要求**：需要 Cursor 付费订阅（Pro $20/月起）。Free 计划 API key 不支持 Background Agent API。

## 产出

- `.local/bin/claude-ds` — DeepSeek 后端 wrapper（含自动下载）
- `.local/bin/claude-local` — 通用 wrapper
- `.local/README.md` — 完整文档
- `.gitignore` 中排除了 213MB 的 binary

### OpenCode v1.1.59 — 最佳选择

Go 语言构建的开源终端 agent（`sst/opencode`），原生支持 75+ providers，包括 DeepSeek。

**验证结果**：
- `deepseek-chat` 和 `deepseek-reasoner` 均即开即用
- 纯文本回复 ~3 秒、工具使用（bash 命令）正常
- 配置极简：只需 `opencode.json` + `DEEPSEEK_API_KEY` 环境变量
- 支持 `opencode run` 非交互模式 + TUI 交互模式

**对比 Claude Code 的优势**：
- 原生多 provider，不需要 hack env vars
- Go 二进制启动快，无 Node.js 依赖
- 配置文件 JSON 格式，清晰直观
- 活跃社区（100k+ stars，GitHub 合作伙伴）

**配置示例**（`opencode.json`）：
```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "deepseek": {
      "options": { "apiKey": "{env:DEEPSEEK_API_KEY}" }
    }
  },
  "model": "deepseek/deepseek-chat"
}
```

**安装**：`npm i -g opencode-ai@latest` 或 `curl -fsSL https://opencode.ai/install | bash`

## 总结对比

| CLI | DeepSeek | 配置难度 | 工具使用 | E2E 方案 |
|-----|----------|----------|----------|----------|
| OpenCode | 原生支持 | 极简 | 正常 | `DEEPSEEK_API_KEY` → deepseek/deepseek-chat |
| Claude Code | 通过 env vars | 中等 | 正常 | `DEEPSEEK_API_KEY` → deepseek-chat |
| Codex CLI | 需代理 | 中等 | 正常 | `AI_GATEWAY_API_KEY` → Vercel AI Gateway → google/gemini-2.0-flash |
| Cursor Agent | 不可能 | - | - | `CURSOR_API_KEY`（付费）→ composer-1 |

## 安装方式验证（2026-02-12 官网确认）

| CLI | 推荐安装方式 | 备选 | 命令 | 版本 |
|-----|-------------|------|------|------|
| Claude Code | `curl -fsSL https://claude.ai/install.sh \| bash` | `brew install --cask claude-code` | `claude` | 2.1.38 |
| Codex CLI | `npm i -g @openai/codex` | `brew install --cask codex`、GitHub Release binary | `codex` | 0.98.0 |
| Cursor Agent | `curl -fsS https://cursor.com/install \| bash` | - | `agent` / `cursor agent` | 2026.01.28 |
| OpenCode | `curl -fsSL https://opencode.ai/install \| bash` | `npm i -g opencode-ai@latest`、`brew install anomalyco/tap/opencode` | `opencode` | 1.1.59 |

**注意**：
- Cursor CLI 命令已改为 `agent`（`cursor agent` 子命令仍然兼容）
- Claude Code npm 安装已废弃，`npm i -g @anthropic-ai/claude-code` 仍可用但不推荐
- Codex CLI 也提供了 GitHub Release 的 binary 下载

## E2E 测试方案

| Backend | 模型 | 认证 env var | 价格 | 状态 |
|---------|------|-------------|------|------|
| Claude Code | deepseek-chat | `DEEPSEEK_API_KEY` | $0.14/$0.28 per M | 可用（从 claude session 内运行会挂起） |
| OpenCode | deepseek/deepseek-chat | `DEEPSEEK_API_KEY` | $0.14/$0.28 per M | **已验证通过** |
| Codex CLI | google/gemini-2.0-flash | `AI_GATEWAY_API_KEY` | $0.10/$0.40 per M | 需要测试 |
| Cursor Agent | composer-1 | `CURSOR_API_KEY` | Cursor 订阅 | 需要测试 |

**Codex 代理选择**：Vercel AI Gateway（非 ZenMux）
- Responses API 首批官方合作伙伴
- 每月 $5 免费额度
- 0% 加价（BYOK）
- Gemini 2.0 Flash 价格接近 DeepSeek：$0.10/M input, $0.40/M output
- 支持 tool calling、structured outputs

**Cursor 模型选择**：composer-1（Cursor 自有模型）

**文件**：
- `packages/agent-worker/scripts/e2e-setup.sh` — CLI 安装和环境检查
- `packages/agent-worker/test/e2e/backends.test.ts` — 真实 API E2E 测试
- `bun run test:e2e` — 运行 E2E 测试
- `bun run e2e:setup` — 安装和检查环境

## 待调研

- OpenCode 高级功能 — MCP 集成、multi-agent、LSP
