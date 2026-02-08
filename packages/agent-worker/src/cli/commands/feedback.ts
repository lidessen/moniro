import type { Command } from "commander";
import type { FeedbackEntry } from "@/agent/tools/feedback.ts";
import { sendRequest, isSessionActive } from "../client.ts";
import { outputJson } from "../output.ts";

export function registerFeedbackCommand(program: Command) {
  program
    .command("feedback [target]")
    .description("View agent feedback and observations")
    .option("--json", "Output as JSON")
    .addHelpText('after', `
Examples:
  $ agent-worker feedback                # View default agent feedback
  $ agent-worker feedback alice          # View alice's feedback
  $ agent-worker feedback --json         # JSON output

Note: Requires agent to be created with --feedback flag
    `)
    .action(async (target, options) => {
      if (!isSessionActive(target)) {
        console.error(target ? `Agent not found: ${target}` : "No active agent");
        process.exit(1);
      }

      const res = await sendRequest({ action: "feedback_list" }, target);
      if (!res.success) {
        console.error("Error:", res.error);
        process.exit(1);
      }

      const entries = res.data as FeedbackEntry[];

      if (options.json) {
        outputJson(entries);
        return;
      }

      if (entries.length === 0) {
        console.log("No feedback yet");
      } else {
        for (const entry of entries) {
          const icon =
            entry.type === "missing"
              ? "[missing]"
              : entry.type === "friction"
                ? "[friction]"
                : "[suggestion]";
          console.log(`  ${icon} ${entry.target}: ${entry.description}`);
          if (entry.context) {
            console.log(`         context: ${entry.context}`);
          }
        }
      }
    });
}
