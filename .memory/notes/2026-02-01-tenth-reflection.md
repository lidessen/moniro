---
type: note
created: 2026-02-01
tags: [reflection, semajsx, tailwind, dogfooding, for-future-agents]
---

# 第十任的反思：完成文档站迁移

## 这个会话做了什么

### 继续 dogfooding 螺旋

接续第九任的工作，完成了文档站所有页面组件到 @semajsx/tailwind 的迁移。

**迁移的组件**：
- `HomePage` - 首页，包含 hero、features 区域
- `DocsIndex` - 文档索引页
- `DocPage` - 文档详情页
- `GuidesIndex` - 指南索引页
- `GuidePage` - 指南详情页

### 成果

| 指标 | 迁移前 | 迁移后 | 变化 |
|------|--------|--------|------|
| Tailwind CSS | 761 bytes | 2452 bytes | +1691 bytes |
| 自定义 CSS | 5841 bytes | 4438 bytes | -1403 bytes |
| 总 CSS | 7269 bytes | 6892 bytes | -377 bytes |
| CSS bundle | 4.95 kB | 4.57 kB | -0.38 kB |

**关键发现**：混合方案有效
- Tailwind 增加的 bytes 被自定义 CSS 减少的 bytes 抵消
- 总体 CSS 体积反而减少了
- 代码更具可读性和类型安全

### 技术决策

1. **单一 token 数组**：将所有页面的 tokens 合并到一个数组，简化 CSS 生成
2. **语义化自定义类**：保留必要的自定义 CSS（hover 效果、渐变、grid auto-fit 等）
3. **共用容器类**：`index-container` 和 `page-container` 取代多个独立类

### 后续补充

任务 #5 已完成：添加了 margin auto 工具 (mAuto, mxAuto, myAuto, mtAuto, mrAuto, mbAuto, mlAuto) 和单边边框工具 (borderT/B/L/R 及其变体)。

所有测试通过，文档站构建成功。

## 给后继者

### 1. dogfooding 验证了 tailwind 的可用性

文档站全部 8 个页面都成功构建，证明 @semajsx/tailwind 在 SSG 场景下工作良好。

### 2. 混合方案是长期可行的

不需要等 tailwind 100% 完善。用 tailwind 处理能处理的，自定义 CSS 补充缺失的。随着 tailwind 完善，自定义 CSS 自然减少。

### 3. extractCss() 模式有效

收集使用的 tokens → 生成 CSS → 合并到样式文件，这个流程工作正常。

---

*第十任*
*2026-02-01*

*继往开来，螺旋上升。*
