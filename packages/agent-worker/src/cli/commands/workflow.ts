import type { Command } from "commander";
import { spawn } from "node:child_process";

export function registerWorkflowCommands(program: Command) {
  // Run workflow
  program
    .command("run <file>")
    .description("Execute workflow and exit when complete")
    .option("-w, --workflow <name>", "Workflow name", "default")
    .option("-d, --debug", "Show debug details (internal logs, MCP traces, idle checks)")
    .option("--feedback", "Enable feedback tool (agents can report tool/workflow observations)")
    .option("--json", "Output results as JSON")
    .addHelpText('after', `
Examples:
  $ agent-worker run review.yaml                        # One-shot execution
  $ agent-worker run review.yaml -w review:pr-123       # With specific tag
  $ agent-worker run review.yaml --json | jq .document  # Machine-readable output
    `)
    .action(async (file, options) => {
      const { parseWorkflowFile, runWorkflowWithControllers } =
        await import("@/workflow/index.ts");

      try {
        const workflow = await parseWorkflowFile(file, { instance: options.workflow });

        // In JSON mode, route logs to stderr to keep stdout clean
        const log = options.json ? console.error : console.log;

        const result = await runWorkflowWithControllers({
          workflow,
          instance: options.workflow,
          debug: options.debug,
          log,
          mode: "run",
          feedback: options.feedback,
        });

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
        console.error("Error:", error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Start workflow and keep agents running
  program
    .command("start <file>")
    .description("Start workflow and keep agents running")
    .option("-w, --workflow <name>", "Workflow name", "default")
    .option("-d, --debug", "Show debug details (internal logs, MCP traces, idle checks)")
    .option("--feedback", "Enable feedback tool (agents can report tool/workflow observations)")
    .option("--background", "Run in background (daemonize)")
    .addHelpText('after', `
Examples:
  $ agent-worker start review.yaml                    # Foreground (Ctrl+C to stop)
  $ agent-worker start review.yaml --background       # Background daemon
  $ agent-worker start review.yaml -w review:pr-123   # With specific tag
    `)
    .action(async (file, options) => {
      const { parseWorkflowFile, runWorkflowWithControllers } =
        await import("@/workflow/index.ts");

      // Background mode: spawn detached process
      if (options.background) {
        const { getDefaultContextDir } = await import("@/workflow/context/file-provider.ts");
        const contextDir = getDefaultContextDir(options.workflow, options.workflow);

        const scriptPath = process.argv[1] ?? "";
        const args = [scriptPath, "start", file, "--workflow", options.workflow];
        if (options.feedback) {
          args.push("--feedback");
        }

        const child = spawn(process.execPath, args, {
          detached: true,
          stdio: "ignore",
        });
        child.unref();

        console.log(`Workflow: ${options.workflow}`);
        console.log(`PID: ${child.pid}`);
        console.log(`Context: ${contextDir}`);
        console.log(`\nTo monitor:`);
        console.log(`  agent-worker ls -w ${options.workflow}`);
        console.log(`  agent-worker peek -w ${options.workflow}`);
        console.log(`\nTo stop:`);
        console.log(`  agent-worker stop -w ${options.workflow}`);
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
        const workflow = await parseWorkflowFile(file, { instance: options.workflow });

        const result = await runWorkflowWithControllers({
          workflow,
          instance: options.workflow,
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
