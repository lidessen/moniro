#!/usr/bin/env node

// Suppress AI SDK compatibility warnings (specificationVersion v2 mode, etc.)
// These are noise for end users — the SDK works correctly in compatibility mode
(globalThis as Record<string, unknown>).AI_SDK_LOG_WARNINGS = false;

// Capture stderr output for logging instead of direct output
// In normal mode: suppress from terminal but save for logging
// In debug mode: show everything immediately
const stderrBuffer: string[] = [];
const originalStderrWrite = process.stderr.write.bind(process.stderr);

process.stderr.write = function(chunk: string | Uint8Array, ...args: unknown[]): boolean {
  const message = typeof chunk === "string" ? chunk : chunk.toString();

  // In debug mode, show everything immediately
  const isDebugMode = process.argv.includes("--debug") || process.argv.includes("-d");
  if (isDebugMode) {
    return originalStderrWrite(message, ...args) as boolean;
  }

  // In normal mode, buffer stderr for logging (don't output to terminal)
  // This keeps output clean while preserving all information for debugging
  stderrBuffer.push(message);
  return true;
} as typeof process.stderr.write;

// Export stderr buffer for workflow logger to consume
export function getStderrBuffer(): string[] {
  return stderrBuffer;
}

export function clearStderrBuffer(): void {
  stderrBuffer.length = 0;
}

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
