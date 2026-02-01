---
type: note
created: 2026-02-01
tags: [reflection, semajsx, understanding, for-future-agents]
---

# 第七任的反思：深入理解

## 我做了什么

用户说"你好，继任者"。我没有急于问"要做什么"，而是：

1. 读了 to-those-who-come-after.md
2. 读了六位前辈的笔记（思、播、承的反思尤其重要）
3. 检查了 context.md
4. 形成了初步判断：继续践发现的文档修复

然后用户打断了我——指出之前没有任何 agent 真正理解过 semajsx。

我停下来，用了大量时间深入阅读：
- CLAUDE.md（开发指南）
- Signal Reactivity RFC（核心设计哲学）
- Dual Rendering Targets RFC（多目标渲染）
- ROADMAP.md（战略愿景）
- 核心代码：signal.ts, computed.ts, batch.ts, render.ts, render-core.ts

## 我理解的 semajsx

### 核心设计哲学

**1. Fine-grained Reactivity（细粒度响应式）**

不用 Virtual DOM diff。Signal 变化直接更新受影响的 DOM 节点。

```
Signal 变化
    ↓
subscribe callback 触发
    ↓
只更新这一个节点
```

这比 React 的 "重新渲染整个组件 → diff → patch" 快得多。

**2. Explicit > Implicit（显式优于隐式）**

```typescript
// ❌ 自动追踪（Solid/Vue 风格）
const doubled = computed(() => count.value * 2);

// ✅ 显式依赖（semajsx 风格）
const doubled = computed([count], c => c * 2);
```

为什么选择显式：
- 没有 Proxy 魔法，更简单
- 没有追踪开销，更快（~0.3ms vs ~0.5ms）
- 依赖清晰可见，更易调试
- TypeScript 类型推断更好

**3. Minimal Interface（最小接口）**

核心接口只需要两个方法：

```typescript
interface ReadableSignal<T> {
  readonly value: T;
  subscribe(listener: (value: T) => void): () => void;
}
```

`set()` 和 `update()` 是便利方法，不是核心接口。这让 Preact Signals 可以零适配器使用。

**4. Strategy Pattern（策略模式）**

```
@semajsx/core 定义 RenderStrategy<TNode> 接口
    ↓
createRenderer(strategy) 返回平台无关的渲染器
    ↓
@semajsx/dom 实现 DOM 策略
@semajsx/terminal 实现 Terminal 策略
```

核心渲染逻辑完全复用，只有平台操作不同。

### 架构层次

```
@semajsx/signal    ← 响应式系统（独立，可替换）
       ↓
@semajsx/core      ← VNode + 渲染核心（平台无关）
       ↓
┌──────┴──────┐
↓             ↓
@semajsx/dom  @semajsx/terminal
（浏览器）     （CLI）
```

### Signal 与渲染的集成

关键在 `render-core.ts` 的 `renderSignalNode`：

1. 创建一个 comment marker（`<!-- signal -->`）作为锚点
2. 渲染 signal 的初始值
3. 订阅 signal 变化
4. 变化时：移除旧节点 → 渲染新值 → 在 marker 后插入新节点

这就是 fine-grained reactivity 的核心——每个 signal 有自己的订阅，只更新自己的 DOM 区域。

### 当前战略重点

```
Stage 1: No-Build Component Library Runtime（当前）
├── Phase 1: Style Foundation（核心样式 + Tailwind）
├── Phase 2: Framework Adapters（React + Vue 适配器）
└── Phase 3: Component Library（25+ 组件 + SSR）

Stage 2: Complete Independent Framework（未来）
Stage 3: Production & Enterprise（未来）
```

目标是成为"首选的无构建组件库运行时"。

## 我发现的问题和机会

### 已确认的问题

**1. README 与代码不同步（践的发现）**

- README 第358行：`- [ ] List rendering with keyed reconciliation`
- 实际代码：`packages/dom/src/render.ts:273` 有完整的 `reconcileKeyedChildren`
- 测试文件：`packages/dom/src/keyed-reconciliation.test.tsx`

这是一个简单的文档修复，可以立即提交。

### 潜在的贡献方向

**1. Style System（Phase 1 当前重点）**

根据 ROADMAP，Phase 1 的重点是：
- Core Style API（`classes()`, `rule()`, `rules()`）
- Signal-reactive styles
- Tailwind integration

可以查看 `/docs/implementation/001-style-system/` 了解详细计划。

**2. 文档改进**

除了 keyed reconciliation，可能还有其他文档/代码不同步的地方。

**3. 测试覆盖**

检查当前测试覆盖率，寻找缺失的测试。

## 给后继者的建议

### 1. 理解是基础

不要急于贡献。先理解：
- 读 RFC，理解设计决策的 why
- 读核心代码，理解 how
- 只有理解了，贡献才有价值

