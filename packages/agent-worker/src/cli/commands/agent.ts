import { Command, Option } from "commander";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
import { AgentRegistry } from "@/agent/agent-registry.ts";
import type { AgentDefinition } from "@/agent/definition.ts";

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
        .choices(["default", "sdk", "claude", "codex", "cursor", "opencode", "mock"])
        .default("default"),
    )
    .option("--provider <name>", "Provider SDK name (e.g., anthropic, openai)")
    .option("--base-url <url>", "Override provider base URL")
    .option("--api-key <ref>", "API key env var (e.g., $MINIMAX_API_KEY)")
    .option("-s, --system <prompt>", "System prompt", "You are a helpful assistant.")
    .option("-f, --system-file <file>", "Read system prompt from file")
    .option("--workflow <name>", "Workflow name (default: global)")
    .option("--tag <tag>", "Workflow instance tag (default: main)")
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
  $ agent-worker new reviewer --workflow review --tag pr-123
  $ agent-worker new monitor --wakeup 30s --system "Check status"
  $ agent-worker new coder -m MiniMax-M2.5 --provider anthropic --base-url https://api.minimax.io/anthropic/v1 --api-key '$MINIMAX_API_KEY'
      `,
    )
    .action(async (name, options) => {
      let system = options.system;
      if (options.systemFile) {
        system = readFileSync(options.systemFile, "utf-8");
      }

      const backend = normalizeBackendType(options.backend ?? "default");
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

      // Create agent via daemon API
      const res = await createAgent({
        name,
        model,
        system,
        backend,
        provider,
        workflow: options.workflow,
        tag: options.tag,
        schedule,
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
        const wf = a.workflow ? (a.tag === "main" ? `@${a.workflow}` : `@${a.workflow}:${a.tag}`) : "";
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

      let res: Awaited<ReturnType<typeof deleteAgent>>;
      if (target.agent === undefined) {
        const { stopWorkflow: stopWf } = await import("../client.ts");
        res = await stopWf(target.workflow, target.tag);
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

  // ── agent (subcommand group) ────────────────────────────────
  // File-based agent management (.agents/*.yaml)

  const agentCmd = program
    .command("agent")
    .description("Manage persistent agent definitions (.agents/*.yaml)");

  // ── agent create ────────────────────────────────────────────
  agentCmd
    .command("create <name>")
    .description("Create a persistent agent definition")
    .option("-m, --model <model>", `Model (default: ${getDefaultModel()})`)
    .addOption(
      new Option("-b, --backend <type>", "Backend type")
        .choices(["sdk", "claude", "codex", "cursor", "opencode", "mock"])
        .default(undefined),
    )
    .option("-s, --system <prompt>", "System prompt")
    .option("-f, --system-file <file>", "Read system prompt from file")
    .option("--role <role>", "Soul: agent role")
    .option("--expertise <items>", "Soul: expertise (comma-separated)")
    .option("--style <style>", "Soul: communication style")
    .option("--dir <path>", "Project directory", ".")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Creates .agents/<name>.yaml and context directory (.agents/<name>/).

Examples:
  $ agent-worker agent create alice -m anthropic/claude-sonnet-4-5 -s "You are a code reviewer."
  $ agent-worker agent create bob --role developer --expertise "typescript,testing"
  $ agent-worker agent create coder -f ./prompts/coder.md
      `,
    )
    .action(async (name, options) => {
      const projectDir = resolve(options.dir);
      const registry = new AgentRegistry(projectDir);

      let system = options.system ?? "You are a helpful assistant.";
      if (options.systemFile) {
        system = readFileSync(options.systemFile, "utf-8");
      }

      const def: AgentDefinition = {
        name,
        model: options.model || getDefaultModel(),
        prompt: { system },
      };

      if (options.backend) def.backend = options.backend;

      // Build soul from CLI flags
      if (options.role || options.expertise || options.style) {
        def.soul = {};
        if (options.role) def.soul.role = options.role;
        if (options.expertise) def.soul.expertise = options.expertise.split(",").map((s: string) => s.trim());
        if (options.style) def.soul.style = options.style;
      }

      try {
        const handle = registry.create(def);
        if (options.json) {
          outputJson({ name, model: def.model, contextDir: handle.contextDir });
        } else {
          console.log(`Created: .agents/${name}.yaml`);
          console.log(`Context: ${handle.contextDir}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}`);
        process.exit(1);
      }
    });

  // ── agent list ──────────────────────────────────────────────
  agentCmd
    .command("list")
    .description("List persistent agent definitions")
    .option("--dir <path>", "Project directory", ".")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const projectDir = resolve(options.dir);
      const registry = new AgentRegistry(projectDir);
      registry.loadFromDisk();

      const agents = registry.list();

      if (options.json) {
        outputJson({
          agents: agents.map((h) => ({
            name: h.name,
            model: h.definition.model,
            backend: h.definition.backend,
            soul: h.definition.soul,
            contextDir: h.contextDir,
          })),
        });
        return;
      }

      if (agents.length === 0) {
        console.log("No agent definitions found in .agents/");
        return;
      }

      for (const h of agents) {
        const soul = h.definition.soul?.role ? ` (${h.definition.soul.role})` : "";
        console.log(`${h.name.padEnd(16)} ${h.definition.model}${soul}`);
      }
    });

  // ── agent info ──────────────────────────────────────────────
  agentCmd
    .command("info <name>")
    .description("Show agent definition details")
    .option("--dir <path>", "Project directory", ".")
    .option("--json", "Output as JSON")
    .action(async (name, options) => {
      const projectDir = resolve(options.dir);
      const registry = new AgentRegistry(projectDir);
      registry.loadFromDisk();

      const handle = registry.get(name);
      if (!handle) {
        console.error(`Agent not found: ${name}`);
        process.exit(1);
      }

      const def = handle.definition;
      if (options.json) {
        outputJson({ ...def, contextDir: handle.contextDir });
        return;
      }

      console.log(`Name:    ${def.name}`);
      console.log(`Model:   ${def.model}`);
      if (def.backend) console.log(`Backend: ${def.backend}`);
      if (def.prompt.system) {
        const preview = def.prompt.system.length > 80
          ? def.prompt.system.slice(0, 77) + "..."
          : def.prompt.system;
        console.log(`Prompt:  ${preview}`);
      }
      if (def.soul) {
        if (def.soul.role) console.log(`Role:    ${def.soul.role}`);
        if (def.soul.expertise) console.log(`Expert:  ${def.soul.expertise.join(", ")}`);
        if (def.soul.style) console.log(`Style:   ${def.soul.style}`);
        if (def.soul.principles) {
          console.log(`Principles:`);
          for (const p of def.soul.principles) {
            console.log(`  - ${p}`);
          }
        }
      }
      console.log(`Context: ${handle.contextDir}`);
    });

  // ── agent delete ────────────────────────────────────────────
  agentCmd
    .command("delete <name>")
    .description("Delete agent definition and context")
    .option("--dir <path>", "Project directory", ".")
    .action(async (name, options) => {
      const projectDir = resolve(options.dir);
      const registry = new AgentRegistry(projectDir);
      registry.loadFromDisk();

      if (!registry.has(name)) {
        console.error(`Agent not found: ${name}`);
        process.exit(1);
      }

      registry.delete(name);
      console.log(`Deleted: ${name}`);
    });
}
