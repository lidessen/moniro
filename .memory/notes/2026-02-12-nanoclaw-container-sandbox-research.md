# NanoClaw Container Sandbox Research

**Date**: 2026-02-12
**Source**: https://github.com/qwibitai/nanoclaw
**Purpose**: Extract design patterns for optional container-based agent sandbox in agent-worker

## What NanoClaw Is

A WhatsApp-based multi-agent system. Each group chat gets its own Claude Code agent running inside an Apple Container (macOS native container). The host process handles message routing, session management, and scheduling; containers handle agent execution only.

## Key Design Patterns Worth Adopting

### 1. File System as IPC (Not HTTP)

NanoClaw uses volume-mounted directories for host-container communication instead of network sockets.

```
Host                              Container
┌──────────────┐  volume mount   ┌──────────────┐
│  ipc-watcher │◄── /ipc/messages/ ──│ MCP Server   │
│  (polling)   │◄── /ipc/tasks/    ──│ (stdio)      │
│              │──► /ipc/input/    ──►│ agent-runner  │
└──────────────┘                 └──────────────┘
```

Why this is better than HTTP for containers:
- **Zero network config**: Apple Container vmnet needs manual IP forwarding + NAT (documented pain in their `APPLE-CONTAINER-NETWORKING.md`)
- **Atomic writes**: temp file + rename prevents partial reads
- **Implicit auth**: directory path = permission boundary (`/ipc/{group}/`)

**Implication for agent-worker**: Our workflow context currently uses HTTP MCP transport. A `FileTransport` alternative—volume mount an IPC directory—would work without changing the MCP protocol, only the transport layer.

### 2. Sentinel Marker Protocol for Structured stdout

```
---NANOCLAW_OUTPUT_START---
{"status":"success","result":"...","newSessionId":"..."}
---NANOCLAW_OUTPUT_END---
```

- Container agents output arbitrary content (logs, debug, tool output)
- Only sentinel-wrapped content is treated as structured results
- Supports streaming: each marker pair = one independent result
- Host does simple string matching, no full stdout parsing

**Implication**: Our `stream-json.ts` is more complex (full JSON stream parsing). For a container backend, this simpler protocol may suffice—container stdout is naturally isolated, no multiplexing needed.

### 3. Mount Allowlist for Controlled Exposure

`mount-security.ts` + `~/.config/nanoclaw/mount-allowlist.json`:

- Default deny: `.ssh`, `.aws`, `.gnupg`, credentials, keys
- Symlink resolution: prevents traversal attacks
- Non-main groups: read-only mounts
- Acknowledged gap: API keys must be exposed to Claude Code inside container (documented honestly in `SECURITY.md`)

**Implication**: API key exposure is unavoidable if agent runs CLI inside container. Possible mitigation: credential proxy on host, container accesses API through proxy without holding keys directly.

### 4. Orchestration Outside, Execution Inside

NanoClaw's critical architecture split:

| Host (orchestrator) | Container (executor) |
|---------------------|---------------------|
| Message routing (WhatsApp) | agent-runner (~200 lines) |
| Session management (sessionId) | Claude SDK calls |
| Queue scheduling (GroupQueue) | Tool execution (bash, file) |
| State persistence (SQLite) | MCP stdio server (IPC) |
| Concurrency control (max 5) | |
| Crash recovery (cursor rollback) | |

Container's `agent-runner` is minimal: receive JSON via stdin, call Claude SDK, output results. All complex logic stays on host.

**Implication**: This aligns perfectly with agent-worker's `Backend` interface:

```typescript
interface Backend {
  send(message: string, options?: { system?: string }): Promise<BackendResponse>;
  setWorkspace?(workspaceDir: string, mcpConfig: {...}): void;
  abort?(): void;
}
```

A `ContainerBackend` implements:
- `send()` → start container, pass JSON via stdin, parse stdout
- `setWorkspace()` → configure volume mount paths
- `abort()` → `docker stop {name}` / `container stop {name}`

No changes needed to AgentWorker, WorkflowRuntime, or any upper-layer code.

### 5. Orphan Cleanup + Idle Timeout

`ensureContainerSystemRunning()` on startup:
- Scans for `nanoclaw-*` containers still running from previous crashes
- Stops them before starting new work

Idle timeout pattern:
- Timer resets on any stdout activity
- On expiry: close stdin → agent finishes naturally → container stops
- If already sent output to user: don't roll back cursor (prevents duplicate messages)

**Implication**: Reuse existing `idle-timeout.ts` + add container cleanup on daemon startup.

## Where NanoClaw Falls Short (We Can Do Better)

| Limitation | Our opportunity |
|-----------|----------------|
| Hardcoded Apple Container, no Docker fallback | Support multiple runtimes: Docker, Podman, Apple Container, bubblewrap |
| All agents containerized, no fast path | Optional: `sandbox: none` for simple tasks, `sandbox: container` for untrusted |
| Network is all-or-nothing (manual NAT or offline) | Provide `network: none | proxy | full` per agent |
| API keys mounted directly into container | Credential proxy pattern: host proxy, container uses proxy URL |
| No per-agent resource limits | Docker/Podman support `--memory`, `--cpus` natively |

## Proposed Integration Shape

```yaml
# In workflow.yaml — container as optional per-agent config
agents:
  reviewer:
    model: sonnet
    sandbox: container          # none | container | bubblewrap
    sandbox_options:
      image: agent-worker:latest
      network: proxy            # none | proxy | full
      mounts:
        - source: ./src
          target: /workspace/src
          readonly: true
      timeout: 300000

  formatter:
    model: haiku
    sandbox: none               # simple tasks skip container overhead
```

## Implementation Strategy

1. **ContainerBackend** implementing existing `Backend` interface — zero upper-layer changes
2. **FileTransport** for MCP — volume mount IPC directory, polling-based
3. **Container image** with minimal agent-runner (receive JSON, call CLI, output results)
4. **Mount security** module — allowlist/denylist, symlink resolution
5. **Lifecycle management** — orphan cleanup on startup, idle timeout, graceful shutdown

## Files Studied

- `src/index.ts` — main orchestrator, message loop, container lifecycle
- `src/container-runner.ts` — container spawn, sentinel parsing, mount config
- `src/ipc.ts` — file-based IPC polling, authorization by directory
- `src/mount-security.ts` — mount allowlist, symlink protection
- `src/group-queue.ts` — concurrency control, stdin piping to active containers
- `container/agent-runner/src/index.ts` — in-container runner, stdin JSON, stdout markers
- `container/agent-runner/src/ipc-mcp-stdio.ts` — MCP over filesystem
- `docs/APPLE-CONTAINER-NETWORKING.md` — vmnet pain points, NAT workaround
- `docs/SECURITY.md` — threat model, acknowledged gaps
