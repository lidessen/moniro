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
import { createMockBackend } from "./backends/mock.ts";
import type { Backend } from "./backends/types.ts";

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

  // TODO: team_doc_read when documents are implemented

  // 3. Build prompt
  const prompt = buildPrompt({
    system: config.agent.system,
    inbox,
    channel,
    teamMembers,
  });

  // 4. Create backend
  const backend = createBackend(config);

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
  const msg: WorkerIpcMessage = { type: "result", data: result };
  if (process.send) {
    process.send(msg);
  } else {
    // Fallback: write to stdout for non-fork scenarios
    console.log(JSON.stringify(msg));
  }

  process.exit(0);
}

function createBackend(config: WorkerConfig): Backend {
  switch (config.agent.backend) {
    case "mock":
      return createMockBackend();
    // TODO: sdk, claude, codex, cursor backends
    default:
      return createMockBackend({ response: `[${config.agent.backend} backend not yet implemented]` });
  }
}

main().catch((err) => {
  const msg: WorkerIpcMessage = { type: "error", error: String(err) };
  if (process.send) {
    process.send(msg);
  } else {
    console.error(JSON.stringify(msg));
  }
  process.exit(1);
});
