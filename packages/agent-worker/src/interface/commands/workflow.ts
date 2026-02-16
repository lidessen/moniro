/**
 * Workflow commands: run, start
 */
import type { Command } from "commander";
import { DEFAULT_TAG } from "../../shared/constants.ts";
import { startWorkflow, stopWorkflow } from "../client.ts";
import { ensureDaemon } from "../discovery.ts";

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

      // Ensure daemon is running
      await ensureDaemon();

      // Start workflow via daemon
      const res = await startWorkflow({ workflow: parsedWorkflow, tag });

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
    .option("--json", "Output as JSON")
    .action(async (file, options) => {
      const { parseWorkflowFile } = await import("../../workflow/parser.ts");

      const tag = options.tag || DEFAULT_TAG;
      const parsedWorkflow = await parseWorkflowFile(file, { tag });
      const workflowName = parsedWorkflow.name;

      // Ensure daemon is running
      await ensureDaemon();

      // Start workflow via daemon
      const res = await startWorkflow({ workflow: parsedWorkflow, tag });

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
