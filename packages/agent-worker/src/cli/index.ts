#!/usr/bin/env node

// Suppress AI SDK compatibility warnings (specificationVersion v2 mode, etc.)
// These are noise for end users — the SDK works correctly in compatibility mode
(globalThis as Record<string, unknown>).AI_SDK_LOG_WARNINGS = false;

// Suppress stderr in normal mode to keep output clean
// In debug mode (--debug or -d), show everything for troubleshooting
const originalStderrWrite = process.stderr.write.bind(process.stderr);

process.stderr.write = function (chunk: string | Uint8Array, ...rest: unknown[]): boolean {
  const isDebugMode = process.argv.includes("--debug") || process.argv.includes("-d");
  if (isDebugMode) {
    const message = typeof chunk === "string" ? chunk : chunk.toString();
    return (originalStderrWrite as Function).call(process.stderr, message, ...rest) as boolean;
  }
  // Normal mode: suppress stderr completely
  return true;
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
import packageJson from "../../package.json" with { type: "json" };

const program = new Command();

program
  .name("agent-worker")
  .description("CLI for creating and managing AI agents")
  .version(packageJson.version);

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
