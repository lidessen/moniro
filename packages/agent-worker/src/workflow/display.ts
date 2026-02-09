/**
 * Channel display formatting
 *
 * All output flows through the channel. This module formats and filters
 * channel entries for terminal display:
 * - kind=undefined (agent messages): always shown, colored
 * - kind="log" (operational logs): always shown, dimmed
 * - kind="debug" (debug details): only shown with --debug flag
 *
 * Two display modes:
 * - TTY (human): colored, aligned columns, smart wrapping
 * - Non-TTY (agent/pipe): plain text, no colors, simple separators
 *
 * Best practices implemented:
 * - Adaptive layout based on terminal width and agent names
 * - Smart text wrapping preserving ANSI colors
 * - Message grouping to reduce visual noise
 * - Background-agnostic color scheme
 */

import chalk from "chalk";
import wrapAnsi from "wrap-ansi";
import type { ContextProvider } from "./context/provider.ts";
import type { Message } from "./context/types.ts";
import {
  calculateLayout,
  formatTime,
  resetTimeTracking,
  shouldGroup,
  createGroupingState,
  getIndent,
  padToWidth,
  type LayoutConfig,
  type GroupingState,
} from "./layout.ts";
import { formatStandardLog, formatTimelineLog } from "./layout-log.ts";

// ==================== Color System ====================

/** Whether to use rich terminal formatting */
const isTTY = !!process.stdout.isTTY && !process.env.NO_COLOR;

/**
 * Background-agnostic color scheme
 * Uses only bold and standard colors that work on any theme
 */
const C = {
  // Text styling
  dim: isTTY ? chalk.dim : (s: string) => s,
  bold: isTTY ? chalk.bold : (s: string) => s,

  // Status colors (background-agnostic)
  yellow: isTTY ? chalk.yellow : (s: string) => s,
  red: isTTY ? chalk.red : (s: string) => s,

  // Agent colors — cycle through distinct hues
  agents: isTTY
    ? [chalk.cyan, chalk.yellow, chalk.magenta, chalk.green, chalk.blue, chalk.redBright]
    : Array(6).fill((s: string) => s),

  // System messages
  system: isTTY ? chalk.gray : (s: string) => s,
};

/** Separators — box-drawing for TTY, plain for pipe */
const SEP = {
  agent: isTTY ? "│" : "|", // agent messages
  log: isTTY ? "┊" : ":", // log/debug messages
  grouped: isTTY ? "│" : "|", // grouped continuation
};

// ==================== Display Context ====================

/**
 * Display context maintains layout and grouping state
 */
export interface DisplayContext {
  layout: LayoutConfig;
  grouping: GroupingState;
  agentNames: string[];
  enableGrouping: boolean;
  debugMode: boolean; // Debug mode: use standard log format
}

/**
 * Create display context for a workflow
 */
export function createDisplayContext(
  agentNames: string[],
  options?: { enableGrouping?: boolean; debugMode?: boolean },
): DisplayContext {
  return {
    layout: calculateLayout({ agentNames }),
    grouping: createGroupingState(),
    agentNames,
    enableGrouping: options?.enableGrouping ?? true,
    debugMode: options?.debugMode ?? false,
  };
}

// ==================== Internal Helpers ====================

