/**
 * Channel display formatting
 * Terminal output formatting for workflow channel messages.
 *
 * All output flows through the channel. This module formats and filters
 * channel entries for terminal display:
 * - kind=undefined (agent messages): always shown
 * - kind="log" (operational logs): always shown, dimmed
 * - kind="debug" (debug details): only shown with --debug flag, dimmed
 *
 * Colors are TTY-gated: no ANSI codes when output is piped or captured
 * by a subprocess (AI agent consuming output).
 */

import type { ContextProvider } from "./context/provider.ts";
import type { Message } from "./context/types.ts";

// ==================== Color System ====================

/** Whether to use ANSI colors (TTY + NO_COLOR check) */
const shouldColor = !!process.stdout.isTTY && !process.env.NO_COLOR;

/** ANSI escape or empty string based on TTY detection */
function ansi(code: string): string {
  return shouldColor ? code : "";
}

/** ANSI color codes — empty when not a TTY */
const colors = {
  reset: ansi("\x1b[0m"),
  dim: ansi("\x1b[2m"),
  bold: ansi("\x1b[1m"),
  // Agent colors (cycle through these)
  agents: [
    ansi("\x1b[36m"), // cyan
    ansi("\x1b[33m"), // yellow
    ansi("\x1b[35m"), // magenta
    ansi("\x1b[32m"), // green
    ansi("\x1b[34m"), // blue
    ansi("\x1b[91m"), // bright red
  ],
  system: ansi("\x1b[90m"), // gray for system messages
  yellow: ansi("\x1b[33m"),
  red: ansi("\x1b[31m"),
};

// ==================== Internal Helpers ====================

/** Get consistent color for an agent name */
function getAgentColor(agentName: string, agentNames: string[]): string {
  if (agentName === "system" || agentName === "user") {
    return colors.system;
  }
  const index = agentNames.indexOf(agentName);
  return colors.agents[index % colors.agents.length] ?? colors.agents[0]!;
}

/** Format timestamp as HH:MM:SS */
function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toTimeString().slice(0, 8);
}

/** Sleep helper */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ==================== Exported API ====================

/** Format a channel entry for display */
export function formatChannelEntry(entry: Message, agentNames: string[]): string {
  const time = formatTime(entry.timestamp);

  // Log/debug entries: dimmed, with source prefix
  if (entry.kind === "log" || entry.kind === "debug") {
    return formatLogEntry(entry, time);
  }

  // Normal agent messages
  const color = getAgentColor(entry.from, agentNames);
  const name = entry.from.padEnd(12);

  // Truncate very long messages, show first part
  const maxLen = 500;
  let message = entry.content;
  if (message.length > maxLen) {
    message = message.slice(0, maxLen) + "...";
  }

  // Handle multi-line messages: indent continuation lines
  const lines = message.split("\n");
  if (lines.length === 1) {
    return `${colors.dim}${time}${colors.reset} ${color}${name}${colors.reset} \u2502 ${message}`;
  }

  const firstLine = `${colors.dim}${time}${colors.reset} ${color}${name}${colors.reset} \u2502 ${lines[0]}`;
  const indent = " ".repeat(22) + "\u2502 ";
  const rest = lines
    .slice(1)
    .map((l) => indent + l)
    .join("\n");
  return firstLine + "\n" + rest;
}

/** Format a log/debug channel entry */
function formatLogEntry(entry: Message, time: string): string {
  const source = entry.from.padEnd(12);
  const isDebug = entry.kind === "debug";

  // Detect warn/error from content prefix
  const isWarn = entry.content.startsWith("[WARN]");
  const isError = entry.content.startsWith("[ERROR]");

  let contentColor = colors.dim;
  if (isWarn) contentColor = colors.yellow;
  if (isError) contentColor = colors.red;

  const kindTag = isDebug ? `${colors.dim}DBG${colors.reset} ` : "";
  const content = entry.content;

  return `${colors.dim}${time} ${source}${colors.reset} ${kindTag}${contentColor}${content}${colors.reset}`;
}

/** Channel watcher configuration */
export interface ChannelWatcherConfig {
  /** Context provider to poll */
  contextProvider: ContextProvider;
  /** Agent names for color assignment */
  agentNames: string[];
  /** Output function */
  log: (msg: string) => void;
  /** Include kind="debug" entries (default: false) */
  showDebug?: boolean;
  /** Poll interval in ms (default: 500) */
  pollInterval?: number;
}

/** Channel watcher state */
export interface ChannelWatcher {
  stop: () => void;
}

/** Start watching channel and displaying new entries */
export function startChannelWatcher(config: ChannelWatcherConfig): ChannelWatcher {
  const {
    contextProvider,
    agentNames,
    log,
    showDebug = false,
    pollInterval = 500,
  } = config;

  let lastTimestamp: string | undefined;
  let running = true;

  const poll = async () => {
    while (running) {
      try {
        const entries = await contextProvider.readChannel({ since: lastTimestamp });
        for (const entry of entries) {
          // Skip if we've already seen this (readChannel is "since", not "after")
          if (lastTimestamp && entry.timestamp <= lastTimestamp) continue;

          // Filter: skip debug entries unless --debug is on
          if (entry.kind === "debug" && !showDebug) {
            lastTimestamp = entry.timestamp;
            continue;
          }

          log(formatChannelEntry(entry, agentNames));
          lastTimestamp = entry.timestamp;
        }
      } catch {
        // Ignore errors during polling
      }
      await sleep(pollInterval);
    }
  };

  // Start polling
  poll();

  return {
    stop: () => {
      running = false;
    },
  };
}
