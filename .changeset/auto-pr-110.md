---
"@moniro/agent": minor
"@moniro/workflow": minor
"agent-worker": minor
---

feat: Priority Queue + Cooperative Preemption - Three-lane priority queue (immediate > normal > background) replaces FIFO inbox processing. Agents yield between LLM steps when higher-priority instructions arrive, preserving progress for seamless resume. AgentHandle.send()/sendMessage() convenience methods for typed instruction routing. Scheduled wakeups enqueue directly as background priority.
