import { Command, Option } from "commander";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { getDefaultModel, normalizeRuntimeType } from "@moniro/agent-loop";
import {
  createAgent,
  listAgents,
  deleteAgent,
  shutdown,
  health,
  run,
  serve,
  isDaemonActive,
} from "@/cli/client.ts";
import { isDaemonRunning, DEFAULT_PORT } from "@/daemon/index.ts";
import { outputJson } from "@/cli/output.ts";

// ── Helpers ────────────────────────────────────────────────────────

/** Start a detached daemon child process. */
function spawnDaemonProcess(port?: number, host?: string): void {
  const scriptPath = process.argv[1] ?? "";
  const args = [scriptPath, "up", "-f"];
  if (port) args.push("--port", String(port));
  if (host) args.push("--host", host);

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

/**
 * Ensure daemon is running. If not, start a detached child and wait for readiness.
 *
 * The detached child runs `agent-worker up -f` so the daemon itself stays in the
 * child process foreground while the parent CLI command returns immediately.
 */
export async function ensureDaemon(port?: number, host?: string): Promise<void> {
  if (isDaemonRunning()) return;

  spawnDaemonProcess(port, host);

  // Wait for daemon to be ready (daemon.json appears)
  const maxWait = 5000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    if (isDaemonRunning()) return;
    await new Promise((r) => setTimeout(r, 100));
  }

  console.error("Failed to start daemon");
  process.exit(1);
}

// ── Commands ───────────────────────────────────────────────────────

