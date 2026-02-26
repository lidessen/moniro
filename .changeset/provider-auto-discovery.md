---
"agent-worker": minor
---

Add provider auto-discovery and model fallback chains

- Auto-detect available AI providers by scanning environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.)
- Support `AGENT_DEFAULT_MODELS` env var with comma-separated fallback chain (e.g. `deepseek-chat, anthropic/claude-sonnet-4-5`)
- Fall back to direct provider SDK when `AI_GATEWAY_API_KEY` is unavailable, fixing CI environments with only provider-specific keys
- Lazy-load and cache provider SDKs for reuse