function getAgentColor(name: string, agentNames: string[]): (s: string) => string {
  if (name === "system" || name === "user") return C.system;
  const idx = agentNames.indexOf(name);
  if (idx < 0) {
    // Hash agent name to consistent color for unknown agents
    const hash = name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return C.agents[hash % C.agents.length]!;
  }
  return C.agents[idx % C.agents.length]!;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ==================== Message Formatting ====================

/**
 * Format a channel entry for display
 *
 * Two modes:
 * - Normal mode: Timeline-style layout for visual clarity
 * - Debug mode: Standard log format (timestamp source: message)
 */
export function formatChannelEntry(entry: Message, context: DisplayContext): string {
  // Debug mode: use standard log format (no decorations, easy to grep)
  if (context.debugMode) {
    return formatStandardLog(entry, false);
  }

  // Normal mode: timeline-style for visual clarity
  // Show time for first message from this agent in this minute
  // (shouldGroup with enableGrouping=false checks if this is first message)
  const isFirstMessage = !shouldGroup(entry.from, entry.timestamp, context.grouping, false);

  return formatTimelineLog(entry, context.layout, isFirstMessage);
}

/**
 * Agent message formatting with smart wrapping and grouping
 * (Legacy - kept for potential custom formatting needs)
 *
 * Standard format:
 *   47:08 student │ Hello @bob, I have a question
 *                 │ about the architecture...
 *
 * Grouped format (same agent, same minute):
 *         │ Follow-up message
 *         │ Another thought
 */
function formatAgentEntry(entry: Message, context: DisplayContext): string {
  const { layout, agentNames, grouping, enableGrouping } = context;

  // Check if should group with previous message
  const isGrouped = shouldGroup(entry.from, entry.timestamp, grouping, enableGrouping);

  if (!isTTY) {
    // Non-TTY: simple format for machine parsing
    const time = formatTime(entry.timestamp, layout).formatted;
    const prefix = isGrouped ? "      " : `${time} `;
    return `${prefix}[${entry.from}] ${entry.content}`;
  }

  // TTY: rich format with colors and wrapping
  const color = getAgentColor(entry.from, agentNames);
  const wrappedLines = wrapMessage(entry.content, layout);

  if (isGrouped) {
    // Grouped: omit time and name, use continuation separator
    const indent = " ".repeat(layout.timeWidth + 1 + layout.nameWidth + 1);
    return wrappedLines.map((line) => `${indent}${SEP.grouped} ${line}`).join("\n");
  }

  // Standard: full format with time and name
  const time = formatTime(entry.timestamp, layout).formatted;
  const name = padToWidth(entry.from, layout.nameWidth);

  const firstLine = `${C.dim(time)} ${color(name)} ${SEP.agent} ${wrappedLines[0]}`;

  if (wrappedLines.length === 1) {
    return firstLine;
  }

  // Multi-line: indent continuation lines
  const indent = getIndent(layout, SEP.agent);
  const restLines = wrappedLines.slice(1).map((line) => indent + line);

  return [firstLine, ...restLines].join("\n");
}

/**
 * Log/debug entry formatting
 * (Legacy - kept for potential custom formatting needs)
 *
 * Format:
 *   47:01 workflow     ┊ Running workflow: my-workflow
 *   47:01 workflow     ┊ DBG Starting agents...
 *   47:02 teacher      ┊ [ERROR] Connection failed: timeout
 */
function formatLogEntry(entry: Message, layout: LayoutConfig): string {
  const isDebug = entry.kind === "debug";
  const isWarn = entry.content.startsWith("[WARN]");
  const isError = entry.content.startsWith("[ERROR]");

  const time = formatTime(entry.timestamp, layout).formatted;

  if (!isTTY) {
    // Non-TTY: simple prefix format
    const tag = isDebug ? " DBG" : "";
    return `${time} ${entry.from}${tag}: ${entry.content}`;
  }

  // TTY: dimmed, aligned, with ┊ separator
  // Shorten source: "workflow:introducer" → "introducer"
  const sourceName = entry.from.includes(":") ? entry.from.split(":").pop()! : entry.from;
  const source = padToWidth(sourceName, layout.nameWidth);

  // Choose color based on severity
  let contentColor = C.dim;
  if (isWarn) contentColor = C.yellow;
  if (isError) contentColor = C.red;

  const kindTag = isDebug ? `${C.dim("DBG")} ` : "";

  // Wrap long log messages
  const wrappedLines = wrapMessage(entry.content, layout);
  const firstLine = `${C.dim(time)} ${C.dim(source)} ${SEP.log} ${kindTag}${contentColor(wrappedLines[0]!)}`;

  if (wrappedLines.length === 1) {
    return firstLine;
  }

  // Multi-line logs: indent continuation
  const indent = getIndent(layout, SEP.log);
  const restLines = wrappedLines.slice(1).map((line) => indent + contentColor(line));

  return [firstLine, ...restLines].join("\n");
}

/**
 * Wrap message content to fit within layout constraints
 * Preserves ANSI color codes
 */
function wrapMessage(content: string, layout: LayoutConfig): string[] {
  // Split pre-existing newlines first
  const paragraphs = content.split("\n");

  const wrapped: string[] = [];
  for (const para of paragraphs) {
    if (para.length === 0) {
      wrapped.push("");
      continue;
    }

    // Wrap each paragraph to max width
    const wrappedPara = wrapAnsi(para, layout.maxContentWidth, {
      hard: true, // Break long words if necessary
      trim: false, // Preserve intentional whitespace
    });

    wrapped.push(...wrappedPara.split("\n"));
  }

  return wrapped;
}

// ==================== Channel Watcher ====================

/** Channel watcher configuration */
export interface ChannelWatcherConfig {
  /** Context provider to poll */
  contextProvider: ContextProvider;
  /** Agent names for color assignment and layout */
  agentNames: string[];
  /** Output function */
  log: (msg: string) => void;
  /** Include kind="debug" entries (default: false) */
  showDebug?: boolean;
  /** Poll interval in ms (default: 500) */
  pollInterval?: number;
  /** Starting cursor position — skip entries before this (default: 0) */
  initialCursor?: number;
  /** Enable message grouping (default: true) */
  enableGrouping?: boolean;
}

/** Channel watcher state */
export interface ChannelWatcher {
  stop: () => void;
}

/**
 * Start watching channel and displaying new entries
 * with adaptive layout and smart formatting
 */
export function startChannelWatcher(config: ChannelWatcherConfig): ChannelWatcher {
  const {
    contextProvider,
    agentNames,
    log,
    showDebug = false,
    pollInterval = 500,
    enableGrouping = true,
  } = config;

  // Initialize display context
  // Debug mode: show all entries in standard log format
  // Normal mode: timeline style with visual enhancements
  resetTimeTracking();
  const context = createDisplayContext(agentNames, {
    enableGrouping: !showDebug && enableGrouping, // Disable grouping in debug mode
    debugMode: showDebug,
  });

  let cursor = config.initialCursor ?? 0;
  let running = true;

  const poll = async () => {
    while (running) {
      try {
        const tail = await contextProvider.tailChannel(cursor);
        for (const entry of tail.entries) {
          // Filter: skip debug entries unless --debug
          if (entry.kind === "debug" && !showDebug) {
            continue;
          }

          log(formatChannelEntry(entry, context));
        }
        cursor = tail.cursor;
      } catch {
        // Ignore errors during polling
      }
      await sleep(pollInterval);
    }
  };

  poll();

  return {
    stop: () => {
      running = false;
    },
  };
}

// ==================== Exports ====================

// Re-export layout utilities for testing and external use
export {
  calculateLayout,
  resetTimeTracking,
  type LayoutConfig,
  type LayoutOptions,
} from "./layout.ts";

// Export legacy formatters for custom formatting needs
export { formatAgentEntry, formatLogEntry };
