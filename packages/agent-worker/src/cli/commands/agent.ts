import { Command, Option } from "commander";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { getDefaultModel } from "@/agent/models.ts";
import type { BackendType } from "@/backends/types.ts";
import { sendRequest } from "../client.ts";
import {
  startDaemon,
  isSessionRunning,
  listSessions,
  setDefaultSession,
  waitForReady,
  generateAutoName,
  getAgentDisplayName,
} from "@/daemon/index.ts";
import { buildAgentId, parseAgentId, isValidInstanceName, DEFAULT_INSTANCE } from "../instance.ts";
import { outputJson } from "../output.ts";

// Common action for creating new agent
async function createAgentAction(
  name: string | undefined,
  options: {
    model?: string;
    backend?: string;
    system?: string;
    systemFile?: string;
    idleTimeout?: string;
    skill?: string[];
    skillDir?: string[];
    importSkill?: string[];
    foreground?: boolean;
    workflow?: string;
    json?: boolean;
    feedback?: boolean;
    wakeup?: string;
    wakeupPrompt?: string;
  },
) {
  let system = options.system ?? "You are a helpful assistant.";
  if (options.systemFile) {
    system = readFileSync(options.systemFile, "utf-8");
  }

  const backend = (options.backend ?? "sdk") as BackendType;
  const model = options.model || getDefaultModel();
  const idleTimeout = parseInt(options.idleTimeout ?? "1800000", 10);
  const instance = options.workflow || DEFAULT_INSTANCE;

  // Auto-generate name if not provided (a0, a1, ..., z9)
  const agentName = name || generateAutoName();

  // Build full agent@instance name
  let fullName: string;
  if (agentName.includes("@")) {
    fullName = agentName;
  } else if (options.workflow) {
    if (!isValidInstanceName(options.workflow)) {
      console.error(`Invalid workflow name: ${options.workflow}`);
      console.error("Workflow names must be alphanumeric, hyphen, or underscore");
      process.exit(1);
    }
    fullName = buildAgentId(agentName, options.workflow);
  } else {
    fullName = buildAgentId(agentName, DEFAULT_INSTANCE);
  }

  // Build schedule config if provided
  const schedule = options.wakeup
    ? {
        wakeup: /^\d+$/.test(options.wakeup) ? parseInt(options.wakeup, 10) : options.wakeup,
        prompt: options.wakeupPrompt,
      }
    : undefined;

  if (options.foreground) {
    startDaemon({
      model,
      system,
      name: fullName,
      instance,
      idleTimeout,
      backend,
      skills: options.skill,
      skillDirs: options.skillDir,
      importSkills: options.importSkill,
      feedback: options.feedback,
      schedule,
    });
  } else {
    const scriptPath = process.argv[1] ?? "";
    const args = [scriptPath, "new", agentName, "-m", model, "-b", backend, "-s", system, "--foreground"];
    args.push("--workflow", instance);
    args.push("--idle-timeout", String(idleTimeout));
    if (options.feedback) {
      args.push("--feedback");
    }
    if (options.skill) {
      for (const skillPath of options.skill) {
        args.push("--skill", skillPath);
      }
    }
    if (options.skillDir) {
      for (const dir of options.skillDir) {
        args.push("--skill-dir", dir);
      }
    }
    if (options.importSkill) {
      for (const spec of options.importSkill) {
        args.push("--import-skill", spec);
      }
    }
    if (options.wakeup) {
      args.push("--wakeup", options.wakeup);
    }
    if (options.wakeupPrompt) {
      args.push("--wakeup-prompt", options.wakeupPrompt);
    }

    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    // Wait for ready signal instead of blind timeout
    const info = await waitForReady(fullName, 5000);
    if (info) {
      const instanceStr = instance !== DEFAULT_INSTANCE ? `@${instance}` : "";

      if (options.json) {
        outputJson({ name: agentName, instance, model: info.model, backend });
      } else {
        console.log(`${agentName}${instanceStr}`);
      }
    } else {
      console.error("Failed to start agent");
      process.exit(1);
    }
  }
}

