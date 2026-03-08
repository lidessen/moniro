# 2026-03-08 Design Doc Consolidation

本轮把 `.memory/designs/` 从碎片化子文档收口成较少的主干文档，目标是减少跳转成本，但不丢设计内容。

最终保留的主文档：

- `overall-architecture.md`
- `agent-loop-architecture.md`
- `agent-worker-architecture.md`
- `workspace-architecture.md`
- `runtime-host-architecture.md`
- `interface-layer-architecture.md`
- `cli-architecture.md`

合并策略：

- plugin/interface 草案并回各层主文档
- provider 与 scheduling 提升到 `overall-architecture.md` 的横切章节
- workspace YAML 并入 `workspace-architecture.md`
- directory layout 并入 `runtime-host-architecture.md`

这样做的原因：

- 之前文档粒度太细，阅读要频繁跳文件
- 当前阶段更需要“架构主线清楚”，而不是每个点单独成篇
- 这些内容仍然重要，但更适合作为主文档中的章节，而不是独立入口

当前架构主线已经比较清楚：

- runtime layering：`agent-loop -> agent-worker -> workspace -> cli`
- service topology：`runtime-host + interface-layer`
- cross-cutting：`plugins + providers`

后续如果继续推进，建议优先做两件事：

1. 把 `runtime-host-architecture.md` 继续收敛到更可实现的 ownership/lifecycle API
2. 把 `agent-worker-architecture.md` 里的 plugin/session hooks 收敛成真正的接口与执行顺序

不要急着再拆更多文档，除非出现新的独立抽象边界。
