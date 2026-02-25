#!/usr/bin/env node

// Suppress AI SDK compatibility warnings (specificationVersion v2 mode, etc.)
// These are noise for end users — the SDK works correctly in compatibility mode
(globalThis as Record<string, unknown>).AI_SDK_LOG_WARNINGS = false;

// Suppress AI SDK stderr noise in normal mode to keep output clean.
// In debug mode (--debug or -d), show everything for troubleshooting.
//
// Only suppress known SDK noise patterns — let console.error() from our own
// CLI code through so CI failures are always visible.
const originalStderrWrite = process.stderr.write.bind(process.stderr);
const isDebugMode = process.argv.includes("--debug") || process.argv.includes("-d");

const SDK_NOISE_PATTERNS = [
  "specificationVersion",
  "AI_SDK",
  "ai-sdk",
  "deprecated",
  "ExperimentalWarning",
];

type WriteCallback = (err?: Error | null) => void;

process.stderr.write = function (
  chunk: string | Uint8Array,
  encodingOrCb?: BufferEncoding | WriteCallback,
  cb?: WriteCallback,
): boolean {
  const message = typeof chunk === "string" ? chunk : chunk.toString();
  // Debug mode: pass everything through for troubleshooting
  if (isDebugMode) {
    return originalStderrWrite(message, encodingOrCb as BufferEncoding, cb);
  }
  // Normal mode: suppress only known SDK noise, let everything else through
  if (SDK_NOISE_PATTERNS.some((pattern) => message.includes(pattern))) {
    return true; // Swallow the write — callers expect boolean from write()
  }
  return originalStderrWrite(message, encodingOrCb as BufferEncoding, cb);
} as typeof process.stderr.write;

import { Command } from "commander";
import { registerAgentCommands } from "./commands/agent.ts";
import { registerWorkflowCommands } from "./commands/workflow.ts";
import { registerSendCommands } from "./commands/send.ts";
import { registerInfoCommands } from "./commands/info.ts";
import { registerDocCommands } from "./commands/doc.ts";
import packageJson from "../../package.json" with { type: "json" };

const program = new Command();

program
  .name("agent-worker")
  .description("CLI for creating and managing AI agents")
  .version(packageJson.version);

registerWorkflowCommands(program);
registerAgentCommands(program);
registerSendCommands(program);
registerInfoCommands(program);
registerDocCommands(program);

program.parse();
