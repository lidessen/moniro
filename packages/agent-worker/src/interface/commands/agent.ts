/**
 * Agent commands: daemon, new, ls, stop, status, ask, serve
 */
import type { Command } from "commander";
import { readFileSync } from "node:fs";
import {
  createAgent,
  listAgents,
  deleteAgent,
  shutdown,
  health,
  isDaemonActive,
} from "../client.ts";
import { ensureDaemon, findDaemon } from "../discovery.ts";
import { parseTarget } from "../target.ts";
import { stopWorkflow } from "../client.ts";
import { outputJson } from "../output.ts";

export function registerAgentCommands(program: Command) {
  // ── daemon ─────────────────────────────────────────────────────
  program
    .command("daemon")
    .description("Start daemon in foreground")
    .option("--port <port>", "HTTP port (default: auto)")
    .option("--host <host>", "Host to bind to (default: 127.0.0.1)")
    .action(async (options) => {
      const { startDaemon } = await import("../../daemon/index.ts");
      const handle = await startDaemon({
        port: options.port ? parseInt(options.port, 10) : undefined,
        host: options.host,
      });
      console.log(`Daemon running on ${handle.host}:${handle.port} (pid ${process.pid})`);
      // Keep alive until signal
      await new Promise(() => {});
    });

  // ── new ────────────────────────────────────────────────────────
  program
    .command("new <name>")
    .description("Create a new agent")
    .option("-m, --model <model>", "Model identifier")
    .option("-b, --backend <type>", "Backend type", "mock")
    .option("-s, --system <prompt>", "System prompt")
    .option("-f, --system-file <file>", "Read system prompt from file")
    .option("--workflow <name>", "Workflow name (default: global)")
    .option("--tag <tag>", "Workflow instance tag (default: main)")
    .option("--port <port>", "Daemon port if starting new daemon")
    .option("--host <host>", "Daemon host (default: 127.0.0.1)")
    .option("--json", "Output as JSON")
    .action(async (name, options) => {
      let system = options.system;
      if (options.systemFile) {
        system = readFileSync(options.systemFile, "utf-8");
      }

      const model = options.model || "mock";

      // Ensure daemon is running
      await ensureDaemon({
        port: options.port ? parseInt(options.port, 10) : undefined,
        host: options.host,
      });

      const res = await createAgent({
        name,
        model,
        system,
        backend: options.backend,
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

      const agents = (res as unknown as Array<{
        name: string;
        model: string;
        backend: string;
        workflow: string;
        tag: string;
        state?: string;
      }>);

      if (options.json) {
        outputJson({ agents });
        return;
      }

      if (!Array.isArray(agents) || agents.length === 0) {
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
    .action(async (name, options) => {
      if (!isDaemonActive()) {
        console.error("No daemon running");
        process.exit(1);
      }

      if (options.all) {
        const res = await shutdown();
        if (res.ok) {
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

      const target = parseTarget(name);

      let res: Awaited<ReturnType<typeof deleteAgent>>;
      if (target.agent === undefined) {
        res = await stopWorkflow(target.workflow, target.tag);
      } else {
        res = await deleteAgent(target.agent);
      }

      if (res.ok) {
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
        console.log(`Daemon: pid=${res.pid} port=${findDaemon()?.port}`);
        console.log(`Agents: ${res.agents ?? 0}`);
        if (res.uptime) {
          console.log(`Uptime: ${res.uptime}s`);
        }
      }
    });
}
