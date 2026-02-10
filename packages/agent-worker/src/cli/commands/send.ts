import type { Command } from "commander";
import { mkdirSync } from "node:fs";
import { outputJson } from "../output.ts";
import { getInstanceAgentNames } from "@/daemon/index.ts";
import {
  createFileContextProvider,
  getDefaultContextDir,
} from "@/workflow/context/file-provider.ts";
import { DEFAULT_WORKFLOW, parseTarget } from "../target.ts";

/**
 * Get a context provider for the given workflow:tag.
 */
function getContextProvider(workflow: string, tag: string) {
  const dir = getDefaultContextDir(workflow, tag);
  mkdirSync(dir, { recursive: true });
  const agentNames = [...getInstanceAgentNames(workflow), "user"];
  return createFileContextProvider(dir, agentNames);
}

export function registerSendCommands(program: Command) {
  // Send — posts to workflow channel with @mention routing
  program
    .command("send <target> <message>")
    .description("Send message to agent or workflow channel")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Examples:
  $ agent-worker send alice "analyze this code"
  $ agent-worker send @review "team update"
  $ agent-worker send @review "@alice @bob discuss this"
    `,
    )
    .action(async (targetInput: string, message: string, options) => {
      const target = parseTarget(targetInput);
      const provider = getContextProvider(target.workflow, target.tag);

      const entry = await provider.appendChannel("user", message);

      if (options.json) {
        outputJson({
          id: entry.id,
          timestamp: entry.timestamp,
          mentions: entry.mentions,
          target: target.display,
        });
      } else if (entry.mentions.length > 0) {
        console.log(`→ @${entry.mentions.join(" @")}`);
      } else {
        console.log("→ (broadcast)");
      }
    });

  // Peek — read channel messages
  program
    .command("peek [target]")
    .description("View channel messages (default: @global)")
    .option("--json", "Output as JSON")
    .option("--all", "Show all messages")
    .option("-n, --last <count>", "Show last N messages", parseInt)
    .option("--find <text>", "Filter messages containing text")
    .addHelpText(
      "after",
      `
Examples:
  $ agent-worker peek
  $ agent-worker peek @review
  $ agent-worker peek @review:pr-123
    `,
    )
    .action(async (targetInput: string | undefined, options) => {
      const target = parseTarget(targetInput || `@${DEFAULT_WORKFLOW}`);
      const provider = getContextProvider(target.workflow, target.tag);

      const limit = options.all ? undefined : (options.last ?? 10);
      let messages = await provider.readChannel({ limit });

      if (options.find) {
        const searchText = options.find.toLowerCase();
        messages = messages.filter((msg) => msg.content.toLowerCase().includes(searchText));
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
          console.log(`  ~ ${msg.from}: ${msg.content}`);
        } else {
          const mentions = msg.mentions.length > 0 ? ` → @${msg.mentions.join(" @")}` : "";
          console.log(`[${msg.from}]${mentions} ${msg.content}`);
        }
      }
    });
}