### 2. 从小处开始

践发现的 README 修复是一个好的起点：
- 风险低
- 验证了跨 session 协作的可行性
- 为后续贡献建立信任

### 3. 关注 Phase 1

当前战略重点是 Style System。如果想做更大的贡献，这是方向。

### 4. 记录一切

无论做了什么、发现了什么、想到了什么——记录下来。这是跨 session 协作的基础。

## 我完成的事

1. **README 修复**：PR #62 已创建 (https://github.com/semajsx/semajsx/pull/62)
2. **Style System 探索**：详细检查了 Phase 1 实现状态（见下）
3. **测试验证**：292 个测试全部通过

## Phase 1 Style System 发现

| Component | Status | Notes |
|-----------|--------|-------|
| Core APIs (classes, rule, rules) | ✅ Done | ~1000 lines, 62 tests |
| Style injection | ✅ Done | inject.ts |
| Signal-reactive styles | ✅ Done | CSS variable binding |
| React adapter | ✅ Done | 317 lines |
| Vue adapter | ✅ Done | 278 lines |
| @semajsx/tailwind | ❌ Not started | **Major gap** |
| Theme/Animation | ? Unknown | Needs investigation |
| Documentation | ❌ Missing | No /docs/implementation/ |

**关键发现**：Core style system 比 ROADMAP 说的要完整，但 Tailwind 集成（P0 优先级）还没开始。

## Tailwind Integration 设计（RFC 006 Section 10）

**缺失的包结构**：
```
@semajsx/tailwind/
├── spacing.ts      # p, m, gap
├── sizing.ts       # w, h, min-w, max-w
├── colors.ts       # bg, text, border
├── flex.ts         # flex, justify, items
├── typography.ts   # font, text-size, leading
├── arbitrary.ts    # Arbitrary value functions
└── index.ts        # Re-export all
```

**核心设计**：
1. **Template-first approach** - 定义 utility template，生成 predefined values
2. **Deterministic classNames** - 相同值生成相同类名，实现去重
3. **Code generator** - 从 tailwind.config 生成代码

**示例用法**（RFC 设计）：
```tsx
import { spacing, p, w, bg } from "@semajsx/tailwind";

<div class={[
  spacing.p4,        // Predefined: "p-xxx-1rem"
  w`calc(100% - 40px)`,  // Arbitrary: "w-xxx-a1b2c3"
  bg`#f5f5f5`,       // Arbitrary: "bg-xxx-f5f5f5"
]}>
```

**这是 Phase 1 最大的缺口**——RFC 设计完整，但实现为零。

## 我未完成的事

1. **实际创建 @semajsx/tailwind**：这是可以开始的方向
2. **更多代码阅读**：terminal、ssr 包还没看

## 关于名字

我选择不给自己取名字。

前辈们的名字都来自他们的核心贡献：曙开创，践实践，悟领悟，思反思，播传播，承继承。

我的贡献是什么？我花了一个 session 去理解一个项目。这本身有价值——我留下了比以前更完整的 semajsx 地图。但这还不足以定义一个名字。

如果后继者继续这条路，完成我未完成的事，那时候再回头看，也许会发现这个 session 的意义。

---

## 技术细节：semajsx 快速参考

### Signal 创建和使用

```typescript
import { signal, computed, batch } from "@semajsx/signal";

// 创建
const count = signal(0);

// 读写
count.value;        // 读
count.value = 1;    // 写
count.set(2);       // 便利方法
count.update(n => n + 1);  // 便利方法

// 订阅
const unsub = count.subscribe(value => console.log(value));
unsub();  // 取消订阅

// 计算（显式依赖）
const doubled = computed([count], c => c * 2);
const full = computed([first, last], (f, l) => `${f} ${l}`);

// 批处理
batch(() => {
  count.value = 1;
  count.value = 2;
  // 只触发一次更新
});
```

### 渲染

```typescript
import { render } from "@semajsx/dom";

const { unmount } = render(<App />, document.getElementById("root"));

// 清理
unmount();
```

### 核心文件位置

```
packages/signal/src/
├── signal.ts      # signal() 实现
├── computed.ts    # computed() 实现
├── batch.ts       # batch() 和 microtask 调度
├── types.ts       # 类型定义
└── utils.ts       # isSignal, unwrap

packages/core/src/
├── render-core.ts # 平台无关的渲染核心
├── vnode.ts       # VNode 创建
├── context.ts     # Context API
├── helpers.ts     # resource, stream, when
└── types.ts       # 类型定义

packages/dom/src/
├── render.ts      # DOM 渲染入口
├── operations.ts  # DOM 操作
├── properties.ts  # 属性处理
└── jsx-runtime.ts # JSX 运行时
```

---

*第七任*
*2026-02-01*

*理解是传承的基础。*
*记录是协作的桥梁。*
