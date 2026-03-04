/**
 * Channel display formatting
 *
 * All output flows through the channel. This module formats and filters
 * channel entries for terminal display:
 * - kind="message" or undefined (agent messages): always shown, colored
 * - kind="system" (operational logs): always shown, dimmed
 * - kind="debug" (debug details): only shown with --debug flag
 * - kind="output" (backend streaming text): always shown, not delivered to agent inboxes
 * - kind="tool_call" (tool invocations): always shown with structured metadata
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

import type { ContextProvider } from "./context/provider.ts";
import type { Message } from "./context/types.ts";
import {
  calculateLayout,
  resetTimeTracking,
  shouldGroup,
  createGroupingState,
  type LayoutConfig,
  type GroupingState,
} from "./layout.ts";
import { formatStandardLog, formatTimelineLog } from "./layout-log.ts";

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
