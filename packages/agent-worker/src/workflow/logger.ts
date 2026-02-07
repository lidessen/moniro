/**
 * Workflow Logger
 *
 * Two logger modes:
 * - Console logger (createLogger): writes formatted text to a log function (default: console.log)
 * - Channel logger (createChannelLogger): writes to a ContextProvider channel
 *
 * Channel logger is the primary mode for workflow execution.
 * All logs go to the channel as entries with kind="log" or kind="debug",
 * and the display layer filters what to show based on --debug flag.
 */

import type { ContextProvider } from "./context/provider.ts";

/** Log levels */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Logger configuration */
export interface LoggerConfig {
  /** Enable debug output */
  debug?: boolean;
  /** Custom log function (default: console.log) */
  log?: (message: string) => void;
  /** Prefix for all messages */
  prefix?: string;
}

/** Logger instance */
export interface Logger {
  /** Debug level - only shown when debug=true */
  debug: (message: string, ...args: unknown[]) => void;
  /** Info level - always shown */
  info: (message: string, ...args: unknown[]) => void;
  /** Warning level - always shown */
  warn: (message: string, ...args: unknown[]) => void;
  /** Error level - always shown */
  error: (message: string, ...args: unknown[]) => void;
  /** Check if debug mode is enabled */
  isDebug: () => boolean;
  /** Create a child logger with prefix */
  child: (prefix: string) => Logger;
}

/** Whether to use ANSI colors */
const shouldColor = !!process.stdout.isTTY && !process.env.NO_COLOR;
const a = (code: string) => (shouldColor ? code : "");

/** ANSI color codes — empty when not a TTY */
const colors = {
  reset: a("\x1b[0m"),
  dim: a("\x1b[2m"),
  bold: a("\x1b[1m"),
  red: a("\x1b[31m"),
  yellow: a("\x1b[33m"),
  blue: a("\x1b[34m"),
  cyan: a("\x1b[36m"),
  gray: a("\x1b[90m"),
};

/** Format timestamp as HH:MM:SS.mmm */
function formatTimestamp(): string {
  const now = new Date();
  return now.toTimeString().slice(0, 8) + "." + now.getMilliseconds().toString().padStart(3, "0");
}

/**
 * Create a console logger instance (writes formatted text to a log function)
 */
export function createLogger(config: LoggerConfig = {}): Logger {
  const { debug: debugEnabled = false, log = console.log, prefix = "" } = config;

  const formatMessage = (level: LogLevel, message: string, args: unknown[]): string => {
    const timestamp = formatTimestamp();
    const levelColors: Record<LogLevel, string> = {
      debug: colors.gray,
      info: colors.cyan,
      warn: colors.yellow,
      error: colors.red,
    };
    const levelStr = level.toUpperCase().padEnd(5);
    const prefixStr = prefix ? `[${prefix}] ` : "";
    const argsStr = args.length > 0 ? " " + args.map(formatArg).join(" ") : "";

    return `${colors.dim}${timestamp}${colors.reset} ${levelColors[level]}${levelStr}${colors.reset} ${prefixStr}${message}${argsStr}`;
  };

  return {
    debug: (message: string, ...args: unknown[]) => {
      if (debugEnabled) {
        log(formatMessage("debug", message, args));
      }
    },

    info: (message: string, ...args: unknown[]) => {
      log(formatMessage("info", message, args));
    },

    warn: (message: string, ...args: unknown[]) => {
      log(formatMessage("warn", message, args));
    },

    error: (message: string, ...args: unknown[]) => {
      log(formatMessage("error", message, args));
    },

    isDebug: () => debugEnabled,

    child: (childPrefix: string) => {
      const newPrefix = prefix ? `${prefix}:${childPrefix}` : childPrefix;
      return createLogger({ debug: debugEnabled, log, prefix: newPrefix });
    },
  };
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
 * - info/warn/error → channel entry with kind="log" (always shown to user)
 * - debug → channel entry with kind="debug" (only shown with --debug)
 *
 * The display layer handles formatting and filtering.
 * This keeps all output in one unified stream.
 */
export function createChannelLogger(config: ChannelLoggerConfig): Logger {
  const { provider, from = "system" } = config;

  const formatContent = (level: LogLevel, message: string, args: unknown[]): string => {
    const argsStr = args.length > 0 ? " " + args.map(formatArg).join(" ") : "";
    // Prefix with level for warn/error so they stand out in the channel
    if (level === "warn") return `[WARN] ${message}${argsStr}`;
    if (level === "error") return `[ERROR] ${message}${argsStr}`;
    return `${message}${argsStr}`;
  };

  const write = (level: LogLevel, message: string, args: unknown[]) => {
    const content = formatContent(level, message, args);
    const kind = level === "debug" ? "debug" : "log";
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
