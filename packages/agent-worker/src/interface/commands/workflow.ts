/**
 * Workflow commands: run, start
 */
import type { Command } from "commander";
import { DEFAULT_TAG, DEFAULT_WORKER_TIMEOUT, DEFAULT_IDLE_DEBOUNCE } from "../../shared/constants.ts";
import { startWorkflow, stopWorkflow, workflowStatus, peek } from "../client.ts";
import { ensureDaemon } from "../discovery.ts";
import type { ParsedWorkflow, SetupTask } from "../../workflow/types.ts";

export function registerWorkflowCommands(program: Command) {
  // ── run ────────────────────────────────────────────────────────
  program
    .command("run <file>")
    .description("Execute workflow and exit when complete")
    .option("--tag <tag>", "Workflow instance tag", DEFAULT_TAG)
    .option("-d, --debug", "Show debug details")
    .option("--json", "Output results as JSON")
    .option("-o, --output <file>", "Write last agent response to file")
    .action(async (file, options) => {
      const { parseWorkflowFile } = await import("../../workflow/parser.ts");

      const tag = options.tag || DEFAULT_TAG;
      const parsedWorkflow = await parseWorkflowFile(file, { tag });

      // Execute setup commands and interpolate kickoff
      const prepared = await prepareWorkflow(parsedWorkflow, tag, options.debug);

      // Ensure daemon is running
      await ensureDaemon();

      // Start workflow via daemon
      const res = await startWorkflow({ workflow: prepared, tag });

      if (res.error) {
        console.error("Error:", res.error);
        process.exit(1);
      }

      const agents = (res.agents ?? []) as string[];
      const workflowName = parsedWorkflow.name;

      const displayName = `@${workflowName}${tag !== "main" ? ":" + tag : ""}`;

      if (options.json) {
        console.log(JSON.stringify({ name: workflowName, tag, agents }, null, 2));
      } else {
        console.log(`Workflow: ${displayName}`);
        console.log(`Agents:   ${agents.join(", ")}`);
      }

      // Wait for workflow completion (all agents idle + no pending inbox)
      await waitForCompletion(workflowName, tag, displayName, options.debug);

      // Capture agent output to file if requested
      if (options.output) {
        await captureOutput(workflowName, tag, options.output, options.debug);
      }

      // Cleanup: stop workflow and daemon
      await stopWorkflow(workflowName, tag);
    });

  // ── start ──────────────────────────────────────────────────────
  program
    .command("start <file>")
    .description("Start workflow via daemon and keep agents running")
    .option("--tag <tag>", "Workflow instance tag", DEFAULT_TAG)
    .option("-d, --debug", "Show debug details")
    .option("--json", "Output as JSON")
    .action(async (file, options) => {
      const { parseWorkflowFile } = await import("../../workflow/parser.ts");

      const tag = options.tag || DEFAULT_TAG;
      const parsedWorkflow = await parseWorkflowFile(file, { tag });
      const workflowName = parsedWorkflow.name;

      // Execute setup commands and interpolate kickoff
      const prepared = await prepareWorkflow(parsedWorkflow, tag, options.debug);

      // Ensure daemon is running
      await ensureDaemon();

      // Start workflow via daemon
      const res = await startWorkflow({ workflow: prepared, tag });

      if (res.error) {
        console.error("Error:", res.error);
        process.exit(1);
      }

      const agents = (res.agents ?? []) as string[];

      if (options.json) {
        console.log(JSON.stringify({ name: workflowName, tag, agents }, null, 2));
        return;
      }

      console.log(`Workflow: @${workflowName}${tag !== "main" ? ":" + tag : ""}`);
      console.log(`Agents:   ${agents.join(", ")}`);
      console.log();
      console.log("To monitor:");
      console.log(`  agent-worker peek @${workflowName}${tag !== "main" ? ":" + tag : ""}`);
      console.log("To stop:");
      console.log(`  agent-worker stop @${workflowName}${tag !== "main" ? ":" + tag : ""}`);

      // Foreground: keep alive, stop on Ctrl+C
      let isCleaningUp = false;
      const cleanup = async () => {
        if (isCleaningUp) return;
        isCleaningUp = true;
        console.log("\nStopping workflow...");
        await stopWorkflow(workflowName, tag);
        process.exit(0);
      };

      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);

      // Keep process alive
      await new Promise(() => {});
    });
}

// ── Setup + Interpolation ──────────────────────────────────────────

/**
 * Execute setup commands and interpolate variables in kickoff/system prompts.
 * Returns a modified workflow with resolved values.
 */