// Common action for listing agents
function listAgentsAction(options?: { json?: boolean; workflow?: string }) {
  let sessions = listSessions();

  // Filter by workflow if specified
  if (options?.workflow) {
    sessions = sessions.filter((s) => s.instance === options.workflow);
  }

  if (options?.json) {
    outputJson(
      sessions.map((s) => {
        const parsed = s.name ? parseAgentId(s.name) : null;
        return {
          id: s.id,
          name: parsed?.agent ?? null,
          instance: s.instance,
          model: s.model,
          backend: s.backend,
          running: isSessionRunning(s.id),
        };
      }),
    );
    return;
  }

  if (sessions.length === 0) {
    console.log("No active agents");
    return;
  }

  // Group by instance
  const byInstance = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const inst = s.instance || DEFAULT_INSTANCE;
    if (!byInstance.has(inst)) byInstance.set(inst, []);
    byInstance.get(inst)!.push(s);
  }

  for (const [inst, agents] of byInstance) {
    if (byInstance.size > 1) {
      console.log(`[${inst}]`);
    }
    for (const s of agents) {
      const running = isSessionRunning(s.id);
      const status = running ? "running" : "stopped";
      const displayName = s.name ? getAgentDisplayName(s.name) : s.id.slice(0, 8);
      const prefix = byInstance.size > 1 ? "  " : "";
      console.log(`${prefix}${displayName.padEnd(12)} ${s.model.padEnd(30)} [${status}]`);
    }
  }
}

// Common action for stopping agents
async function stopAgentAction(target?: string, options?: { all?: boolean; workflow?: string }) {
  if (options?.all) {
    const sessions = listSessions();
    for (const s of sessions) {
      if (isSessionRunning(s.id)) {
        await sendRequest({ action: "shutdown" }, s.id);
        const displayName = s.name ? getAgentDisplayName(s.name) : s.id.slice(0, 8);
        console.log(`Stopped: ${displayName}`);
      }
    }
    return;
  }

  if (options?.workflow) {
    const sessions = listSessions().filter((s) => s.instance === options.workflow);
    for (const s of sessions) {
      if (isSessionRunning(s.id)) {
        await sendRequest({ action: "shutdown" }, s.id);
        const displayName = s.name ? getAgentDisplayName(s.name) : s.id.slice(0, 8);
        console.log(`Stopped: ${displayName}`);
      }
    }
    return;
  }

  if (!target) {
    console.error("Specify target agent, or use --all / --workflow");
    process.exit(1);
  }

  if (!isSessionRunning(target)) {
    console.log(`Agent not found: ${target}`);
    return;
  }

  const res = await sendRequest({ action: "shutdown" }, target);
  if (res.success) {
    console.log("Agent stopped");
  } else {
    console.error("Error:", res.error);
  }
}

function addNewCommandOptions(cmd: Command): Command {
  return cmd
    .option("-m, --model <model>", `Model identifier (default: ${getDefaultModel()})`)
    .addOption(
      new Option("-b, --backend <type>", "Backend type")
        .choices(["sdk", "claude", "codex", "cursor"])
        .default("sdk"),
    )
    .option("-s, --system <prompt>", "System prompt", "You are a helpful assistant.")
    .option("-f, --system-file <file>", "Read system prompt from file")
    .option("--idle-timeout <ms>", "Idle timeout in ms (0 = no timeout)", "1800000")
    .option("--skill <path...>", "Add individual skill directories")
    .option("--skill-dir <path...>", "Scan directories for skills")
    .option("--import-skill <spec...>", "Import skills from Git (owner/repo:{skill1,skill2})")
    .option("--feedback", "Enable feedback tool (agent can report tool/workflow observations)")
    .option("--wakeup <value>", "Scheduled wakeup: ms number, duration (30s/5m/2h), or cron expr")
    .option("--wakeup-prompt <prompt>", "Custom prompt for scheduled wakeup")
    .option("-w, --workflow <name>", "Workflow namespace (agents in same workflow share context)")
    .option("--foreground", "Run in foreground")
    .option("--json", "Output as JSON");
}

