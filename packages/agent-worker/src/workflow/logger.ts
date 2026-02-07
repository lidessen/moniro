/**
 * Workflow Logger
 * Unified logging utility with debug mode support
 */

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

/** ANSI color codes */
const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

/** Format timestamp as HH:MM:SS.mmm */
function formatTimestamp(): string {
  const now = new Date();
  return now.toTimeString().slice(0, 8) + "." + now.getMilliseconds().toString().padStart(3, "0");
}

/**
 * Create a logger instance
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

  const formatArg = (arg: unknown): string => {
    if (arg === null || arg === undefined) return String(arg);
    if (typeof arg === "object") {
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    }
    return String(arg);
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
