# Interface-Daemon-Worker 三层架构改造

**Date**: 2026-02-19
**Context**: agent-worker 的 interface-daemon-worker 三层架构存在两条并行路径，需要统一

## 完成的工作

### Step 1: 提取工厂原语

从 `runner.ts` 的 `runWorkflowWithControllers()` monolith 中提取出两个可组合的原语：

- **`createMinimalRuntime()`** — 创建共享基础设施（context provider + MCP server + event log）
- **`createWiredController()`** — 创建完整的 agent controller（backend + workspace + controller）

新文件 `workflow/factory.ts` 承载这些原语。`runner.ts` 被重构为调用 factory 而非内联创建。

### Step 2: AgentController 添加 sendDirect()

在 `controller.ts` 中添加 `sendDirect(message)` 方法：
- 绕过 poll loop，直接执行 agent（同步请求-响应模式）
- 写消息到 channel（保留历史）
- 使用和 poll loop 相同的 `runAgent()` 函数
- 逻辑锁防止 sendDirect 和 poll loop 竞争

这是 **standalone agent 走 controller 路径的桥梁**。

### Step 3: Daemon 统一执行路径

daemon.ts 改造为三级查找：
1. **Controller 路径**（首选）：从 workflows 中找 controller → sendDirect
2. **懒创建路径**：有 config 但无 controller → ensureAgentController 创建 → sendDirect
3. **Legacy 路径**（兜底）：workers map → handle.send/sendStream

POST /agents 仍然创建 LocalWorker（向后兼容），但 /run 和 /serve 优先用 controller。
DELETE /agents 同时清理 workflow 和 worker。
/mcp 复用 workflow 的 context provider。

## 设计决策

### 为什么选方案 A（sendDirect 模式）而非方案 B（channel tail 模式）？

方案 B 更"纯粹"——所有消息都通过 channel 路由。但它引入了不必要的间接层：
- 写 channel → 唤醒 controller → poll → run → 写 channel → tail 输出 → SSE
- 延迟高，SSE 映射复杂

方案 A 保持 request-response 场景的简单性：
- sendDirect → 直接 runAgent → 返回结果
- Controller 仍然支持 poll loop（用于 @mention 触发）

### 为什么保留 workers map？

测试文件 `daemon-api.test.ts` 大量使用 `testState.workers.set(...)` 模式。
完全移除 workers 需要重写所有测试的 setup 逻辑。
保留为 fallback 不影响新代码路径，且保持 782 个测试全部通过。

### 为什么懒创建而非 POST /agents 时创建？

`createMinimalRuntime()` 启动 MCP HTTP server（异步、占端口）。
在 POST /agents 时创建会导致：
- 未使用的 agent 也占资源
- 测试中产生真实 HTTP server

懒创建只在第一次 /run 或 /serve 时触发，更高效。

## 遗留问题

1. **SSE 流式输出退化**：sendDirect 返回完整结果（非 token 级流式）。CLI 端的 `/run` SSE 会一次性发送内容而非逐 token。需要后续添加 `sendDirectStream()`。

2. **Legacy workers 清理**：一旦测试迁移到 mock controller 模式，可以移除 workers map 和 LocalWorker。

3. **Backend 接口统一**：第 18 任提到的 Backend vs AgentBackend 统一仍未完成，但不阻塞当前架构改造。

4. **共享 workflow 的 MCP agent 列表**：当前每个 standalone agent 独立一个 workflow（`agent:name`）。如果多个 standalone agent 属于同一个 workflow:tag，它们不共享 context。需要后续实现 MCP server 的动态 agent 注册。

## 验证

- 782 tests pass, 0 fail
- Build clean (290.65 kB total)
- 未修改任何测试文件（向后兼容）

## 给后来者

三层架构的关键洞察：**controller 是 daemon 和 worker 之间的协调层**。
- Daemon 拥有生命周期（创建、销毁）
- Controller 拥有调度（何时运行、重试、轮询）
- Worker/Backend 拥有执行（LLM 对话、工具循环）

`factory.ts` 是这三层的连接点。Daemon 和 runner 都通过它创建 controller，保证一致性。

下一步最有价值的是消除 legacy workers 路径 —— 将测试迁移到 mock controller 模式，然后移除 LocalWorker 和 workers map。
