/**
 * Workflow Logger
 *
 * Channel logger writes to the ContextProvider channel.
 * All logs become channel entries with kind="system" or kind="debug",
 * and the display layer filters what to show based on --debug flag.
 *
 * Silent logger produces no output (used when no provider is available).
 */

import type { ContextProvider } from "./context/provider.ts";

/** Log levels */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Logger instance */
export interface Logger {
  /** Debug level — only shown with --debug */
  debug: (message: string, ...args: unknown[]) => void;
  /** Info level — always shown */
  info: (message: string, ...args: unknown[]) => void;
  /** Warning level — always shown */
  warn: (message: string, ...args: unknown[]) => void;
  /** Error level — always shown */
  error: (message: string, ...args: unknown[]) => void;
  /** Check if debug mode is enabled */
  isDebug: () => boolean;
  /** Create a child logger with prefix */
  child: (prefix: string) => Logger;
}

/**
 * Create a silent logger (no output)
 */
export function createSilentLogger(): Logger {
  const noop = () => {};
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    isDebug: () => false,
    child: () => createSilentLogger(),
  };
}

// ==================== Channel Logger ====================

/** Channel logger configuration */
export interface ChannelLoggerConfig {
  /** Context provider to write channel entries */
  provider: ContextProvider;
  /** Source name for channel entries (e.g., "workflow", "controller:agentA") */
  from?: string;
}

/**
 * Create a logger that writes to the channel.
 *
 * - info/warn/error → channel entry with kind="system" (always shown to user)
 * - debug → channel entry with kind="debug" (only shown with --debug)
 *
 * The display layer handles formatting and filtering.
 */
export function createChannelLogger(config: ChannelLoggerConfig): Logger {
  const { provider, from = "system" } = config;

  const formatContent = (level: LogLevel, message: string, args: unknown[]): string => {
    const argsStr = args.length > 0 ? " " + args.map(formatArg).join(" ") : "";
    if (level === "warn") return `[WARN] ${message}${argsStr}`;
    if (level === "error") return `[ERROR] ${message}${argsStr}`;
    return `${message}${argsStr}`;
  };

  const write = (level: LogLevel, message: string, args: unknown[]) => {
    const content = formatContent(level, message, args);
    const kind = level === "debug" ? "debug" : "system";
    // Fire and forget — logging should never block the workflow
    provider.appendChannel(from, content, { kind }).catch(() => {});
  };

  return {
    debug: (message: string, ...args: unknown[]) => write("debug", message, args),
    info: (message: string, ...args: unknown[]) => write("info", message, args),
    warn: (message: string, ...args: unknown[]) => write("warn", message, args),
    error: (message: string, ...args: unknown[]) => write("error", message, args),
    isDebug: () => true, // Channel logger always captures debug; display layer filters
    child: (childPrefix: string) => {
      const newFrom = from ? `${from}:${childPrefix}` : childPrefix;
      return createChannelLogger({ provider, from: newFrom });
    },
  };
}

/** Format an argument for logging */
function formatArg(arg: unknown): string {
  if (arg === null || arg === undefined) return String(arg);
  if (typeof arg === "object") {
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }
  return String(arg);
}
