import type { Command } from "commander";
import { mkdirSync } from "node:fs";
import { sendRequest, isSessionActive } from "../client.ts";
import { outputJson } from "../output.ts";
import {
  getInstanceAgentNames,
  getSessionInfo,
  isSessionRunning,
} from "@/daemon/index.ts";
import { createFileContextProvider, getDefaultContextDir } from "@/workflow/context/file-provider.ts";
import { DEFAULT_INSTANCE } from "../instance.ts";

/**
 * Get a context provider for the given instance.
 * Auto-provisions the context directory if it doesn't exist.
 */
function getContextProvider(instance: string) {
  const dir = getDefaultContextDir(instance);
  mkdirSync(dir, { recursive: true });
  const agentNames = [...getInstanceAgentNames(instance), "user"];
  return createFileContextProvider(dir, agentNames);
}

export function registerSendCommands(program: Command) {
  // Send command — posts to instance channel with @mention routing
  program
    .command("send <message>")
    .description("Send message to workflow channel. Use @agent to mention specific agents.")
    .option("-w, --workflow <name>", "Target workflow (default: global)", DEFAULT_INSTANCE)
    .option("--json", "Output as JSON")
    .addHelpText('after', `
Examples:
  $ agent-worker send "@alice analyze this code"     # Mention alice in global workflow
  $ agent-worker send "@alice hello" -w review       # Mention alice in review workflow
  $ agent-worker send "team update" -w review        # Broadcast to all agents in review
    `)
    .action(async (message, options) => {
      const instance = options.workflow;
      const provider = getContextProvider(instance);

      const entry = await provider.appendChannel("user", message);

      if (options.json) {
        outputJson({
          id: entry.id,
          timestamp: entry.timestamp,
          mentions: entry.mentions,
        });
      } else if (entry.mentions.length > 0) {
        console.log(`→ @${entry.mentions.join(" @")}`);
      } else {
        console.log("→ (broadcast)");
      }
    });

  // Peek command — read channel messages
  program
    .command("peek")
    .description("View channel messages (default: last 10)")
    .option("-w, --workflow <name>", "Target workflow", DEFAULT_INSTANCE)
    .option("--json", "Output as JSON")
    .option("--all", "Show all messages")
    .option("-n, --last <count>", "Show last N messages", parseInt)
    .option("--find <text>", "Filter messages containing text (case-insensitive)")
    .action(async (options) => {
      const instance = options.workflow;
      const provider = getContextProvider(instance);

      const limit = options.all ? undefined : (options.last ?? 10);
      let messages = await provider.readChannel({ limit });

      // Apply text filter
      if (options.find) {
        const searchText = options.find.toLowerCase();
        messages = messages.filter((msg) =>
          msg.content.toLowerCase().includes(searchText),
        );
      }

      if (options.json) {
        outputJson(messages);
        return;
      }

      if (messages.length === 0) {
        console.log(options.find ? "No messages found" : "No messages");
        return;
      }

      for (const msg of messages) {
        if (msg.kind === "log" || msg.kind === "debug") {
          // System messages: dimmed format
          console.log(`  ~ ${msg.from}: ${msg.content}`);
        } else {
          const mentions = msg.mentions.length > 0 ? ` → @${msg.mentions.join(" @")}` : "";
          console.log(`[${msg.from}]${mentions} ${msg.content}`);
        }
      }
    });

  // Stats command — still per-agent (via daemon)
  program
    .command("stats [target]")
    .description("Show agent statistics")
    .option("--json", "Output as JSON")
    .action(async (target, options) => {
      if (!isSessionActive(target)) {
        console.error(target ? `Agent not found: ${target}` : "No active agent");
        process.exit(1);
      }

      const res = await sendRequest({ action: "stats" }, target);
      if (!res.success) {
        console.error("Error:", res.error);
        process.exit(1);
      }

      const stats = res.data as {
        messageCount: number;
        usage: { input: number; output: number; total: number };
      };

      if (options.json) {
        outputJson(stats);
      } else {
        console.log(`Messages: ${stats.messageCount}`);
        console.log(
          `Tokens: ${stats.usage.total} (in: ${stats.usage.input}, out: ${stats.usage.output})`,
        );
      }
    });

  // Export command — still per-agent (via daemon)
  program
    .command("export [target]")
    .description("Export agent transcript")
    .action(async (target) => {
      if (!isSessionActive(target)) {
        console.error(target ? `Agent not found: ${target}` : "No active agent");
        process.exit(1);
      }

      const res = await sendRequest({ action: "export" }, target);
      if (!res.success) {
        console.error("Error:", res.error);
        process.exit(1);
      }

      console.log(JSON.stringify(res.data, null, 2));
    });

  // Clear command — clears agent internal history (via daemon)
  program
    .command("clear [target]")
    .description("Clear agent conversation history")
    .action(async (target) => {
      if (!isSessionActive(target)) {
        console.error(target ? `Agent not found: ${target}` : "No active agent");
        process.exit(1);
      }

      const res = await sendRequest({ action: "clear" }, target);
      if (res.success) {
        console.log("History cleared");
      } else {
        console.error("Error:", res.error);
      }
    });
}
