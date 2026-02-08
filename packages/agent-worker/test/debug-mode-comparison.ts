/**
 * Debug mode color comparison
 *
 * Run: bun run test/debug-mode-comparison.ts
 */

import chalk from "chalk";

const messages = [
  { time: "2026-02-09T01:17:13Z", from: "workflow", content: "Running workflow: test-simple" },
  { time: "2026-02-09T01:17:14Z", from: "system", content: "Test workflow started" },
  { time: "2026-02-09T01:17:20Z", from: "alice", content: "@bob What are AI agents?" },
  { time: "2026-02-09T01:17:25Z", from: "bob", content: "@alice AI agents are autonomous entities." },
  { time: "2026-02-09T01:17:30Z", from: "workflow", content: "[WARN] High memory usage detected" },
  { time: "2026-02-09T01:17:35Z", from: "system", content: "[ERROR] Connection timeout after 30s" },
  { time: "2026-02-09T01:17:40Z", from: "workflow", content: "Workflow completed successfully" },
];

console.log("=".repeat(80));
console.log("DEBUG MODE COLOR COMPARISON");
console.log("=".repeat(80));
console.log();

// ==================== Option A: No Colors (current) ====================
console.log("━".repeat(80));
console.log("📋 Option A: No Colors (standard log format)");
console.log("━".repeat(80));
console.log("Best for: piping, grep, saving to files, log analysis tools");
console.log();

messages.forEach(msg => {
  const lines = msg.content.split("\n");
  console.log(`${msg.time} ${msg.from}: ${lines[0]}`);
  if (lines.length > 1) {
    const indent = " ".repeat(msg.time.length + 1 + msg.from.length + 2);
    lines.slice(1).forEach(line => console.log(indent + line));
  }
});

console.log();
console.log();

// ==================== Option B: Minimal Colors ====================
console.log("━".repeat(80));
console.log("🎨 Option B: Minimal Colors (TTY-aware)");
console.log("━".repeat(80));
console.log("Best for: interactive viewing, quick error spotting");
console.log("Colors auto-disabled when piping to file/grep");
console.log();

messages.forEach(msg => {
  const isWarn = msg.content.includes("[WARN]");
  const isError = msg.content.includes("[ERROR]");

  let color = (s: string) => s; // default no color
  if (isWarn) color = chalk.yellow;
  if (isError) color = chalk.red;

  const lines = msg.content.split("\n");
  console.log(`${chalk.dim(msg.time)} ${chalk.cyan(msg.from)}: ${color(lines[0])}`);
  if (lines.length > 1) {
    const indent = " ".repeat(msg.time.length + 1 + msg.from.length + 2);
    lines.slice(1).forEach(line => console.log(indent + color(line)));
  }
});

console.log();
console.log();

// ==================== Option C: Structured Colors ====================
console.log("━".repeat(80));
console.log("🌈 Option C: Structured Colors (full highlighting)");
console.log("━".repeat(80));
console.log("Best for: development, debugging, rich terminal experience");
console.log();

messages.forEach(msg => {
  const isWarn = msg.content.includes("[WARN]");
  const isError = msg.content.includes("[ERROR]");

  let contentColor = (s: string) => s;
  if (isWarn) contentColor = chalk.yellow;
  if (isError) contentColor = chalk.red;

  const lines = msg.content.split("\n");
  console.log(`${chalk.dim(msg.time)} ${chalk.bold.cyan(msg.from)}: ${contentColor(lines[0])}`);
  if (lines.length > 1) {
    const indent = " ".repeat(msg.time.length + 1 + msg.from.length + 2);
    lines.slice(1).forEach(line => console.log(indent + contentColor(line)));
  }
});

console.log();
console.log();

console.log("━".repeat(80));
console.log("💡 RECOMMENDATIONS");
console.log("━".repeat(80));
console.log();
console.log("🏆 Recommended: Option B (Minimal Colors)");
console.log("   - Highlights errors/warnings for quick scanning");
console.log("   - Dims timestamp, colors source name");
console.log("   - Auto-disabled when piped (no ANSI codes in files)");
console.log("   - Best balance: human-readable + machine-parseable");
console.log();
console.log("📝 Alternative: Option A (No Colors)");
console.log("   - Pure text, maximum compatibility");
console.log("   - Best for CI/CD logs, log aggregation systems");
console.log();
console.log("🎨 Advanced: Option C (Full Colors)");
console.log("   - Maximum visual clarity");
console.log("   - Similar to normal mode but without decorations");
console.log();
console.log("=".repeat(80));
