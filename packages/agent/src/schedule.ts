/**
 * Schedule configuration — agent-level scheduling types and resolution.
 *
 * Canonical source for ScheduleConfig, ResolvedSchedule, parseDuration, resolveSchedule.
 * These are part of the agent definition (agents own their wakeup schedule).
 */

import { parseCron } from "./cron.ts";

/**
 * Schedule configuration for periodic agent wakeup.
 *
 * The `wakeup` field accepts three mutually exclusive formats:
 * - **number (ms)**: idle-based interval, resets on activity. e.g. `60000`
 * - **duration string**: idle-based interval, resets on activity. e.g. `"30s"`, `"5m"`, `"2h"`
 * - **cron expression**: fixed schedule, NOT reset by activity. e.g. `"0 9 * * 1-5"`
 */
export interface ScheduleConfig {
  /** Wakeup schedule: number (ms), duration string ("30s"/"5m"/"2h"), or cron expression. */
  wakeup: string | number;
  /** Custom wakeup prompt (default provided by daemon). */
  prompt?: string;
}

export interface ResolvedSchedule {
  type: "interval" | "cron";
  /** ms for interval type */
  ms?: number;
  /** cron expression for cron type */
  expr?: string;
  /** custom prompt */
  prompt?: string;
}

const DURATION_RE = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/;

/**
 * Parse a duration string like "30s", "5m", "2h" into milliseconds.
 * Returns null if not a valid duration format.
 */
export function parseDuration(value: string): number | null {
  const match = value.match(DURATION_RE);
  if (!match) return null;

  const amount = parseFloat(match[1]!);
  const unit = match[2]!;

  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return amount * multipliers[unit]!;
}

/**
 * Resolve a wakeup value into a typed schedule.
 * - number → interval (ms)
 * - "30s"/"5m"/"2h" → interval (converted to ms)
 * - cron expression → cron
 *
 * Validates cron expressions eagerly (throws on invalid syntax).
 */
export function resolveSchedule(config: ScheduleConfig): ResolvedSchedule {
  const { wakeup, prompt } = config;

  // Number → interval in ms
  if (typeof wakeup === "number") {
    if (wakeup <= 0) throw new Error("Wakeup interval must be positive");
    return { type: "interval", ms: wakeup, prompt };
  }

  // Duration string → interval
  const ms = parseDuration(wakeup);
  if (ms !== null) {
    if (ms <= 0) throw new Error("Wakeup duration must be positive");
    return { type: "interval", ms, prompt };
  }

  // Otherwise treat as cron expression — validate eagerly
  parseCron(wakeup);
  return { type: "cron", expr: wakeup, prompt };
}
