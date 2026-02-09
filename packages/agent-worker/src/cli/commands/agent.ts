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
import {
  parseTarget,
  buildTarget,
  buildTargetDisplay,
  DEFAULT_WORKFLOW,
  DEFAULT_TAG,
  // Backward compat
  DEFAULT_INSTANCE,
} from "../target.ts";
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
    port?: string;
    host?: string;
    skill?: string[];
    skillDir?: string[];
    importSkill?: string[];
    tool?: string;
    foreground?: boolean;
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

  // Agent Mode only creates standalone agents in global workflow
  const workflow = DEFAULT_WORKFLOW;
  const tag = DEFAULT_TAG;
  const instance = DEFAULT_INSTANCE; // Backward compat

  // Auto-generate name if not provided (a0, a1, ..., z9)
  const agentName = name || generateAutoName();

  // Build full agent@workflow:tag name
  let fullName: string;
  if (agentName.includes("@")) {
    fullName = agentName;
  } else {
    fullName = buildTarget(agentName, workflow, tag);
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
      workflow,
      tag,
      instance, // Backward compat
      idleTimeout,
      backend,
      port: options.port ? parseInt(options.port, 10) : undefined,
      host: options.host,
      skills: options.skill,
      skillDirs: options.skillDir,
      importSkills: options.importSkill,
      tool: options.tool,
      feedback: options.feedback,
      schedule,
    });
  } else {
    const scriptPath = process.argv[1] ?? "";
    const args = [
      scriptPath,
      "new",
      agentName,
      "-m",
      model,
      "-b",
      backend,
      "-s",
      system,
      "--foreground",
    ];
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
    if (options.tool) {
      args.push("--tool", options.tool);
    }
    if (options.wakeup) {
      args.push("--wakeup", options.wakeup);
    }
    if (options.wakeupPrompt) {
      args.push("--wakeup-prompt", options.wakeupPrompt);
    }
    if (options.port) {
      args.push("--port", options.port);
    }
    if (options.host) {
      args.push("--host", options.host);
    }

    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    // Wait for ready signal instead of blind timeout
    const info = await waitForReady(fullName, 5000);
    if (info) {
      const targetDisplay = buildTargetDisplay(agentName, workflow, tag);

      if (options.json) {
        outputJson({
          name: agentName,
          workflow,
          tag,
          instance, // Backward compat
          model: info.model,
          backend,
        });
      } else {
        console.log(targetDisplay);
      }
    } else {
      console.error("Failed to start agent");
      process.exit(1);
    }
  }
}

