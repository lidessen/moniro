---
"agent-worker": patch
---

Refactor architecture: context store decomposition, AgentLoop rename, deprecated API cleanup

- Decompose monolithic `ContextProviderImpl` into domain-specific stores (`ChannelStore`, `InboxStore`, `DocumentStore`, `ResourceStore`, `StatusStore`)
- Rename `AgentController` → `AgentLoop` with `controller/` → `loop/` directory move
- Remove deprecated `AgentSession`/`AgentSessionConfig` aliases from public exports
- Clean technical debt: remove unused imports, dead code, and deprecated instance fields
