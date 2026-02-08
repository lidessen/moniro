/**
 * Log layout styles demonstration
 *
 * Run: bun run test/log-styles-demo.ts
 */

import { calculateLayout } from "../src/workflow/layout.ts";
import {
  formatCompactLog,
  formatAlignedLog,
  formatStructuredLog,
  formatTimelineLog,
  recommendLogStyle,
} from "../src/workflow/layout-log.ts";
import type { Message } from "../src/workflow/context/types.ts";

// Sample messages (same as user's scenario)
const messages: Message[] = [
  {
    id: "1",
    from: "workflow",
    content: "Running workflow: test-simple",
    timestamp: new Date("2026-02-09T01:17:13Z").toISOString(),
    mentions: [],
    kind: "log",
  },
  {
    id: "2",
    from: "workflow",
    content: "Agents: alice, bob",
    timestamp: new Date("2026-02-09T01:17:13Z").toISOString(),
    mentions: [],
    kind: "log",
  },
  {
    id: "3",
    from: "workflow",
    content: "Running setup...",
    timestamp: new Date("2026-02-09T01:17:13Z").toISOString(),
    mentions: [],
    kind: "log",
  },
  {
    id: "4",
    from: "workflow",
    content: "Starting agents...",
    timestamp: new Date("2026-02-09T01:17:13Z").toISOString(),
    mentions: [],
    kind: "log",
  },
  {
    id: "5",
    from: "system",
    content:
      "Test workflow started at Mon Feb  9 01:17:13 CST 2026\n\n@alice - Please ask @bob a simple question about AI agents.\n\n@bob - When you receive a question, answer it briefly.\n\n@alice - After getting the answer, say thank you and summarize what you learned in one sentence.",
    timestamp: new Date("2026-02-09T01:17:13Z").toISOString(),
    mentions: ["alice", "bob"],
  },
];

const layout = calculateLayout({
  agentNames: ["workflow", "system", "alice", "bob"],
  terminalWidth: 80,
});

console.log("=".repeat(80));
console.log("LOG LAYOUT STYLES COMPARISON");
console.log("=".repeat(80));
console.log();

// Style 1: Compact
console.log("━".repeat(80));
console.log("📦 STYLE 1: COMPACT (minimize whitespace, no strict alignment)");
console.log("━".repeat(80));
console.log("Best for: High-volume logs, CI/CD pipelines, when space is limited");
console.log();
messages.forEach((msg) => {
  console.log(formatCompactLog(msg, layout));
});
console.log();
console.log();

// Style 2: Aligned
console.log("━".repeat(80));
console.log("📐 STYLE 2: ALIGNED (visual grouping with headers)");
console.log("━".repeat(80));
console.log("Best for: Interactive sessions, when you need clear visual separation");
console.log();
let prevAgent = "";
messages.forEach((msg) => {
  const showHeader = msg.from !== prevAgent;
  console.log(formatAlignedLog(msg, layout, showHeader));
  prevAgent = msg.from;
});
console.log();
console.log();

// Style 3: Structured
console.log("━".repeat(80));
console.log("🌲 STYLE 3: STRUCTURED (tree-like indentation)");
console.log("━".repeat(80));
console.log("Best for: Nested operations, multi-line messages, when hierarchy matters");
console.log();
messages.forEach((msg, idx) => {
  console.log(formatStructuredLog(msg, layout, idx === messages.length - 1));
  if (idx < messages.length - 1) console.log();
});
console.log();
console.log();

// Style 4: Timeline
console.log("━".repeat(80));
console.log("⏱️  STYLE 4: TIMELINE (time in left margin)");
console.log("━".repeat(80));
console.log("Best for: Chronological flow, when timing is critical, audit logs");
console.log();
prevAgent = "";
messages.forEach((msg) => {
  const showTime = msg.from !== prevAgent;
  console.log(formatTimelineLog(msg, layout, showTime));
  if (msg.from !== prevAgent) console.log();
  prevAgent = msg.from;
});
console.log();
console.log();

// Recommendation
console.log("━".repeat(80));
console.log("💡 RECOMMENDATION BASED ON YOUR SCENARIO");
console.log("━".repeat(80));
const recommended = recommendLogStyle({
  messageCount: messages.length,
  agentCount: 4,
  avgMessageLength: messages.reduce((sum, m) => sum + m.content.length, 0) / messages.length,
  isInteractive: true,
});
console.log(`Recommended style: ${recommended.toUpperCase()}`);
console.log();
console.log("Reasoning:");
console.log("- Message count:", messages.length);
console.log("- Agent count: 4");
console.log(
  "- Avg message length:",
  Math.round(messages.reduce((sum, m) => sum + m.content.length, 0) / messages.length),
);
console.log("- Interactive: yes");
console.log();
console.log("To use a specific style:");
console.log('  import { formatCompactLog } from "./layout-log.ts"');
console.log("  const formatted = formatCompactLog(message, layout)");
console.log();
console.log("=".repeat(80));
