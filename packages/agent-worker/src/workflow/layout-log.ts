/**
 * Log-oriented layout strategies
 *
 * Optimized for workflow logs where readability > strict alignment
 * Provides alternative formatting styles for different use cases
 */

import chalk from "chalk";
import wrapAnsi from "wrap-ansi";
import type { Message } from "./context/types.ts";
import { formatTime, type LayoutConfig } from "./layout.ts";

// ==================== Log Layout Strategies ====================

export type LogLayoutStyle = "compact" | "aligned" | "structured" | "timeline";

export interface LogLayoutConfig extends LayoutConfig {
  style: LogLayoutStyle;
}

// ==================== Compact Style ====================
/**
 * Compact style: Minimize whitespace, no strict alignment
 *
 * Example:
 * 17:13 workflow: Running workflow: test
 * 17:13 system: Test started
 *       │ Multi-line
 *       │ content
 */
export function formatCompactLog(entry: Message, layout: LayoutConfig): string {
  const time = formatTime(entry.timestamp, layout).formatted;
  const isAgent = !entry.kind || entry.kind === undefined;
  const separator = isAgent ? "│" : ":";

  const lines = entry.content.split("\n");
  const firstLine = `${chalk.dim(time)} ${chalk.cyan(entry.from)}${separator} ${lines[0]}`;

  if (lines.length === 1) return firstLine;

  // Continuation: only separator, no name/time
  const indent = "      " + (isAgent ? "│ " : "  ");
  return [firstLine, ...lines.slice(1).map((l) => indent + l)].join("\n");
}

// ==================== Aligned Style (with visual grouping) ====================
/**
 * Aligned style: Use consistent spacing but visual separators
 *
 * Example:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 17:13  workflow
 *    ┊   Running workflow: test
 *    ┊   Agents: alice, bob
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 17:13  system
 *    │   Test started
 *    │   Multi-line content
 */
export function formatAlignedLog(
  entry: Message,
  layout: LayoutConfig,
  showHeader: boolean = false,
): string {
  const time = formatTime(entry.timestamp, layout).formatted;
  const isAgent = !entry.kind || entry.kind === undefined;
  const separator = isAgent ? "│" : "┊";

  const lines = entry.content.split("\n");
  const result: string[] = [];

  if (showHeader) {
    result.push(chalk.dim("━".repeat(Math.min(layout.terminalWidth, 80))));
    result.push(`${chalk.dim(time)}  ${chalk.cyan.bold(entry.from)}`);
  }

  for (const line of lines) {
    result.push(`   ${chalk.dim(separator)}   ${line}`);
  }

  return result.join("\n");
}

// ==================== Structured Style (with indentation) ====================
/**
 * Structured style: Tree-like with indentation levels
 *
 * Example:
 * [17:13] workflow
 *   ├─ Running workflow: test
 *   └─ Agents: alice, bob
 *
 * [17:13] system
 *   ├─ Test started
 *   ├─ Multi-line
 *   └─ content
 */
export function formatStructuredLog(
  entry: Message,
  layout: LayoutConfig,
  _isLast: boolean = false,
): string {
  const time = formatTime(entry.timestamp, layout).formatted;
  const lines = entry.content.split("\n");

  const header = `${chalk.dim(`[${time}]`)} ${chalk.cyan.bold(entry.from)}`;
  const result: string[] = [header];

  for (let i = 0; i < lines.length; i++) {
    const isLastLine = i === lines.length - 1;
    const branch = isLastLine ? "└─" : "├─";
    result.push(`  ${chalk.dim(branch)} ${lines[i]}`);
  }

  return result.join("\n");
}

// ==================== Timeline Style (left-margin time) ====================
/**
 * Timeline style: Time with colored dot indicator for each agent
 *
 * Example:
 * 01:17:13 ● workflow
 *          │ Running workflow: test-simple with a very long message
 *          │ that wraps to the next line automatically
 * 01:17:20 ● alice
 *          │ @bob What are AI agents?
 * 01:17:25 ● bob
 *          │ @alice AI agents are autonomous software entities
 */
