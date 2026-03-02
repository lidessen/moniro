/**
 * Logger — Workflow-layer logger factories.
 *
 * Logger interface + createSilentLogger are in agent/logger.ts (zero deps).
 * This file provides concrete factories that depend on workflow types:
 *
 * - createChannelLogger  → ContextProvider channel (workspace events)
 * - createEventLogger    → EventSink (daemon or agent timeline)
 * - createConsoleSink    → stderr fallback (CLI without daemon)
 */

import type { ContextProvider } from "./context/provider.ts";
import type { EventSink } from "./context/stores/timeline.ts";
import { formatArg, type LogLevel } from "../agent/logger.ts";

// Re-export from canonical source (agent/logger.ts)
export { createSilentLogger, formatArg, type Logger, type LogLevel } from "../agent/logger.ts";

// ==================== Channel Logger ====================

/** Channel logger configuration */
export interface ChannelLoggerConfig {
  /** Context provider to write channel entries */
  provider: ContextProvider;
  /** Source name for channel entries (e.g., "workflow", "loop:agentA") */
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

// ==================== Event Logger (EventSink) ====================

/**
 * Create a logger that writes to an EventSink.
 *
 * Used for daemon-level and agent-level event logging:
 *   - Daemon: createEventLogger(daemonEventLog, "daemon")
 *   - Agent:  createEventLogger(timelineStore, agentName)
 *
 * Same Logger interface as createChannelLogger — consumers don't
 * need to know which sink they're writing to.
 */
export function createEventLogger(sink: EventSink, from?: string): Logger {
  const prefix = from ?? "system";

  const formatContent = (level: LogLevel, message: string, args: unknown[]): string => {
    const argsStr = args.length > 0 ? " " + args.map(formatArg).join(" ") : "";
    if (level === "warn") return `[WARN] ${message}${argsStr}`;
    if (level === "error") return `[ERROR] ${message}${argsStr}`;
    return `${message}${argsStr}`;
  };

  return {
    debug: (message: string, ...args: unknown[]) =>
      sink.append(prefix, formatContent("debug", message, args), { kind: "debug" }),
    info: (message: string, ...args: unknown[]) =>
      sink.append(prefix, formatContent("info", message, args), { kind: "system" }),
    warn: (message: string, ...args: unknown[]) =>
      sink.append(prefix, formatContent("warn", message, args), { kind: "system" }),
    error: (message: string, ...args: unknown[]) =>
      sink.append(prefix, formatContent("error", message, args), { kind: "system" }),
    isDebug: () => true, // Always capture; display layer filters
    child: (childPrefix: string) => createEventLogger(sink, `${prefix}:${childPrefix}`),
  };
}

// ==================== Console Sink (stderr fallback) ====================

/**
 * Create an EventSink that writes to stderr.
 * Used when no daemon is running (CLI direct mode).
 * Drops debug events — stderr should not be noisy.
 */
export function createConsoleSink(): EventSink {
  return {
    append(from: string, content: string, options?: { kind?: string }) {
      if (options?.kind === "debug") return;
      console.error(`[${from}] ${content}`);
    },
  };
}

