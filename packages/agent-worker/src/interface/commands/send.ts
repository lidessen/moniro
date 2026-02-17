/**
 * Send/Peek commands: send, peek
 */
import type { Command } from "commander";
import { send, peek, isDaemonActive } from "../client.ts";
import { parseTarget } from "../target.ts";
import { outputJson } from "../output.ts";
import { DEFAULT_WORKFLOW } from "../../shared/constants.ts";

export function registerSendCommands(program: Command) {
  // ── send ───────────────────────────────────────────────────────
  program
    .command("send <target> <message>")
    .description("Send message to agent or workflow channel")
    .option("--json", "Output as JSON")
    .action(async (targetInput: string, message: string, options) => {
      if (!isDaemonActive()) {
        console.error("No daemon running");
        process.exit(1);
      }

      const target = parseTarget(targetInput);
      const agent = target.agent;

      // Auto-mention target agent if message doesn't already @mention them
      let finalMessage = message;
      if (agent && !message.includes(`@${agent}`)) {
        finalMessage = `@${agent} ${message}`;
      }

      const res = await send({
        agent: agent ?? "user",
        message: finalMessage,
        sender: "user",
        workflow: target.workflow,
        tag: target.tag,
      });

      if (res.error) {
        console.error("Error:", res.error);
        process.exit(1);
      }

      if (options.json) {
        outputJson(res);
      } else {
        const recipients = (res.recipients ?? []) as string[];
        if (recipients.length > 0) {
          console.log(`-> @${recipients.join(" @")}`);
        } else {
          console.log("-> (broadcast)");
        }
      }
    });

  // ── peek ───────────────────────────────────────────────────────
  program
    .command("peek [target]")
    .description("View channel messages")
    .option("--json", "Output as JSON")
    .option("-n, --last <count>", "Show last N messages", parseInt)
    .action(async (targetInput: string | undefined, options) => {
      if (!isDaemonActive()) {
        console.log("No daemon running");
        return;
      }

      const target = parseTarget(targetInput || `@${DEFAULT_WORKFLOW}`);
      const limit = options.last ?? 20;

      const res = await peek(target.workflow, target.tag, limit);

      if (res.error) {
        console.error("Error:", res.error);
        process.exit(1);
      }

      const messages = res as unknown as Array<{
        sender: string;
        content: string;
        recipients: string[];
        kind: string;
      }>;

      if (options.json) {
        outputJson(messages);
        return;
      }

      if (!Array.isArray(messages) || messages.length === 0) {
        console.log("No messages");
        return;
      }

      for (const msg of messages) {
        const mentions = msg.recipients?.length > 0 ? ` -> @${msg.recipients.join(" @")}` : "";
        if (msg.kind === "system" || msg.kind === "debug") {
          console.log(`  ~ ${msg.sender}: ${msg.content}`);
        } else {
          console.log(`[${msg.sender}]${mentions} ${msg.content}`);
        }
      }
    });
}