export function formatTimelineLog(
  entry: Message,
  layout: LayoutConfig,
  showTime: boolean = true,
): string {
  const time = formatTime(entry.timestamp, layout).formatted;
  const timeStr = showTime ? chalk.dim(time) : " ".repeat(layout.timeWidth);

  // Agent colors - cycle through distinct colors
  const agentColors = [
    chalk.cyan,     // workflow, system
    chalk.yellow,   // agent 1
    chalk.magenta,  // agent 2
    chalk.green,    // agent 3
    chalk.blue,     // agent 4
    chalk.redBright,// agent 5
  ];

  // Assign color based on common agent names
  let dotColor: typeof chalk.cyan;
  if (entry.from === "workflow" || entry.from === "system") {
    dotColor = agentColors[0]!; // cyan for system messages
  } else {
    // Hash agent name to consistent color
    const hash = entry.from.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
    dotColor = agentColors[(hash % (agentColors.length - 1)) + 1]!;
  }

  const dot = dotColor("●");
  const separator = chalk.dim("│");

  // Wrap content to fit within terminal width
  // Format: TIME ● SOURCE
  //         │   CONTENT (auto-wrapped)
  const prefixWidth = layout.timeWidth + 3; // "TIME ● "
  const contentWidth = Math.min(layout.terminalWidth - prefixWidth - 3, 80);

  // Wrap the message
  const wrappedLines = wrapAnsi(entry.content, contentWidth, {
    hard: true,
    trim: false,
  }).split("\n");

  const result: string[] = [];

  // First line: TIME ● SOURCE
  result.push(`${timeStr} ${dot} ${chalk.bold(entry.from)}`);

  // Content lines: all indented with separator
  const indent = " ".repeat(layout.timeWidth + 1) + `${separator} `;
  result.push(...wrappedLines.map((line) => indent + line));

  return result.join("\n");
}

// ==================== Auto-select Best Style ====================

export function formatLogMessage(
  entry: Message,
  layout: LogLayoutConfig,
  context?: {
    isFirstOfAgent?: boolean;
    isLastOfBatch?: boolean;
    showHeader?: boolean;
  },
): string {
  switch (layout.style) {
    case "compact":
      return formatCompactLog(entry, layout);
    case "aligned":
      return formatAlignedLog(entry, layout, context?.showHeader);
    case "structured":
      return formatStructuredLog(entry, layout, context?.isLastOfBatch);
    case "timeline":
      return formatTimelineLog(entry, layout, context?.isFirstOfAgent);
    default:
      return formatCompactLog(entry, layout);
  }
}

// ==================== Style Recommendations ====================

/**
 * Choose layout style based on use case
 */
export function recommendLogStyle(useCase: {
  messageCount?: number;
  agentCount?: number;
  avgMessageLength?: number;
  isInteractive?: boolean;
}): LogLayoutStyle {
  const { messageCount = 0, agentCount = 0, avgMessageLength = 0, isInteractive = true } =
    useCase;

  // Many messages from few agents → timeline
  if (messageCount > 50 && agentCount <= 3) {
    return "timeline";
  }

  // Many agents, short messages → compact
  if (agentCount > 5 && avgMessageLength < 100) {
    return "compact";
  }

  // Long messages, few agents → structured
  if (avgMessageLength > 200 && agentCount <= 4) {
    return "structured";
  }

  // Default: aligned with headers for interactive
  return isInteractive ? "aligned" : "compact";
}

// ==================== Standard Log Format (for --debug) ====================

/**
 * Standard log format: Plain text, no decorations, easy to grep
 *
 * Format: TIMESTAMP SOURCE: MESSAGE
 * Example: 2026-02-09T01:17:13Z workflow: Running workflow: test
 *
 * Designed for --debug mode, CI/CD logs, and piping to other tools
 */
export function formatStandardLog(entry: Message, includeMillis: boolean = false): string {
  const timestamp = includeMillis
    ? entry.timestamp // Full ISO: 2026-02-09T01:17:13.123Z
    : entry.timestamp.split(".")[0] + "Z"; // Truncate: 2026-02-09T01:17:13Z

  const lines = entry.content.split("\n");

  // First line: timestamp + source + content
  const result = [`${timestamp} ${entry.from}: ${lines[0]}`];

  // Continuation lines: align with content (not timestamp)
  if (lines.length > 1) {
    const indent = " ".repeat(timestamp.length + 1 + entry.from.length + 2);
    result.push(...lines.slice(1).map((line) => indent + line));
  }

  return result.join("\n");
}

// ==================== Export ====================

export const LOG_STYLES = {
  compact: formatCompactLog,
  aligned: formatAlignedLog,
  structured: formatStructuredLog,
  timeline: formatTimelineLog,
  standard: formatStandardLog,
} as const;