async function prepareWorkflow(
  workflow: ParsedWorkflow,
  tag: string,
  debug?: boolean,
): Promise<ParsedWorkflow> {
  const { interpolate } = await import("../../workflow/interpolate.ts");

  // 1. Run setup commands
  const setupOutputs: Record<string, string> = {};
  for (const task of workflow.setup) {
    if (debug) console.log(`[setup] $ ${task.shell}`);
    const output = await runSetupCommand(task);
    if (task.as) {
      setupOutputs[task.as] = output;
      if (debug) console.log(`[setup] ${task.as} = ${output.slice(0, 100)}...`);
    }
  }

  // 2. Build interpolation context
  const ctx = {
    setup: setupOutputs,
    env: process.env as Record<string, string | undefined>,
    workflow: { name: workflow.name, tag },
  };

  // 3. Interpolate kickoff
  const kickoff = workflow.kickoff ? interpolate(workflow.kickoff, ctx) : undefined;

  // 4. Interpolate agent system prompts
  const agents = { ...workflow.agents };
  for (const [name, agent] of Object.entries(agents)) {
    if (agent.resolvedSystemPrompt) {
      agents[name] = {
        ...agent,
        resolvedSystemPrompt: interpolate(agent.resolvedSystemPrompt, ctx),
      };
    }
  }

  return { ...workflow, agents, kickoff };
}

/**
 * Poll daemon until workflow completes (all agents idle + no pending inbox).
 * Uses debounce: must see "complete" twice with a gap to confirm.
 */
async function waitForCompletion(
  name: string,
  tag: string,
  displayName: string,
  debug?: boolean,
): Promise<void> {
  const POLL_MS = 1_000;
  const TIMEOUT_MS = DEFAULT_WORKER_TIMEOUT; // 10 minutes
  const start = Date.now();
  let firstCompleteAt: number | null = null;

  while (Date.now() - start < TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_MS));

    const status = await workflowStatus(name, tag);
    if (status.error) {
      if (debug) console.log(`[run] status error: ${status.error}`);
      continue;
    }

    if (status.complete) {
      if (firstCompleteAt === null) {
        firstCompleteAt = Date.now();
        if (debug) console.log("[run] idle detected, debouncing...");
      } else if (Date.now() - firstCompleteAt >= DEFAULT_IDLE_DEBOUNCE) {
        if (debug) console.log("[run] workflow complete.");
        return;
      }
    } else {
      firstCompleteAt = null;
      if (debug) {
        const agents = (status.agents as Array<{ name: string; state: string }>) ?? [];
        const states = agents.map((a) => `${a.name}=${a.state}`).join(", ");
        console.log(`[run] waiting... ${states} pending_inbox=${status.pendingInbox}`);
      }
    }
  }

  console.error(`Timeout: workflow ${displayName} did not complete within ${TIMEOUT_MS / 1000}s`);
}

/**
 * Capture the last non-system agent message from the channel and write to file.
 * Used by `run --output` to extract the agent's final response.
 */
async function captureOutput(
  workflow: string,
  tag: string,
  outputPath: string,
  debug?: boolean,
): Promise<void> {
  const { writeFileSync } = await import("node:fs");

  const res = await peek(workflow, tag, 50);
  const messages = res as unknown as Array<{
    sender: string;
    content: string;
    kind: string;
  }>;

  if (!Array.isArray(messages) || messages.length === 0) {
    if (debug) console.log("[output] no messages to capture");
    return;
  }

  // Find last agent message (not from system/user)
  const agentMsg = [...messages]
    .reverse()
    .find((m) => m.sender !== "system" && m.sender !== "user" && m.kind !== "system");

  if (agentMsg) {
    writeFileSync(outputPath, agentMsg.content, "utf-8");
    if (debug) console.log(`[output] wrote ${agentMsg.content.length} chars to ${outputPath}`);
  } else if (debug) {
    console.log("[output] no agent message found");
  }
}

/**
 * Run a single setup shell command.
 * Returns stdout on success, throws on failure.
 */
async function runSetupCommand(task: SetupTask): Promise<string> {
  const { execSync } = await import("node:child_process");
  try {
    const output = execSync(task.shell, {
      encoding: "utf-8",
      timeout: 30_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return output.trim();
  } catch (error) {
    const e = error as { status?: number; stderr?: string };
    throw new Error(
      `Setup command failed: ${task.shell}\n  exit ${e.status}: ${e.stderr?.slice(0, 500)}`,
    );
  }
}
