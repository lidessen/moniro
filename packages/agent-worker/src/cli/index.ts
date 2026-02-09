#!/usr/bin/env node

// Suppress AI SDK compatibility warnings (specificationVersion v2 mode, etc.)
// These are noise for end users — the SDK works correctly in compatibility mode
(globalThis as Record<string, unknown>).AI_SDK_LOG_WARNINGS = false;

// Filter noisy stderr output from child processes
// Captures common harmless errors that clutter the output
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = function(chunk: string | Uint8Array, ...args: unknown[]): boolean {
  const message = typeof chunk === "string" ? chunk : chunk.toString();

  // In debug mode, show everything (check for --debug or -d flag)
  const isDebugMode = process.argv.includes("--debug") || process.argv.includes("-d");
  if (isDebugMode) {
    return originalStderrWrite(message, ...args) as boolean;
  }

  // Filter out known harmless error messages in normal mode
  if (message.includes("accepts at most")) return true; // Commander.js errors from git/gh subcommands
  if (message.includes("fatal: bad revision")) return true; // Git errors for non-existent revisions
  if (message.match(/^warning:/i)) return true; // Generic warnings

  // Pass through everything else
  return originalStderrWrite(message, ...args) as boolean;
} as typeof process.stderr.write;

import { Command } from "commander";
import { registerAgentCommands } from "./commands/agent.ts";
import { registerSendCommands } from "./commands/send.ts";
import { registerToolCommands } from "./commands/tool.ts";
import { registerWorkflowCommands } from "./commands/workflow.ts";
import { registerApprovalCommands } from "./commands/approval.ts";
import { registerInfoCommands } from "./commands/info.ts";
import { registerDocCommands } from "./commands/doc.ts";
import { registerMockCommands } from "./commands/mock.ts";
import { registerFeedbackCommand } from "./commands/feedback.ts";

const program = new Command();

program
  .name("agent-worker")
  .description("CLI for creating and managing AI agents")
  .version("0.0.1");

registerAgentCommands(program);
registerSendCommands(program);
registerMockCommands(program);
registerFeedbackCommand(program);
registerToolCommands(program); // TODO: Remove deprecated commands
registerWorkflowCommands(program);
registerApprovalCommands(program);
registerInfoCommands(program);
registerDocCommands(program);

program.parse();
