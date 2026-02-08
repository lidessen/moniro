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
 * - TTY (human): colored, aligned columns, box-drawing separators
 * - Non-TTY (agent/pipe): plain text, no colors, simple separators
 */

import type { ContextProvider } from "./context/provider.ts";
import type { Message } from "./context/types.ts";

// ==================== Color System ====================

/** Whether to use rich terminal formatting */
const isTTY = !!process.stdout.isTTY && !process.env.NO_COLOR;

/** ANSI escape or empty string */
const a = (code: string) => (isTTY ? code : "");

const C = {
  reset: a("\x1b[0m"),
  dim: a("\x1b[2m"),
  bold: a("\x1b[1m"),
  yellow: a("\x1b[33m"),
  red: a("\x1b[31m"),
  // Agent name colors — cycle through
  agents: [
    a("\x1b[36m"), // cyan
    a("\x1b[33m"), // yellow
    a("\x1b[35m"), // magenta
    a("\x1b[32m"), // green
    a("\x1b[34m"), // blue
    a("\x1b[91m"), // bright red
  ],
  system: a("\x1b[90m"), // gray
};

/** Separators — box-drawing for TTY, plain for pipe */
const SEP = {
  agent: isTTY ? "\u2502" : "|",  // │ or |
  log: isTTY ? "\u250a" : ":",    // ┊ or :
};

// ==================== Internal Helpers ====================

const NAME_WIDTH = 12;

function getAgentColor(name: string, agentNames: string[]): string {
  if (name === "system" || name === "user") return C.system;
  const idx = agentNames.indexOf(name);
  if (idx < 0) return C.agents[0]!;
  return C.agents[idx % C.agents.length]!;
}

function formatTime(timestamp: string): string {
  return new Date(timestamp).toTimeString().slice(0, 8);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ==================== Formatting ====================

/** Format a channel entry for display */
export function formatChannelEntry(entry: Message, agentNames: string[]): string {
  const time = formatTime(entry.timestamp);

  if (entry.kind === "log" || entry.kind === "debug") {
    return formatLogEntry(entry, time);
  }

  return formatAgentEntry(entry, time, agentNames);
}

/**
 * Agent message:
 *   TTY:      14:30:02 alice        │ Hello @bob
 *   non-TTY:  14:30:02 [alice] Hello @bob
 */
function formatAgentEntry(entry: Message, time: string, agentNames: string[]): string {
  const color = getAgentColor(entry.from, agentNames);
  const maxLen = 500;
  let message = entry.content;
  if (message.length > maxLen) {
    message = message.slice(0, maxLen) + "...";
  }

  if (!isTTY) {
    // Non-TTY: simple format for machine parsing
    return `${time} [${entry.from}] ${message}`;
  }

  // TTY: colored, aligned columns
  const name = entry.from.padEnd(NAME_WIDTH);
  const lines = message.split("\n");

  if (lines.length === 1) {
    return `${C.dim}${time}${C.reset} ${color}${name}${C.reset} ${SEP.agent} ${message}`;
  }

  const firstLine = `${C.dim}${time}${C.reset} ${color}${name}${C.reset} ${SEP.agent} ${lines[0]}`;
  const indent = " ".repeat(9 + NAME_WIDTH + 1) + `${SEP.agent} `;
  const rest = lines
    .slice(1)
    .map((l) => indent + l)
    .join("\n");
  return firstLine + "\n" + rest;
}

/**
 * Log/debug entry:
 *   TTY:      14:30:01 workflow     ┊ Running workflow: my-workflow
 *   TTY+DBG:  14:30:01 workflow     ┊ DBG Starting workflow...
 *   non-TTY:  14:30:01 workflow: Running workflow: my-workflow
 */
function formatLogEntry(entry: Message, time: string): string {
  const isDebug = entry.kind === "debug";
  const isWarn = entry.content.startsWith("[WARN]");
  const isError = entry.content.startsWith("[ERROR]");

  if (!isTTY) {
    // Non-TTY: simple prefix format
    const tag = isDebug ? " DBG" : "";
    return `${time} ${entry.from}${tag}: ${entry.content}`;
  }

  // TTY: dimmed, aligned, with ┊ separator
  const source = entry.from.padEnd(NAME_WIDTH);

  let contentColor = C.dim;
  if (isWarn) contentColor = C.yellow;
  if (isError) contentColor = C.red;

  const kindTag = isDebug ? `${C.dim}DBG${C.reset} ` : "";

  return `${C.dim}${time} ${source} ${SEP.log}${C.reset} ${kindTag}${contentColor}${entry.content}${C.reset}`;
}

// ==================== Channel Watcher ====================

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

  let processedCount = 0;
  let running = true;

  const poll = async () => {
    while (running) {
      try {
        // Read all entries and skip already-processed ones by index.
        // Timestamp-based dedup silently drops entries that share a timestamp
        // with a skipped debug entry (e.g. agent channel_send messages).
        const entries = await contextProvider.readChannel();
        for (let i = processedCount; i < entries.length; i++) {
          const entry = entries[i]!;

          // Filter: skip debug entries unless --debug
          if (entry.kind === "debug" && !showDebug) {
            continue;
          }

          log(formatChannelEntry(entry, agentNames));
        }
        processedCount = entries.length;
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