// Common action for listing agents
function listAgentsAction(targetInput?: string, options?: { json?: boolean; all?: boolean }) {
  let sessions = listSessions();

  // Filter by target if specified (unless --all is used)
  if (!options?.all && targetInput) {
    const target = parseTarget(targetInput);
    sessions = sessions.filter((s) => {
      const sessionWorkflow = s.workflow || s.instance || DEFAULT_WORKFLOW;
      const sessionTag = s.tag || DEFAULT_TAG;
      return sessionWorkflow === target.workflow && sessionTag === target.tag;
    });
  } else if (!options?.all && !targetInput) {
    // Default: show global workflow only
    sessions = sessions.filter((s) => {
      const sessionWorkflow = s.workflow || s.instance || DEFAULT_WORKFLOW;
      return sessionWorkflow === DEFAULT_WORKFLOW;
    });
  }
  // If --all is specified, show all sessions (no filter)

  if (options?.json) {
    outputJson(
      sessions.map((s) => {
        const parsed = s.name ? parseTarget(s.name) : null;
        return {
          id: s.id,
          name: parsed?.agent ?? null,
          workflow: s.workflow,
          tag: s.tag,
          instance: s.instance, // Backward compat
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

  // Group by workflow:tag
  const byWorkflow = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const workflow = s.workflow || s.instance || DEFAULT_WORKFLOW;
    const tag = s.tag || DEFAULT_TAG;
    const key = buildTargetDisplay(undefined, workflow, tag);
    if (!byWorkflow.has(key)) byWorkflow.set(key, []);
    byWorkflow.get(key)!.push(s);
  }

  for (const [workflowDisplay, agents] of byWorkflow) {
    if (byWorkflow.size > 1) {
      console.log(`[${workflowDisplay}]`);
    }
    for (const s of agents) {
      const running = isSessionRunning(s.id);
      const status = running ? "running" : "stopped";
      const displayName = s.name ? getAgentDisplayName(s.name) : s.id.slice(0, 8);
      const prefix = byWorkflow.size > 1 ? "  " : "";
      console.log(`${prefix}${displayName.padEnd(12)} ${s.model.padEnd(30)} [${status}]`);
    }
  }
}

// Common action for stopping agents
async function stopAgentAction(targetInput?: string, options?: { all?: boolean }) {
  // Stop all agents
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

  if (!targetInput) {
    console.error("Specify target agent or use --all");
    process.exit(1);
  }

  // Parse target
  const target = parseTarget(targetInput);

  // If no agent name specified (e.g., @review:pr-123), stop all agents in that workflow:tag
  if (!target.agent) {
    let sessions = listSessions();
    sessions = sessions.filter((s) => {
      const sessionWorkflow = s.workflow || s.instance || DEFAULT_WORKFLOW;
      const sessionTag = s.tag || DEFAULT_TAG;
      return sessionWorkflow === target.workflow && sessionTag === target.tag;
    });

    if (sessions.length === 0) {
      console.error(
        `No agents found in ${buildTargetDisplay(undefined, target.workflow, target.tag)}`,
      );
      process.exit(1);
    }

    for (const s of sessions) {
      if (isSessionRunning(s.id)) {
        await sendRequest({ action: "shutdown" }, s.id);
        const displayName = s.name ? getAgentDisplayName(s.name) : s.id.slice(0, 8);
        console.log(`Stopped: ${displayName}`);
      }
    }
    return;
  }

  // Stop specific agent
  const fullTarget = buildTarget(target.agent, target.workflow, target.tag);
  if (!isSessionRunning(fullTarget)) {
    console.error(`Agent not found: ${targetInput}`);
    process.exit(1);
  }

  const res = await sendRequest({ action: "shutdown" }, fullTarget);
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
        .choices(["sdk", "claude", "codex", "cursor", "mock"])
        .default("sdk"),
    )
    .option("-s, --system <prompt>", "System prompt", "You are a helpful assistant.")
    .option("-f, --system-file <file>", "Read system prompt from file")
    .option("--idle-timeout <ms>", "Idle timeout in ms (0 = no timeout)", "1800000")
    .option("--skill <path...>", "Add individual skill directories")
    .option("--skill-dir <path...>", "Scan directories for skills")
    .option("--import-skill <spec...>", "Import skills from Git (owner/repo:{skill1,skill2})")
    .option("--tool <file>", "Import MCP tools from file (SDK backend only)")
    .option("--feedback", "Enable feedback tool (agent can report tool/workflow observations)")
    .option("--wakeup <value>", "Scheduled wakeup: ms number, duration (30s/5m/2h), or cron expr")
    .option("--wakeup-prompt <prompt>", "Custom prompt for scheduled wakeup")
    .option("--port <port>", "HTTP port to listen on (0 = auto-assign, default: 0)")
    .option("--host <host>", "Host to bind to (default: 127.0.0.1, use 0.0.0.0 for remote access)")
    .option("--foreground", "Run in foreground")
    .option("--json", "Output as JSON");
}

export function registerAgentCommands(program: Command) {
  // ============================================================================
  // Top-level commands (primary interface)
  // ============================================================================

  // `new` — create agent
  addNewCommandOptions(
    program
      .command("new [name]")
      .description("Create a new standalone agent (auto-names if omitted: a0, a1, ...)")
      .addHelpText(
        "after",
        `
Examples:
  $ agent-worker new alice -m anthropic/claude-sonnet-4-5    # Create standalone agent
  $ agent-worker new -b mock                                 # Quick testing without API key
  $ agent-worker new monitor --wakeup 30s                    # Agent with scheduled wakeup

Note: Agent Mode creates standalone agents in the global workflow.
      For coordinated multi-agent workflows, use Workflow Mode (YAML files).
      `,
      ),
  ).action(createAgentAction);

  // `ls` — list agents
  program
    .command("ls [target]")
    .description("List agents (default: global workflow)")
    .option("--json", "Output as JSON")
    .option("--all", "Show agents from all workflows")
    .addHelpText(
      "after",
      `
Examples:
  $ agent-worker ls                # List global workflow agents (default)
  $ agent-worker ls @review        # List review workflow agents
  $ agent-worker ls @review:pr-123 # List specific workflow:tag agents
  $ agent-worker ls --all          # List all agents from all workflows
    `,
    )
    .action(listAgentsAction);

  // `stop` — stop agent(s)
  program
    .command("stop [target]")
    .description("Stop agent(s)")
    .option("--all", "Stop all agents")
    .addHelpText(
      "after",
      `
Examples:
  $ agent-worker stop alice           # Stop alice in global workflow
  $ agent-worker stop alice@review    # Stop alice in review workflow
  $ agent-worker stop @review:pr-123  # Stop all agents in review:pr-123
  $ agent-worker stop --all           # Stop all agents
    `,
    )
    .action(stopAgentAction);

  // `status` — check agent status
  program
    .command("status [target]")
    .description("Check agent status")
    .option("--json", "Output as JSON")
    .action(async (target, options) => {
      if (!isSessionRunning(target)) {
        if (options.json) {
          outputJson({
            running: false,
            error: target ? `Not found: ${target}` : "No active agent",
          });
        } else {
          console.error(target ? `Agent not found: ${target}` : "No active agent");
        }
        process.exit(1);
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
    .option("--json", "Output as JSON")
    .action((target, options) => {
      if (setDefaultSession(target)) {
        if (options.json) {
          outputJson({ target });
        } else {
          console.log(`Default agent set to: ${target}`);
        }
      } else {
        console.error(`Agent not found: ${target}`);
        process.exit(1);
      }
    });

  // ============================================================================
  // Schedule commands (top-level)
  // ============================================================================
  const scheduleCmd = program
    .command("schedule")
    .description("Manage scheduled wakeup for agents")
    .addHelpText(
      "after",
      `
Examples:
  $ agent-worker schedule alice set 30s                    # Wake alice every 30 seconds
  $ agent-worker schedule alice set 5m --prompt "Status?"  # With custom prompt
  $ agent-worker schedule alice get                        # View current schedule
  $ agent-worker schedule alice clear                      # Remove schedule
    `,
    );

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
    .option("--json", "Output as JSON")
    .action(async (wakeup, options) => {
      // Parse as number if it looks like one
      const wakeupValue = /^\d+$/.test(wakeup) ? parseInt(wakeup, 10) : wakeup;
      const payload: Record<string, unknown> = { wakeup: wakeupValue };
      if (options.prompt) {
        payload.prompt = options.prompt;
      }
      const res = await sendRequest({ action: "schedule_set", payload }, options.to);
      if (res.success) {
        if (options.json) {
          outputJson({ wakeup: wakeupValue, prompt: options.prompt || null });
        } else {
          console.log(`Wakeup set: ${wakeup}`);
          if (options.prompt) {
            console.log(`Prompt: ${options.prompt}`);
          }
        }
      } else {
        console.error("Error:", res.error);
        process.exit(1);
      }
    });

  scheduleCmd
    .command("clear [target]")
    .description("Remove scheduled wakeup")
    .option("--json", "Output as JSON")
    .action(async (target, options) => {
      const res = await sendRequest({ action: "schedule_clear" }, target);
      if (res.success) {
        if (options.json) {
          outputJson({ success: true });
        } else {
          console.log("Schedule cleared");
        }
      } else {
        console.error("Error:", res.error);
        process.exit(1);
      }
    });
}
