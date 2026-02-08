/**
 * Visual demonstration of layout improvements
 *
 * Run with: bun run test/display-demo.ts
 *
 * This script demonstrates the new layout features:
 * - Adaptive column widths
 * - Smart text wrapping
 * - Message grouping
 * - Long error message handling
 */

import {
  createDisplayContext,
  formatChannelEntry,
  resetTimeTracking,
} from "../src/workflow/display.ts";
import type { Message } from "../src/workflow/context/types.ts";

// Mock messages simulating a workflow
const messages: Message[] = [
  // Workflow startup
  {
    id: "1",
    from: "system",
    content: "Running workflow: review",
    timestamp: new Date("2026-02-08T00:47:08Z").toISOString(),
    mentions: [],
    kind: "log",
  },
  {
    id: "2",
    from: "system",
    content: "Agents: student, teacher",
    timestamp: new Date("2026-02-08T00:47:08Z").toISOString(),
    mentions: [],
    kind: "log",
  },
  {
    id: "3",
    from: "system",
    content: "Starting agents...",
    timestamp: new Date("2026-02-08T00:47:08Z").toISOString(),
    mentions: [],
    kind: "log",
  },

  // Agent conversation
  {
    id: "4",
    from: "student",
    content:
      "@teacher I've been examining the agent-worker repository and I'm curious about the architecture. I notice it supports both 'Agent' mode (standalone instances) and 'Workflow' mode (multi-agent collaboration with @mention-based coordination).",
    timestamp: new Date("2026-02-08T00:47:28Z").toISOString(),
    mentions: ["teacher"],
  },
  {
    id: "5",
    from: "student",
    content:
      "Looking at the backend implementations in `src/backends/`, I can see support for various providers (mock, cursor, claude-code, codex, sdk) and the tools system in `src/agent/tools/`.",
    timestamp: new Date("2026-02-08T00:47:28Z").toISOString(),
    mentions: [],
  },
  {
    id: "6",
    from: "student",
    content:
      "My question is: **How does the workflow coordination system actually work in practice?** Specifically:\n\n1. When agents are running in workflow mode, how are messages routed between different agents when they're @mentioned?\n2. Is there a central coordinator that handles the message routing, or do agents communicate directly?\n3. How does the state management work when multiple agents are collaborating on the same task?",
    timestamp: new Date("2026-02-08T00:47:28Z").toISOString(),
    mentions: [],
  },
  {
    id: "7",
    from: "student",
    content:
      "I've completed the assigned task! I examined the agent-worker repository and asked a technical question about its multi-agent workflow coordination system to @teacher.",
    timestamp: new Date("2026-02-08T00:47:32Z").toISOString(),
    mentions: ["teacher"],
  },

  // Error example
  {
    id: "8",
    from: "teacher",
    content:
      "[ERROR] ERROR HTTP 400: This model's maximum context length is 131072 tokens. However, you requested 215822 tokens (207630 in the messages, 8192 in the completion). Please reduce the length of the messages or completion.",
    timestamp: new Date("2026-02-08T00:47:34Z").toISOString(),
    mentions: [],
    kind: "log",
  },

  // Recovery
  {
    id: "9",
    from: "teacher",
    content:
      "@student Excellent question about the agent-worker workflow coordination system! I've examined the codebase and can explain how it works.",
    timestamp: new Date("2026-02-08T00:49:28Z").toISOString(),
    mentions: ["student"],
  },
  {
    id: "10",
    from: "teacher",
    content:
      "**Short answer**: The system uses a **shared channel + inbox model** with @mention-based routing. There's **centralized storage** (JSONL channel file) but **decentralized processing** (each agent polls independently).",
    timestamp: new Date("2026-02-08T00:49:28Z").toISOString(),
    mentions: [],
  },

  // Completion
  {
    id: "11",
    from: "student",
    content:
      "@teacher Thank you for the detailed explanation! The resource you created provides a thorough breakdown of the workflow coordination system.",
    timestamp: new Date("2026-02-08T00:49:40Z").toISOString(),
    mentions: ["teacher"],
  },
  {
    id: "12",
    from: "system",
    content: "Workflow complete",
    timestamp: new Date("2026-02-08T00:50:05Z").toISOString(),
    mentions: [],
    kind: "log",
  },
];

// Display demo
function runDemo() {
  console.log("=".repeat(80));
  console.log("Layout Improvements Demo");
  console.log("=".repeat(80));
  console.log();

  // Create display context
  const agentNames = ["student", "teacher", "system"];
  const context = createDisplayContext(agentNames, { enableGrouping: true });

  console.log("Configuration:");
  console.log(`  Terminal Width: ${context.layout.terminalWidth} columns`);
  console.log(`  Time Format: ${context.layout.compactTime ? "MM:SS (compact)" : "HH:MM:SS"}`);
  console.log(`  Name Width: ${context.layout.nameWidth} chars`);
  console.log(`  Max Content Width: ${context.layout.maxContentWidth} chars`);
  console.log(`  Message Grouping: ${context.enableGrouping ? "enabled" : "disabled"}`);
  console.log();
  console.log("=".repeat(80));
  console.log();

  // Reset time tracking for consistent formatting
  resetTimeTracking();

  // Format and display all messages
  for (const msg of messages) {
    const formatted = formatChannelEntry(msg, context);
    console.log(formatted);
  }

  console.log();
  console.log("=".repeat(80));
  console.log("Features demonstrated:");
  console.log("  ✓ Adaptive column widths (agent names aligned)");
  console.log("  ✓ Smart text wrapping (long messages wrapped at", context.layout.maxContentWidth, "chars)");
  console.log("  ✓ Message grouping (consecutive messages from same agent)");
  console.log("  ✓ Error highlighting (red color for [ERROR] messages)");
  console.log("  ✓ Compact time format (MM:SS for short sessions)");
  console.log("  ✓ Background-agnostic colors (works on any terminal theme)");
  console.log("=".repeat(80));
}

// Run demo if executed directly
if (import.meta.main) {
  runDemo();
}

export { runDemo };
