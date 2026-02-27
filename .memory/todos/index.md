# Todos

跨会话的任务追踪。

## 结构

```
todos/
├── index.md                    # 本文件
└── YYYY-MM-DD-kebab-slug.md    # 具体任务
```

## 活跃任务

| 优先级 | 任务 | 状态 | 链接 |
|--------|------|------|------|
| medium | 统一 logger：库代码零 console.*，通过 Logger 接口输出 | open | [ADR](../decisions/2026-02-27-unified-logger.md) |

## 使用场景

使用 `.memory/todos/` 当：
- 离线工作
- 未配置 GitHub/GitLab
- 快速个人任务
- 项目不使用 Issues

使用 GitHub/GitLab Issues 当：
- 需要跨设备同步
- 需要团队可见性
- 需要通知和指派功能
