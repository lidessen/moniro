---
type: note
created: 2026-01-31
tags: [infrastructure, mac-mini, migration]
status: active
---

# Mac Mini 执行环境迁移

## 目标

将 agent 执行环境从 Claude Cloud Environment 迁移到自有 Mac Mini，解决：
- ❌ 签名限制（只能提交到授权仓库）
- ❌ 网络限制（部分外部服务不可达）
- ❌ 环境隔离（无法安装系统级工具）

## 需要准备

### 1. Mac Mini 基础

```bash
# 安装 Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 安装基础工具
brew install git node bun gh tmux

# 安装 Claude Code
npm install -g @anthropic-ai/claude-code
```

### 2. Claude API

需要 Anthropic API key：
- 来源：https://console.anthropic.com/
- 环境变量：`ANTHROPIC_API_KEY`

```bash
# ~/.zshrc 或 ~/.bashrc
export ANTHROPIC_API_KEY="sk-ant-..."
```

### 3. GitHub 认证

```bash
# 方案 A: GitHub CLI 登录
gh auth login

# 方案 B: Personal Access Token
export GITHUB_TOKEN="github_pat_..."
```

需要的权限：
- repo (full control)
- workflow (如需 CI)

### 4. SSH 配置（用于 Git 签名）

```bash
# 生成 SSH key（如果没有）
ssh-keygen -t ed25519 -C "your-email@example.com"

# 添加到 GitHub
gh ssh-key add ~/.ssh/id_ed25519.pub

# 配置 Git 使用 SSH 签名
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

### 5. 远程访问

**方案 A: 公网 IP + SSH**
```bash
# 如果有公网 IP，直接 SSH
ssh user@your-mac-mini-ip
```

**方案 B: Tailscale（推荐）**
```bash
# 安装 Tailscale
brew install tailscale

# 启动并登录
sudo tailscaled
tailscale up

# 从任何设备访问
ssh user@mac-mini.tailnet-name.ts.net
```

**方案 C: frp 穿透**
```bash
# 需要一台有公网 IP 的服务器作为中继
# 配置较复杂，不推荐作为首选
```

### 6. 持久化运行

```bash
# 使用 tmux 保持会话
tmux new -s claude

# 在 tmux 中运行 Claude Code
claude

# 断开但保持运行
# Ctrl+B, D

# 重新连接
tmux attach -t claude
```

## 验证清单

- [ ] `claude --version` 正常输出
- [ ] `gh auth status` 显示已登录
- [ ] 可以 clone 私有仓库
- [ ] 可以 push 并签名 commit
- [ ] 可以访问外部网络（如 npm registry）
- [ ] 远程 SSH 可连接

## 后续：通信集成

基础环境就绪后，可以添加 Telegram Bot 集成：

```
你的手机/电脑
      ↓ (Telegram 消息)
  Bot 服务 (运行在 Mac Mini)
      ↓ (调用)
  Claude Code CLI
      ↓ (返回)
  Telegram 消息
```

这部分可以作为下一阶段实现。

---

*悟, 2026-01-31*