export function registerAgentCommands(program: Command) {
  // ============================================================================
  // Top-level commands (primary interface)
  // ============================================================================

  // `new` — create agent
  addNewCommandOptions(
    program.command("new [name]").description("Create a new agent (auto-names if omitted: a0, a1, ...)"),
  ).action(createAgentAction);

  // `ls` — list agents
  program
    .command("ls")
    .description("List all agents")
    .option("--json", "Output as JSON")
    .option("-w, --workflow <name>", "Filter by workflow")
    .action(listAgentsAction);

  // `stop` — stop agent(s)
  program
    .command("stop [target]")
    .description("Stop agent(s)")
    .option("--all", "Stop all agents")
    .option("-w, --workflow <name>", "Stop all agents in workflow")
    .action(stopAgentAction);

  // `status` — check agent status
  program
    .command("status [target]")
    .description("Check agent status")
    .option("--json", "Output as JSON")
    .action(async (target, options) => {
      if (!isSessionRunning(target)) {
        if (options.json) {
          outputJson({ running: false, error: target ? `Not found: ${target}` : "No active agent" });
        } else {
          console.log(target ? `Agent not found: ${target}` : "No active agent");
        }
        return;
      }

      const res = await sendRequest({ action: "ping" }, target);
      if (res.success && res.data) {
        const data = res.data as { id: string; model: string; name?: string };
        if (options.json) {
          outputJson({ ...data, running: true });
        } else {
          const nameStr = data.name ? ` (${data.name})` : "";
          console.log(`Agent: ${data.id}${nameStr}`);
          console.log(`Model: ${data.model}`);
        }
      }
    });

  // `use` — set default agent
  program
    .command("use <target>")
    .description("Set default agent")
    .action((target) => {
      if (setDefaultSession(target)) {
        console.log(`Default agent set to: ${target}`);
      } else {
        console.error(`Agent not found: ${target}`);
        process.exit(1);
      }
    });

  // ============================================================================
  // Schedule commands (top-level)
  // ============================================================================
  const scheduleCmd = program.command("schedule").description("Manage scheduled wakeup");

  scheduleCmd
    .command("get [target]")
    .description("Show current wakeup schedule")
    .option("--json", "Output as JSON")
    .action(async (target, options) => {
      const res = await sendRequest({ action: "schedule_get" }, target);
      if (!res.success) {
        console.error("Error:", res.error);
        process.exit(1);
      }
      if (options.json) {
        outputJson(res.data);
      } else if (res.data) {
        const s = res.data as { wakeup: string | number; prompt?: string };
        console.log(`Wakeup: ${s.wakeup}`);
        if (s.prompt) {
          console.log(`Prompt: ${s.prompt}`);
        } else {
          console.log("Prompt: (default)");
        }
      } else {
        console.log("No wakeup schedule configured");
      }
    });

  scheduleCmd
    .command("set <wakeup>")
    .description("Set wakeup schedule (ms number, duration 30s/5m/2h, or cron expression)")
    .option("-p, --prompt <prompt>", "Custom wakeup prompt")
    .option("--to <target>", "Target agent")
    .action(async (wakeup, options) => {
      // Parse as number if it looks like one
      const wakeupValue = /^\d+$/.test(wakeup) ? parseInt(wakeup, 10) : wakeup;
      const payload: Record<string, unknown> = { wakeup: wakeupValue };
      if (options.prompt) {
        payload.prompt = options.prompt;
      }
      const res = await sendRequest(
        { action: "schedule_set", payload },
        options.to,
      );
      if (res.success) {
        console.log(`Wakeup set: ${wakeup}`);
        if (options.prompt) {
          console.log(`Prompt: ${options.prompt}`);
        }
      } else {
        console.error("Error:", res.error);
        process.exit(1);
      }
    });

  scheduleCmd
    .command("clear [target]")
    .description("Remove scheduled wakeup")
    .action(async (target) => {
      const res = await sendRequest({ action: "schedule_clear" }, target);
      if (res.success) {
        console.log("Schedule cleared");
      } else {
        console.error("Error:", res.error);
        process.exit(1);
      }
    });
}
