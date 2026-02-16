import type { Command } from "commander";
import { DEFAULT_TAG } from "../target.ts";
import { startWorkflow, stopWorkflow } from "../client.ts";

export function registerWorkflowCommands(program: Command) {
  // Run workflow
  program
    .command("run <file>")
    .description("Execute workflow and exit when complete")
    .option("--tag <tag>", "Workflow instance tag (default: main)", DEFAULT_TAG)
    .option("-d, --debug", "Show debug details (internal logs, MCP traces, idle checks)")
    .option("--feedback", "Enable feedback tool (agents can report tool/workflow observations)")
    .option("--json", "Output results as JSON")
    .addHelpText(
      "after",
      `
Examples:
  $ agent-worker run review.yaml                        # Run review:main
  $ agent-worker run review.yaml --tag pr-123           # Run review:pr-123
  $ agent-worker run review.yaml --json | jq .document  # Machine-readable output

Note: Workflow name is inferred from YAML 'name' field or filename
    `,
    )
    .action(async (file, options) => {
      const { parseWorkflowFile, runWorkflowWithControllers } = await import("@/workflow/index.ts");

      const tag = options.tag || DEFAULT_TAG;

      // Parse workflow file to get the workflow name
      const parsedWorkflow = await parseWorkflowFile(file, {
        tag,
      });
      const workflowName = parsedWorkflow.name;

      let controllers: Map<string, any> | undefined;
      let isCleaningUp = false;

      // Setup graceful shutdown for run mode
      const cleanup = async () => {
        if (isCleaningUp) return;
        isCleaningUp = true;

        console.log("\nInterrupted, cleaning up...");

        // Stop all controllers (which will abort backends)
        if (controllers) {
          const { shutdownControllers } = await import("@/workflow/index.ts");
          const { createSilentLogger } = await import("@/workflow/logger.ts");
          await shutdownControllers(controllers, createSilentLogger());
        }

        process.exit(130); // 130 = 128 + SIGINT(2)
      };

      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);

      try {
        // In JSON mode, route logs to stderr to keep stdout clean
        const log = options.json ? console.error : console.log;

        const result = await runWorkflowWithControllers({
          workflow: parsedWorkflow,
          workflowName,
          tag,
          workflowPath: file, // Pass workflow file path
          instance: `${workflowName}:${tag}`, // Backward compat
          debug: options.debug,
          log,
          mode: "run",
          feedback: options.feedback,
          prettyDisplay: !options.debug && !options.json, // Use pretty display in non-debug, non-json mode
        });

        // Store references for cleanup (though run mode completes automatically)
        controllers = result.controllers;

        // Remove signal handlers after successful completion
        process.off("SIGINT", cleanup);
        process.off("SIGTERM", cleanup);

        if (!result.success) {
          console.error("Workflow failed:", result.error);
          process.exit(1);
        }

        // Read final document content as result
        if (result.contextProvider) {
          const finalDoc = await result.contextProvider.readDocument();
          if (options.json) {
            console.log(
              JSON.stringify(
                {
                  success: true,
                  duration: result.duration,
                  document: finalDoc,
                  feedback: result.feedback,
                },
                null,
                2,
              ),
            );
          } else if (!options.debug) {
            // Pretty display mode - show summary
            const { showWorkflowSummary } = await import("@/workflow/display-pretty.ts");
            showWorkflowSummary({
              duration: result.duration,
              document: finalDoc,
              feedback: result.feedback,
            });
          } else {
            // Debug mode - show traditional output
            if (finalDoc) {
              console.log("\n--- Document ---");
              console.log(finalDoc);
            }
            if (result.feedback && result.feedback.length > 0) {
              console.log(`\n--- Feedback (${result.feedback.length}) ---`);
              for (const entry of result.feedback) {
                console.log(`  [${entry.type}] ${entry.target}: ${entry.description}`);
              }
            }
          }
        }
      } catch (error) {
        process.off("SIGINT", cleanup);
        process.off("SIGTERM", cleanup);
        console.error("Error:", error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Start workflow and keep agents running (via daemon)
  program
    .command("start <file>")
    .description("Start workflow via daemon and keep agents running")
    .option("--tag <tag>", "Workflow instance tag (default: main)", DEFAULT_TAG)
    .option("--feedback", "Enable feedback tool (agents can report tool/workflow observations)")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Examples:
  $ agent-worker start review.yaml                    # Start review:main (Ctrl+C to stop)
  $ agent-worker start review.yaml --tag pr-123       # Start review:pr-123

Workflow runs inside the daemon. Use ls/stop to manage:
  $ agent-worker ls                                   # List all agents
  $ agent-worker stop @review:pr-123                  # Stop workflow

Note: Workflow name is inferred from YAML 'name' field or filename
    `,
    )
    .action(async (file, options) => {
      const { parseWorkflowFile } = await import("@/workflow/index.ts");
      const { ensureDaemon } = await import("./agent.ts");

      const tag = options.tag || DEFAULT_TAG;

      // Parse workflow file locally (resolves file paths, system prompts)
      const parsedWorkflow = await parseWorkflowFile(file, { tag });
      const workflowName = parsedWorkflow.name;

      // Ensure daemon is running
      await ensureDaemon();

      // Start workflow via daemon
      const res = await startWorkflow({
        workflow: parsedWorkflow,
        tag,
        feedback: options.feedback,
      });

      if (res.error) {
        console.error("Error:", res.error);
        process.exit(1);
      }

      const agents = (res.agents ?? []) as string[];

      if (options.json) {
        const { outputJson } = await import("../output.ts");
        outputJson({ name: workflowName, tag, agents });
        return;
      }

      console.log(`Workflow: @${workflowName}${tag !== "main" ? ":" + tag : ""}`);
      console.log(`Agents:   ${agents.join(", ")}`);
      console.log(`\nTo monitor:`);
      console.log(`  agent-worker ls`);
      console.log(`  agent-worker peek @${workflowName}${tag !== "main" ? ":" + tag : ""}`);
      console.log(`\nTo stop:`);
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
