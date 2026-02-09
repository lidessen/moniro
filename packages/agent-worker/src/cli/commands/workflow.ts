import type { Command } from "commander";
import { spawn } from "node:child_process";
import { DEFAULT_TAG } from "../target.ts";

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
      let runtime: { shutdown: () => Promise<void> } | undefined;
      let isCleaningUp = false;

      // Setup graceful shutdown for run mode
      const cleanup = async () => {
        if (isCleaningUp) return;
        isCleaningUp = true;

        console.log("\nInterrupted, cleaning up...");

        // Stop all controllers (which will abort backends)
        if (controllers) {
          const { shutdownControllers } = await import("@/workflow/index.ts");
          const logger = { debug: () => {}, info: () => {}, error: () => {} };
          await shutdownControllers(controllers, logger);
        }

        // Shutdown runtime resources
        if (runtime) {
          await runtime.shutdown();
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
          instance: `${workflowName}:${tag}`, // Backward compat
          debug: options.debug,
          log,
          mode: "run",
          feedback: options.feedback,
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
          } else if (finalDoc) {
            console.log("\n--- Document ---");
            console.log(finalDoc);
          }
        }

        // Print feedback summary (to stderr in JSON mode)
        if (result.feedback && result.feedback.length > 0 && !options.json) {
          console.log(`\n--- Feedback (${result.feedback.length}) ---`);
          for (const entry of result.feedback) {
            console.log(`  [${entry.type}] ${entry.target}: ${entry.description}`);
          }
        }
      } catch (error) {
        process.off("SIGINT", cleanup);
        process.off("SIGTERM", cleanup);
        console.error("Error:", error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Start workflow and keep agents running
  program
    .command("start <file>")
    .description("Start workflow and keep agents running")
    .option("--tag <tag>", "Workflow instance tag (default: main)", DEFAULT_TAG)
    .option("-d, --debug", "Show debug details (internal logs, MCP traces, idle checks)")
    .option("--feedback", "Enable feedback tool (agents can report tool/workflow observations)")
    .option("--background", "Run in background (daemonize)")
    .addHelpText(
      "after",
      `
Examples:
  $ agent-worker start review.yaml                    # Foreground (Ctrl+C to stop)
  $ agent-worker start review.yaml --background       # Background daemon
  $ agent-worker start review.yaml --tag pr-123       # Start review:pr-123

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

      // Background mode: spawn detached process
      if (options.background) {
        const { getDefaultContextDir } = await import("@/workflow/context/file-provider.ts");
        const contextDir = getDefaultContextDir(workflowName, tag);

        const scriptPath = process.argv[1] ?? "";
        const args = [scriptPath, "start", file];
        if (tag !== DEFAULT_TAG) {
          args.push("--tag", tag);
        }
        if (options.feedback) {
          args.push("--feedback");
        }

        const child = spawn(process.execPath, args, {
          detached: true,
          stdio: "ignore",
        });
        child.unref();

        console.log(`Workflow: ${workflowName}:${tag}`);
        console.log(`PID: ${child.pid}`);
        console.log(`Context: ${contextDir}`);
        console.log(`\nTo monitor:`);
        console.log(`  agent-worker ls @${workflowName}:${tag}`);
        console.log(`  agent-worker peek @${workflowName}:${tag}`);
        console.log(`\nTo stop:`);
        console.log(`  agent-worker stop @${workflowName}:${tag}`);
        return;
      }

      let shutdownFn: (() => Promise<void>) | undefined;

      // Setup graceful shutdown
      const cleanup = async () => {
        console.log("\nShutting down...");
        if (shutdownFn) {
          await shutdownFn();
        }
        process.exit(0);
      };

      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);

      try {
        const result = await runWorkflowWithControllers({
          workflow: parsedWorkflow,
          workflowName,
          tag,
          instance: `${workflowName}:${tag}`, // Backward compat
          debug: options.debug,
          log: console.log,
          mode: "start",
          feedback: options.feedback,
        });

        if (!result.success) {
          console.error("Workflow failed:", result.error);
          process.exit(1);
        }

        shutdownFn = result.shutdown;

        // Keep process alive
        await new Promise(() => {});
      } catch (error) {
        console.error("Error:", error instanceof Error ? error.message : String(error));
        await cleanup();
        process.exit(1);
      }
    });
}
