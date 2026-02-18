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
import { createDaemonTools } from "./daemon-tools.ts";
import { createLocalTools } from "./local-tools.ts";
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

  // 2. Pull context via MCP (returns wire format — flat objects, not nested)
  const [inbox, channel, teamMembers] = await Promise.all([
    daemon.myInbox() as Promise<unknown>,
    daemon.channelRead({ limit: 50 }) as Promise<unknown>,
    daemon.teamMembers(),
  ]);

  // 3. Build prompt
  const prompt = buildPrompt({
    system: config.agent.system,
    inbox: inbox as any[],
    channel: channel as any[],
    teamMembers,
  });

  // 4. Create backend (async — CLI backends use dynamic imports)
  const providerOptions = config.agent.provider
    ? { apiKey: config.agent.provider.apiKey, baseURL: config.agent.provider.baseUrl }
    : undefined;
  const backend = await createBackend({
    type: config.agent.backend as BackendType,
    model: config.agent.model,
    providerOptions,
  });

  // 5. Prepare tools and MCP config
  // SDK backend: daemon tools (collaboration) + local tools (bash/file)
  // CLI backends: pass MCP config (CLI handles tool calling internally)
  const tools = backend.type === "sdk"
    ? { ...createDaemonTools(daemon), ...createLocalTools() }
    : undefined;
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
    tools,
    mcpConfig,
  });

  // 7. Send result via IPC, then exit after flush
  await sendIpcAsync({ type: "result", data: result });
  process.exit(0);
}

/** Send IPC message to daemon, waiting for delivery. Fallback to stdout. */
function sendIpcAsync(msg: WorkerIpcMessage): Promise<void> {
  return new Promise((resolve) => {
    try {
      if (process.send) {
        // process.send() callback fires when message is serialized and handed to OS
        process.send(msg, undefined, undefined, (err) => {
          if (err) console.error(JSON.stringify(msg));
          resolve();
        });
      } else {
        console.log(JSON.stringify(msg));
        resolve();
      }
    } catch {
      // IPC channel already closed — write to stderr as last resort
      console.error(JSON.stringify(msg));
      resolve();
    }
  });
}

/** Synchronous send for error paths where we can't await. */
function sendIpc(msg: WorkerIpcMessage): void {
  try {
    if (process.send) {
      process.send(msg);
    } else {
      console.log(JSON.stringify(msg));
    }
  } catch {
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
