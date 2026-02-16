/**
 * Adaptive Terminal Layout System
 *
 * Best practices implementation:
 * - Terminal-aware: Auto-detect width and adapt layout
 * - Smart wrapping: Preserve readability on long messages
 * - Background-agnostic: Colors work on any terminal theme
 * - Human-first: Optimize for visual clarity and scanning
 *
 * References:
 * - https://clig.dev/
 * - https://relay.sh/blog/command-line-ux-in-2020/
 */

import stringWidth from "string-width";

// ==================== Layout Configuration ====================

export interface LayoutConfig {
  /** Actual terminal width (columns) */
  terminalWidth: number;
  /** Time column width */
  timeWidth: number;
  /** Name/agent column width */
  nameWidth: number;
  /** Maximum content width before wrapping */
  maxContentWidth: number;
  /** Whether to use compact time format (MM:SS vs HH:MM:SS) */
  compactTime: boolean;
  /** Separator character width */
  separatorWidth: number;
}

export interface LayoutOptions {
  /** Agent names to optimize column width for */
  agentNames: string[];
  /** Terminal width (default: auto-detect) */
  terminalWidth?: number;
  /** Enable compact mode for short sessions */
  compact?: boolean;
  /** Maximum content width (default: 80, honor classic CLI convention) */
  maxContentWidth?: number;
}

// ==================== Layout Calculator ====================

/**
 * Calculate optimal layout based on terminal size and agent names
 *
 * Layout structure: TIME NAME SEP CONTENT
 * Example: "47:08 student │ Message here"
 *          └──┬─┘ └───┬──┘ │ └─────┬──────┘
 *             5      8     3     remaining
 */
export function calculateLayout(options: LayoutOptions): LayoutConfig {
  const { agentNames, compact = false } = options;

  // Detect terminal width (fallback to 80 for CI/pipes)
  const terminalWidth = options.terminalWidth ?? process.stdout.columns ?? 80;

  // Time format: compact sessions use MM:SS, long sessions use HH:MM:SS
  const compactTime = compact || isShortSession();
  const timeWidth = compactTime ? 5 : 8; // "MM:SS" or "HH:MM:SS"

  // Name column: adapt to longest agent name, but cap at reasonable limit
  const longestName = Math.max(
    ...agentNames.map((n) => stringWidth(n)),
    6, // minimum for "system"
  );
  const nameWidth = Math.min(longestName + 1, 20); // +1 for breathing room, max 20

  // Separator: " │ " = 3 characters
  const separatorWidth = 3;

  // Content area: respect 80-column convention for readability
  // Terminal layout: TIME<space>NAME<space>SEP<space>CONTENT
  const reserved = timeWidth + 1 + nameWidth + 1 + separatorWidth;
  const availableWidth = terminalWidth - reserved;

  // Honor classic 80-column limit, but allow wider if explicitly requested
  const defaultMaxContent = 80;
  const requestedMaxContent = options.maxContentWidth ?? defaultMaxContent;

  // Use the larger of: requested width or available terminal width
  // But ensure minimum of 40 chars for readability
  const maxContentWidth = Math.max(
    Math.min(requestedMaxContent, availableWidth),
    40, // Minimum content width
  );

  return {
    terminalWidth,
    timeWidth,
    nameWidth,
    maxContentWidth,
    compactTime,
    separatorWidth,
  };
}

/**
 * Detect if session is likely short (< 1 hour) based on current time
 * Heuristic: if it's early in the day, likely a short session
 */
function isShortSession(): boolean {
  // Use full time format (HH:MM:SS) for better precision
  // This helps track workflow duration more accurately
  return false; // Always use HH:MM:SS format
}

// ==================== Width Utilities ====================

/**
 * Get display width of text (handles emoji, fullwidth chars, ANSI codes)
 */
export function getWidth(text: string): number {
  return stringWidth(text);
}

/**
 * Pad text to target width, accounting for actual display width
 */
export function padToWidth(text: string, targetWidth: number): string {
  const currentWidth = getWidth(text);
  if (currentWidth >= targetWidth) return text;

  const padding = " ".repeat(targetWidth - currentWidth);
  return text + padding;
}

/**
 * Calculate indent string for continuation lines
 */
export function getIndent(layout: LayoutConfig, separator: string): string {
  // TIME<space>NAME<space>SEP<space>
  const spaceWidth = layout.timeWidth + 1 + layout.nameWidth + 1;
  return " ".repeat(spaceWidth) + separator + " ";
}

// ==================== Time Formatting ====================

export interface TimeFormat {
  /** Formatted time string */
  formatted: string;
  /** Whether hour changed since last message (for grouping) */
  hourChanged: boolean;
  /** Whether minute changed since last message (for grouping) */
  minuteChanged: boolean;
}

let lastTimestamp: Date | null = null;

/**
 * Format timestamp according to layout config
 */
export function formatTime(timestamp: string, layout: LayoutConfig): TimeFormat {
  const date = new Date(timestamp);
  const current = {
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
  };

  // Detect time changes for message grouping
  const last = lastTimestamp
    ? {
        hour: lastTimestamp.getHours(),
        minute: lastTimestamp.getMinutes(),
      }
    : null;

  const hourChanged = !last || last.hour !== current.hour;
  const minuteChanged = !last || last.minute !== current.minute;

  lastTimestamp = date;

  // Format based on layout
  const formatted = layout.compactTime
    ? `${pad(current.minute)}:${pad(current.second)}`
    : `${pad(current.hour)}:${pad(current.minute)}:${pad(current.second)}`;

  return { formatted, hourChanged, minuteChanged };
}

/**
 * Reset time tracking (call when starting new workflow)
 */
export function resetTimeTracking(): void {
  lastTimestamp = null;
}

function pad(num: number): string {
  return num.toString().padStart(2, "0");
}

// ==================== Message Grouping ====================

export interface GroupingState {
  lastAgent: string | null;
  lastMinute: number | null;
  messageCount: number;
}

export function createGroupingState(): GroupingState {
  return {
    lastAgent: null,
    lastMinute: null,
    messageCount: 0,
  };
}

/**
 * Check if message should be grouped with previous one
 * Groups consecutive messages from same agent within same minute
 */
export function shouldGroup(
  agent: string,
  timestamp: string,
  state: GroupingState,
  enableGrouping: boolean,
): boolean {
  if (!enableGrouping) return false;

  const date = new Date(timestamp);
  const minute = date.getHours() * 60 + date.getMinutes();

  const isSameAgent = agent === state.lastAgent;
  const isSameMinute = minute === state.lastMinute;

  // Update state
  state.lastAgent = agent;
  state.lastMinute = minute;
  state.messageCount++;

  // Group if same agent and same minute
  return isSameAgent && isSameMinute && state.messageCount > 1;
}

// ==================== Export Presets ====================

/**
 * Preset layout configurations for common scenarios
 */
export const LAYOUT_PRESETS = {
  /** Standard layout for interactive terminals */
  default: (agentNames: string[]) => calculateLayout({ agentNames }),

  /** Compact layout for CI/logs - assumes wide output space */
  compact: (agentNames: string[]) =>
    calculateLayout({
      agentNames,
      compact: true,
      maxContentWidth: 120,
      terminalWidth: 160, // Wide terminal for CI/logs
    }),

  /** Wide layout for large terminals */
  wide: (agentNames: string[]) =>
    calculateLayout({ agentNames, maxContentWidth: 120, terminalWidth: 160 }),

  /** Narrow layout for split screens */
  narrow: (agentNames: string[]) =>
    calculateLayout({ agentNames, terminalWidth: 80, maxContentWidth: 50 }),
} as const;
