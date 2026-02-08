/**
 * Display modes comparison: Normal vs Debug
 *
 * Run: bun run test/display-modes-demo.ts
 */

import {
  createDisplayContext,
  formatChannelEntry,
  resetTimeTracking,
} from "../src/workflow/display.ts";
import type { Message } from "../src/workflow/context/types.ts";

// Sample messages
const messages: Message[] = [
  {
    id: "1",
    from: "workflow",
    content: "Running workflow: test-simple",
    timestamp: "2026-02-09T01:17:13.123Z",
    mentions: [],
    kind: "log",
  },
  {
    id: "2",
    from: "workflow",
    content: "Agents: alice, bob",
    timestamp: "2026-02-09T01:17:13.456Z",
    mentions: [],
    kind: "log",
  },
  {
    id: "3",
    from: "workflow",
    content: "Running setup...",
    timestamp: "2026-02-09T01:17:13.789Z",
    mentions: [],
    kind: "log",
  },
  {
    id: "4",
    from: "workflow",
    content: "Starting agents...",
    timestamp: "2026-02-09T01:17:14.012Z",
    mentions: [],
    kind: "log",
  },
  {
    id: "5",
    from: "system",
    content:
      "Test workflow started at Mon Feb  9 01:17:13 CST 2026\n\n@alice - Please ask @bob a simple question about AI agents.\n\n@bob - When you receive a question, answer it briefly.\n\n@alice - After getting the answer, say thank you and summarize what you learned in one sentence.",
    timestamp: "2026-02-09T01:17:14.234Z",
    mentions: ["alice", "bob"],
  },
  {
    id: "6",
    from: "alice",
    content: "@bob What are the key components of an AI agent system?",
    timestamp: "2026-02-09T01:17:20.567Z",
    mentions: ["bob"],
  },
  {
    id: "7",
    from: "bob",
    content:
      "@alice An AI agent system typically has three key components: perception (sensors/input), reasoning (decision-making logic), and action (actuators/output).",
    timestamp: "2026-02-09T01:17:25.890Z",
    mentions: ["alice"],
  },
  {
    id: "8",
    from: "alice",
    content:
      "@bob Thank you! I learned that AI agents combine perception, reasoning, and action to function autonomously.",
    timestamp: "2026-02-09T01:17:30.123Z",
    mentions: ["bob"],
  },
  {
    id: "9",
    from: "workflow",
    content: "Workflow completed successfully",
    timestamp: "2026-02-09T01:17:35.456Z",
    mentions: [],
    kind: "log",
  },
];

const agentNames = ["workflow", "system", "alice", "bob"];

console.log("=".repeat(80));
console.log("DISPLAY MODES COMPARISON");
console.log("=".repeat(80));
console.log();

// ==================== Normal Mode ====================
console.log("━".repeat(80));
console.log("🎨 NORMAL MODE (run without --debug)");
console.log("━".repeat(80));
console.log("Timeline-style: Visual clarity, grouped by agent, easy to follow conversation");
console.log();

resetTimeTracking();
const normalContext = createDisplayContext(agentNames, {
  enableGrouping: true,
  debugMode: false,
});

messages.forEach((msg) => {
  console.log(formatChannelEntry(msg, normalContext));
});

console.log();
console.log();

// ==================== Debug Mode ====================
console.log("━".repeat(80));
console.log("🔍 DEBUG MODE (run --debug)");
console.log("━".repeat(80));
console.log("Standard log format: Plain text, easy to grep, parseable by log tools");
console.log();

resetTimeTracking();
const debugContext = createDisplayContext(agentNames, {
  enableGrouping: false,
  debugMode: true,
});

messages.forEach((msg) => {
  console.log(formatChannelEntry(msg, debugContext));
});

console.log();
console.log();

// ==================== Usage Examples ====================
console.log("━".repeat(80));
console.log("💡 USAGE EXAMPLES");
console.log("━".repeat(80));
console.log();
console.log("# Normal mode - beautiful, interactive");
console.log("$ agent-worker workflow run my-workflow");
console.log();
console.log("# Debug mode - standard log format");
console.log("$ agent-worker workflow run my-workflow --debug");
console.log();
console.log("# Piping to grep");
console.log('$ agent-worker workflow run my-workflow --debug | grep "alice"');
console.log();
console.log("# Piping to awk/sed");
console.log('$ agent-worker workflow run my-workflow --debug | awk \'{print $2, $3}\'');
console.log();
console.log("# Save to file");
console.log("$ agent-worker workflow run my-workflow --debug > workflow.log");
console.log();
console.log("=".repeat(80));