export function registerAgentCommands(program: Command) {
  // ── up ──────────────────────────────────────────────────────────
  program
    .command("up")
    .description("Start daemon, load config.yml agents")
    .option("-f, --foreground", "Run in foreground (for debugging)")
    .option("--port <port>", `HTTP port (default: ${DEFAULT_PORT})`)
    .option("--host <host>", "Host to bind to (default: 127.0.0.1)")
    .addHelpText(
      "after",
      `
Examples:
  $ agent-worker up              # Start daemon in background
  $ agent-worker up -f           # Start daemon in foreground
  $ agent-worker up --port 5100  # Custom port
      `,
    )
    .action(async (options) => {
      if (options.foreground) {
        // Foreground mode — run daemon directly
        const { startDaemon } = await import("@/daemon/daemon.ts");
        await startDaemon({
          port: options.port ? parseInt(options.port, 10) : undefined,
          host: options.host,
        });
      } else {
        // Background mode — detach a child daemon and wait for readiness
        if (isDaemonRunning()) {
          console.log("Daemon already running");
          return;
        }
        await ensureDaemon(options.port ? parseInt(options.port, 10) : undefined, options.host);
        console.log("Daemon started");
      }
    });

  // ── down ────────────────────────────────────────────────────────
  program
    .command("down")
    .description("Stop daemon (all agents and workspaces)")
    .action(async () => {
      if (!isDaemonActive()) {
        console.log("No daemon running");
        return;
      }

      const res = await shutdown();
      if (res.success) {
        console.log("Daemon stopped");
      } else {
        console.error("Error:", res.error);
        process.exit(1);
      }
    });

  // ── new ────────────────────────────────────────────────────────
  program
    .command("new <name>")
    .description("Create a new ephemeral agent")
    .option("-m, --model <model>", `Model identifier (default: ${getDefaultModel()})`)
    .addOption(
      new Option("-b, --runtime <type>", "Runtime type")
        .choices(["default", "sdk", "claude", "codex", "cursor", "opencode", "mock"])
        .default("default"),
    )
    .option("--provider <name>", "Provider SDK name (e.g., anthropic, openai)")
    .option("--base-url <url>", "Override provider base URL")
    .option("--api-key <ref>", "API key env var (e.g., $MINIMAX_API_KEY)")
    .option("-s, --system <prompt>", "System prompt", "You are a helpful assistant.")
    .option("-f, --system-file <file>", "Read system prompt from file")
    .option("--wakeup <interval|cron>", "Periodic wakeup schedule (e.g., 30s, 5m, 0 9 * * 1-5)")
    .option("--wakeup-prompt <text>", "Custom prompt for wakeup events")
    .option("--port <port>", `Daemon port if starting new daemon (default: ${DEFAULT_PORT})`)
    .option("--host <host>", "Daemon host (default: 127.0.0.1)")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Examples:
  $ agent-worker new alice -m anthropic/claude-sonnet-4-5
  $ agent-worker new bot -b mock
  $ agent-worker new monitor --wakeup 30s --system "Check status"
  $ agent-worker new coder -m MiniMax-M2.5 --provider anthropic --base-url https://api.minimax.io/anthropic/v1 --api-key '$MINIMAX_API_KEY'
      `,
    )
    .action(async (name, options) => {
      let system = options.system;
      if (options.systemFile) {
        system = readFileSync(options.systemFile, "utf-8");
      }

      const runtime = normalizeRuntimeType(options.runtime ?? "default");
      const model = options.model || getDefaultModel();

      // Build provider config from CLI options
      let provider: string | { name: string; base_url?: string; api_key?: string } | undefined;
      if (options.provider) {
        if (options.baseUrl || options.apiKey) {
          provider = {
            name: options.provider,
            base_url: options.baseUrl,
            api_key: options.apiKey,
          };
        } else {
          provider = options.provider;
        }
      }

      // Build schedule config from CLI options
      if (options.wakeupPrompt && !options.wakeup) {
        console.error("Error: --wakeup-prompt can only be used with --wakeup.");
        process.exit(1);
      }
      let schedule: { wakeup: string; prompt?: string } | undefined;
      if (options.wakeup) {
        schedule = { wakeup: options.wakeup };
        if (options.wakeupPrompt) {
          schedule.prompt = options.wakeupPrompt;
        }
      }

      // Ensure daemon is running
      await ensureDaemon(options.port ? parseInt(options.port, 10) : undefined, options.host);

      // Create agent via daemon API (always global, always ephemeral)
      const res = await createAgent({
        name,
        model,
        system,
        runtime,
        provider,
        schedule,
        ephemeral: true,
      });

      if (res.error) {
        console.error("Error:", res.error);
        process.exit(1);
      }

      if (options.json) {
        outputJson(res);
      } else {
        console.log(`${name} (${model})`);
      }
    });

  // ── rm ──────────────────────────────────────────────────────────
  program
    .command("rm <name>")
    .description("Remove an ephemeral agent")
    .addHelpText(
      "after",
      `
Removes an ephemeral agent created with 'new'.
Config agents (defined in config.yml) cannot be removed — edit config.yml instead.

Examples:
  $ agent-worker rm alice
      `,
    )
    .action(async (name) => {
      if (!isDaemonActive()) {
        console.error("No daemon running");
        process.exit(1);
      }

      // Check if agent is a config agent (non-ephemeral)
      const info = await health();
      const configAgents = ((info as Record<string, unknown>).configAgents ?? []) as string[];
      if (configAgents.includes(name)) {
        console.error(`Error: "${name}" is defined in config.yml — edit config to remove`);
        process.exit(1);
      }

      const res = await deleteAgent(name);
      if (res.success) {
        console.log(`Removed: ${name}`);
      } else {
        console.error("Error:", res.error);
        process.exit(1);
      }
    });

  // ── ls ─────────────────────────────────────────────────────────
  program
    .command("ls")
    .description("List running agents")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Examples:
  $ agent-worker ls
  $ agent-worker ls --json
      `,
    )
    .action(async (options) => {
      if (!isDaemonActive()) {
        if (options.json) {
          outputJson({ agents: [] });
        } else {
          console.log("No daemon running");
        }
        return;
      }

      const res = await listAgents();
      if (res.error) {
        console.error("Error:", res.error);
        process.exit(1);
      }

      const agents = (res.agents ?? []) as Array<{
        name: string;
        model: string;
        runtime: string;
        workflow: string;
        tag: string;
        createdAt: string;
        source?: string;
        state?: string;
      }>;

      if (options.json) {
        outputJson({ agents });
        return;
      }

      if (agents.length === 0) {
        console.log("No agents");
        return;
      }

      for (const a of agents) {
        const wf = a.workflow ? (a.tag ? `@${a.workflow}:${a.tag}` : `@${a.workflow}`) : "";
        const info = a.model || a.state || "";
        console.log(`${a.name.padEnd(12)} ${info.padEnd(30)} ${wf}`);
      }
    });

  // ── stop ───────────────────────────────────────────────────────
  program
    .command("stop [name]")
    .description("Stop agent or workspace")
    .addHelpText(
      "after",
      `
Examples:
  $ agent-worker stop alice           # Stop specific agent
  $ agent-worker stop @review:pr-123  # Stop workspace
  $ agent-worker stop @review         # Stop workspace (no tag)
      `,
    )
    .action(async (name) => {
      if (!isDaemonActive()) {
        console.error("No daemon running");
        process.exit(1);
      }

      if (!name) {
        console.error("Specify agent name or @workspace[:tag]. Use 'down' to stop daemon.");
        process.exit(1);
      }

      // Parse target to determine if it's a workspace or agent
      const { parseTarget } = await import("@/cli/target.ts");
      const target = parseTarget(name);

      let res: Awaited<ReturnType<typeof deleteAgent>>;
      if (target.agent === undefined) {
        const { stopWorkflow: stopWf } = await import("@/cli/client.ts");
        res = await stopWf(target.workspace, target.tag);
      } else {
        res = await deleteAgent(target.agent);
      }

      if (res.success) {
        console.log(`Stopped: ${target.display}`);
      } else {
        console.error("Error:", res.error);
        process.exit(1);
      }
    });

  // ── status ─────────────────────────────────────────────────────
  program
    .command("status")
    .description("Show daemon status")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      if (!isDaemonActive()) {
        if (options.json) {
          outputJson({ running: false });
        } else {
          console.log("Daemon not running");
        }
        return;
      }

      const res = await health();
      if (options.json) {
        outputJson(res);
      } else {
        console.log(`Daemon: pid=${res.pid} port=${res.port}`);

        const agents = (res.agents ?? []) as string[];
        console.log(`Agents: ${agents.length > 0 ? agents.join(", ") : "(none)"}`);

        const workflows = (res.workflows ?? []) as Array<{
          name: string;
          tag: string;
          agents: string[];
        }>;
        if (workflows.length > 0) {
          console.log(`Workspaces:`);
          for (const wf of workflows) {
            const display = wf.tag ? `@${wf.name}:${wf.tag}` : `@${wf.name}`;
            console.log(`  ${display} → ${wf.agents.join(", ")}`);
          }
        }

        if (res.uptime) {
          const secs = Math.round((res.uptime as number) / 1000);
          console.log(`Uptime: ${secs}s`);
        }
      }
    });

  // ── ask ────────────────────────────────────────────────────────
  program
    .command("ask <agent> <message>")
    .description("Send message to agent and get response")
    .option("--no-stream", "Sync response (no streaming)")
    .option("--json", "Output response as JSON")
    .addHelpText(
      "after",
      `
Examples:
  $ agent-worker ask alice "analyze this code"
  $ agent-worker ask alice "hello" --no-stream
  $ agent-worker ask alice "hello" --json
      `,
    )
    .action(async (agent, message, options) => {
      if (!isDaemonActive()) {
        console.error("No daemon running");
        process.exit(1);
      }

      if (options.stream === false) {
        // Sync mode (replaces old `serve` command)
        const res = await serve({ agent, message });
        if (options.json) {
          outputJson(res);
        } else if (res.error) {
          console.error("Error:", res.error);
          process.exit(1);
        } else {
          console.log((res as { content?: string }).content ?? JSON.stringify(res));
        }
      } else {
        // Streaming mode (default)
        const res = await run({ agent, message }, (chunk) => {
          if (!options.json) {
            process.stdout.write(chunk.text);
          }
        });

        if (options.json) {
          outputJson(res);
        } else {
          console.log();
        }
      }
    });

  // ── onboard ────────────────────────────────────────────────────
  program
    .command("onboard")
    .description("Interactive config.yml setup")
    .addHelpText(
      "after",
      `
Creates or updates ~/.agent-worker/config.yml interactively.
Guides you through defining agents and channel bridges.

Examples:
  $ agent-worker onboard
      `,
    )
    .action(async () => {
      const { existsSync: exists } = await import("node:fs");
      const { join } = await import("node:path");
      const { homedir } = await import("node:os");
      const configDir = join(homedir(), ".agent-worker");
      const configPath = join(configDir, "config.yml");

      if (exists(configPath)) {
        console.log(`Config already exists: ${configPath}`);
        console.log("Edit it directly to add/remove agents and channels.");
        return;
      }

      // Create minimal config.yml template
      const { mkdirSync, writeFileSync } = await import("node:fs");
      mkdirSync(configDir, { recursive: true });

      const template = `# agent-worker config
# Agents defined here are loaded when the daemon starts (agent-worker up).
# Edit this file to add/remove agents. Changes take effect on next 'up'.

agents:
  # Example agent:
  # assistant:
  #   model: anthropic/claude-sonnet-4-5
  #   system: You are a helpful assistant.

# channels:
#   telegram:
#     type: telegram
#     token: \${{ env.TELEGRAM_BOT_TOKEN }}
`;

      writeFileSync(configPath, template);
      console.log(`Created: ${configPath}`);
      console.log("Edit this file to define your agents, then run: agent-worker up");
    });
}
