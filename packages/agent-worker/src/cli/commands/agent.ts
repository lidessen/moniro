import { Command, Option } from "commander";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { getDefaultModel } from "@/agent/models.ts";
import { normalizeBackendType } from "@/backends/model-maps.ts";
import {
  createAgent,
  listAgents,
  deleteAgent,
  shutdown,
  health,
  run,
  serve,
  isDaemonActive,
} from "../client.ts";
import { isDaemonRunning, DEFAULT_PORT } from "@/daemon/index.ts";
import { outputJson } from "../output.ts";

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Ensure daemon is running. If not, spawn it in background and wait.
 */
export async function ensureDaemon(port?: number, host?: string): Promise<void> {
  if (isDaemonRunning()) return;

  // Spawn daemon process
  const scriptPath = process.argv[1] ?? "";
  const args = [scriptPath, "daemon"];
  if (port) args.push("--port", String(port));
  if (host) args.push("--host", host);

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

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
  // ── daemon ─────────────────────────────────────────────────────
  // Start daemon in foreground (mainly for development/debugging)
  program
    .command("daemon")
    .description("Start daemon in foreground")
    .option("--port <port>", `HTTP port (default: ${DEFAULT_PORT})`)
    .option("--host <host>", "Host to bind to (default: 127.0.0.1)")
    .action(async (options) => {
      const { startDaemon } = await import("@/daemon/daemon.ts");
      await startDaemon({
        port: options.port ? parseInt(options.port, 10) : undefined,
        host: options.host,
      });
    });

  // ── new ────────────────────────────────────────────────────────
  program
    .command("new <name>")
    .description("Create a new agent")
    .option("-m, --model <model>", `Model identifier (default: ${getDefaultModel()})`)
    .addOption(
      new Option("-b, --backend <type>", "Backend type")
        .choices(["default", "sdk", "claude", "codex", "cursor", "mock"])
        .default("default"),
    )
    .option("-s, --system <prompt>", "System prompt", "You are a helpful assistant.")
    .option("-f, --system-file <file>", "Read system prompt from file")
    .option("--workflow <name>", "Workflow name (default: global)")
    .option("--tag <tag>", "Workflow instance tag (default: main)")
    .option("--port <port>", `Daemon port if starting new daemon (default: ${DEFAULT_PORT})`)
    .option("--host <host>", "Daemon host (default: 127.0.0.1)")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Examples:
  $ agent-worker new alice -m anthropic/claude-sonnet-4-5
  $ agent-worker new bot -b mock
  $ agent-worker new reviewer --workflow review --tag pr-123
      `,
    )
    .action(async (name, options) => {
      let system = options.system;
      if (options.systemFile) {
        system = readFileSync(options.systemFile, "utf-8");
      }

      const backend = normalizeBackendType(options.backend ?? "default");
      const model = options.model || getDefaultModel();

      // Ensure daemon is running
      await ensureDaemon(options.port ? parseInt(options.port, 10) : undefined, options.host);

      // Create agent via daemon API
      const res = await createAgent({
        name,
        model,
        system,
        backend,
        workflow: options.workflow,
        tag: options.tag,
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

  // ── ls ─────────────────────────────────────────────────────────
  program
    .command("ls")
    .description("List agents")
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
        backend: string;
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
        const wf = a.tag === "main" ? `@${a.workflow}` : `@${a.workflow}:${a.tag}`;
        const info = a.model || a.state || "";
        console.log(`${a.name.padEnd(12)} ${info.padEnd(30)} ${wf}`);
      }
    });

  // ── stop ───────────────────────────────────────────────────────
  program
    .command("stop [name]")
    .description("Stop agent, workflow, or daemon")
    .option("--all", "Stop daemon (all agents and workflows)")
    .addHelpText(
      "after",
      `
Examples:
  $ agent-worker stop alice           # Stop specific agent
  $ agent-worker stop @review:pr-123  # Stop workflow
  $ agent-worker stop @review         # Stop workflow (tag defaults to main)
  $ agent-worker stop --all           # Stop daemon (everything)
      `,
    )
    .action(async (name, options) => {
      if (!isDaemonActive()) {
        console.error("No daemon running");
        process.exit(1);
      }

      if (options.all) {
        const res = await shutdown();
        if (res.success) {
          console.log("Daemon stopped");
        } else {
          console.error("Error:", res.error);
        }
        return;
      }

      if (!name) {
        console.error("Specify agent name, @workflow[:tag], or use --all");
        process.exit(1);
      }

      // Parse target to determine if it's a workflow or agent
      const { parseTarget } = await import("../target.ts");
      const target = parseTarget(name);

      if (target.agent === undefined) {
        // Workflow-level target: @workflow or @workflow:tag
        const { stopWorkflow: stopWf } = await import("../client.ts");
        const res = await stopWf(target.workflow, target.tag);
        if (res.success) {
          console.log(`Stopped: ${target.display}`);
        } else {
          console.error("Error:", res.error);
          process.exit(1);
        }
      } else {
        // Agent-level target
        const res = await deleteAgent(target.agent);
        if (res.success) {
          console.log(`Stopped: ${target.display}`);
        } else {
          console.error("Error:", res.error);
          process.exit(1);
        }
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
          console.log(`Workflows:`);
          for (const wf of workflows) {
            const display = wf.tag === "main" ? `@${wf.name}` : `@${wf.name}:${wf.tag}`;
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
    .description("Send message to agent (SSE streaming)")
    .option("--json", "Output final response as JSON")
    .addHelpText(
      "after",
      `
Examples:
  $ agent-worker ask alice "analyze this code"
  $ agent-worker ask alice "hello" --json
      `,
    )
    .action(async (agent, message, options) => {
      if (!isDaemonActive()) {
        console.error("No daemon running");
        process.exit(1);
      }

      const res = await run({ agent, message }, (chunk) => {
        if (!options.json) {
          process.stdout.write(chunk.text);
        }
      });

      if (options.json) {
        outputJson(res);
      } else {
        // Newline after streaming output
        console.log();
      }
    });

  // ── serve ──────────────────────────────────────────────────────
  program
    .command("serve <agent> <message>")
    .description("Send message to agent (sync response)")
    .option("--json", "Output as JSON")
    .action(async (agent, message, options) => {
      if (!isDaemonActive()) {
        console.error("No daemon running");
        process.exit(1);
      }

      const res = await serve({ agent, message });
      if (options.json) {
        outputJson(res);
      } else if (res.error) {
        console.error("Error:", res.error);
        process.exit(1);
      } else {
        console.log((res as { content?: string }).content ?? JSON.stringify(res));
      }
    });
}
