/**
 * Logger — Agent-layer logging interface.
 *
 * The Logger interface and createSilentLogger live here (zero dependencies).
 * Concrete logger factories that need ContextProvider or EventSink live in
 * workflow/logger.ts (they depend on workflow-layer types).
 */

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

/** Format an argument for logging */
export function formatArg(arg: unknown): string {
  if (arg === null || arg === undefined) return String(arg);
  if (arg instanceof Error) return arg.stack ?? arg.message;
  if (typeof arg === "object") {
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }
  return String(arg);
}
