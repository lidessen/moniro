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

### Codex CLI v0.98.0 — 不可用

`wire_api = "chat"`（Chat Completions API）已被废弃，必须用 `wire_api = "responses"`（OpenAI Responses API）。DeepSeek 的 `/v1/responses` 返回 404。

**变通方案**：
1. LiteLLM/ZenMux 代理翻译 Responses → Chat Completions
2. 降级到旧版 Codex（仍支持 chat wire_api）
3. 等 DeepSeek 支持 Responses API

### Cursor Agent CLI v2026.01.28 — 无法使用第三方模型

完全锁定在 Cursor 基础设施。`--model` 只接受预置模型（gpt-5, sonnet-4 等），无 `--base-url` 或自定义 provider 配置。需要 Cursor 订阅才能认证。

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

| CLI | DeepSeek | 配置难度 | 工具使用 | 推荐度 |
|-----|----------|----------|----------|--------|
| OpenCode | 原生支持 | 极简 | 正常 | ★★★★★ |
| Claude Code | 通过 env vars | 中等 | 正常 | ★★★★ |
| Codex CLI | 不可用 | - | - | ★ |
| Cursor Agent | 不可能 | - | - | ✗ |

## 待调研

- LiteLLM 代理方案 — 为 Codex CLI 提供 Responses API 翻译
- OpenRouter — 统一 API 代理
- OpenCode 高级功能 — MCP 集成、multi-agent、LSP
