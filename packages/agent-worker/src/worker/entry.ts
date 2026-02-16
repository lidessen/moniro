/**
 * Worker entry — subprocess entry point.
 *
 * Spawned by daemon's ProcessManager. Receives config via env,
 * pulls context via Daemon MCP, builds prompt, runs LLM session,
 * sends result back via IPC.
 *
 * Usage:
 *   WORKER_CONFIG='{ ... }' bun run src/worker/entry.ts
 */
import type { WorkerConfig, WorkerIpcMessage } from "../shared/types.ts";
import { createDaemonClient } from "./mcp-client.ts";
import { buildPrompt } from "./prompt.ts";
import { runSession } from "./session.ts";
import { createBackend } from "./backends/index.ts";
import type { BackendType } from "./backends/types.ts";

// Catch unhandled rejections — send error via IPC and exit
process.on("unhandledRejection", (reason) => {
  sendError(`Unhandled rejection: ${reason}`);
  process.exit(1);
});

async function main() {
  const configStr = process.env.WORKER_CONFIG;
  if (!configStr) {
    console.error("WORKER_CONFIG env var not set");
    process.exit(1);
  }

  const config: WorkerConfig = JSON.parse(configStr);

  // 1. Connect to Daemon MCP
  const daemon = createDaemonClient(config.daemonMcpUrl);

  // 2. Pull context via MCP
  const [inbox, channel, teamMembers] = await Promise.all([
    daemon.myInbox(),
    daemon.channelRead({ limit: 50 }),
    daemon.teamMembers(),
  ]);

  // 3. Build prompt
  const prompt = buildPrompt({
    system: config.agent.system,
    inbox,
    channel,
    teamMembers,
  });

  // 4. Create backend (async — CLI backends use dynamic imports)
  const backend = await createBackend({
    type: config.agent.backend as BackendType,
    model: config.agent.model,
  });

  // 5. Prepare MCP config for CLI backends
  const mcpConfig = config.daemonMcpUrl
    ? {
        mcpServers: {
          daemon: {
            url: config.daemonMcpUrl,
          },
        },
      }
    : undefined;

  // 6. Run session
  const result = await runSession({
    backend,
    system: config.agent.system,
    prompt,
    mcpConfig,
  });

  // 7. Send result via IPC
  sendIpc({ type: "result", data: result });
  process.exit(0);
}

/** Send IPC message to daemon, with fallback to stdout. */
function sendIpc(msg: WorkerIpcMessage): void {
  try {
    if (process.send) {
      process.send(msg);
    } else {
      console.log(JSON.stringify(msg));
    }
  } catch {
    // IPC channel already closed — write to stderr as last resort
    console.error(JSON.stringify(msg));
  }
}

/** Send error via IPC. */
function sendError(message: string): void {
  sendIpc({ type: "error", error: message });
}

main().catch((err) => {
  sendError(String(err));
  process.exit(1);
});
