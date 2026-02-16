/**
 * Workflow commands: run, start
 */
import type { Command } from "commander";
import { DEFAULT_TAG } from "../../shared/constants.ts";
import { startWorkflow, stopWorkflow } from "../client.ts";
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

      if (options.json) {
        console.log(JSON.stringify({ name: workflowName, tag, agents }, null, 2));
      } else {
        console.log(`Workflow: @${workflowName}${tag !== "main" ? ":" + tag : ""}`);
        console.log(`Agents:   ${agents.join(", ")}`);
      }

      // TODO: In run mode, wait for workflow completion (idle detection)
      // For now, start and return like the start command
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
