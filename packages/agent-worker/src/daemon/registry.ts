/**
 * Session Registry — Directory-per-session design.
 *
 * Each session is stored as its own file: sessions/{id}.json
 * Only the owning daemon process writes to its session file.
 * No shared mutable state → no locks needed.
 *
 * Default session ID is stored in a separate file: default
 */

import {
  existsSync,
  unlinkSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BackendType } from "../backends/types.ts";

export const CONFIG_DIR = join(homedir(), ".agent-worker");
export const SESSIONS_DIR = join(CONFIG_DIR, "sessions");

const DEFAULT_FILE = join(CONFIG_DIR, "default");

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

  // Otherwise treat as cron expression
  return { type: "cron", expr: wakeup, prompt };
}

export interface SessionInfo {
  id: string;
  name?: string;
  /** Instance namespace (agents in the same instance share context) */
  instance: string;
  /** Absolute path to context directory (runtime mapping, stored on creation) */
  contextDir: string;
  model: string;
  system: string;
  backend: BackendType;
  socketPath: string;
  pidFile: string;
  readyFile: string;
  pid: number;
  createdAt: string;
  idleTimeout?: number; // ms, 0 = no timeout
  schedule?: ScheduleConfig; // periodic wakeup when idle
}


export function ensureDirs(): void {
  mkdirSync(SESSIONS_DIR, { recursive: true });
}

/** Path to a session's metadata file */
function sessionFile(id: string): string {
  return join(SESSIONS_DIR, `${id}.json`);
}

/** Read all session metadata files from the sessions directory */
function readAllSessions(): SessionInfo[] {
  ensureDirs();
  const entries: SessionInfo[] = [];
  for (const file of readdirSync(SESSIONS_DIR)) {
    if (!file.endsWith(".json")) continue;
    try {
      entries.push(JSON.parse(readFileSync(join(SESSIONS_DIR, file), "utf-8")));
    } catch {
      // Ignore malformed files
    }
  }
  return entries;
}

function readDefault(): string | undefined {
  try {
    return readFileSync(DEFAULT_FILE, "utf-8").trim() || undefined;
  } catch {
    return undefined;
  }
}

export function registerSession(info: SessionInfo): void {
  ensureDirs();
  writeFileSync(sessionFile(info.id), JSON.stringify(info, null, 2));
  // Set as default if it's the first session
  if (!readDefault()) {
    writeFileSync(DEFAULT_FILE, info.id);
  }
}

export function unregisterSession(idOrName: string): void {
  const info = getSessionInfo(idOrName);
  if (!info) return;
  try {
    unlinkSync(sessionFile(info.id));
  } catch {
    // Already removed
  }
  // Update default if needed
  const currentDefault = readDefault();
  if (currentDefault === info.id) {
    const remaining = readAllSessions();
    if (remaining.length > 0) {
      writeFileSync(DEFAULT_FILE, remaining[0]!.id);
    } else {
      try {
        unlinkSync(DEFAULT_FILE);
      } catch {}
    }
  }
}

export function getSessionInfo(idOrName?: string): SessionInfo | null {
  if (!idOrName) {
    // Return default session
    const defaultId = readDefault();
    if (defaultId) {
      return getSessionInfo(defaultId);
    }
    // Return the only session if there's just one
    const sessions = readAllSessions();
    if (sessions.length === 1) {
      return sessions[0] ?? null;
    }
    return null;
  }

  // Try exact ID match (direct file lookup — O(1))
  const filePath = sessionFile(idOrName);
  if (existsSync(filePath)) {
    try {
      return JSON.parse(readFileSync(filePath, "utf-8"));
    } catch {
      return null;
    }
  }

  // Scan for name match or ID prefix match
  const sessions = readAllSessions();

  // Name match
  const byName = sessions.find((s) => s.name === idOrName);
  if (byName) return byName;

  // Prefix match on IDs (supports short IDs like "e8ab33e7")
  const prefixMatches = sessions.filter((s) => s.id.startsWith(idOrName));
  if (prefixMatches.length === 1) {
    return prefixMatches[0]!;
  }

  return null;
}

export function listSessions(): SessionInfo[] {
  return readAllSessions();
}

export function setDefaultSession(idOrName: string): boolean {
  const info = getSessionInfo(idOrName);
  if (!info) return false;
  ensureDirs();
  writeFileSync(DEFAULT_FILE, info.id);
  return true;
}

export function isSessionRunning(idOrName?: string): boolean {
  const info = getSessionInfo(idOrName);
  if (!info) return false;

  try {
    // Check if process exists
    process.kill(info.pid, 0);
    return true;
  } catch {
    // Process doesn't exist, clean up
    if (existsSync(info.socketPath)) {
      unlinkSync(info.socketPath);
    }
    if (existsSync(info.pidFile)) {
      unlinkSync(info.pidFile);
    }
    if (info.readyFile && existsSync(info.readyFile)) {
      unlinkSync(info.readyFile);
    }
    unregisterSession(info.id);
    return false;
  }
}

/**
 * Wait for a session to be ready (ready file exists)
 * Returns session info if ready, null if timeout
 */
export async function waitForReady(
  nameOrId: string | undefined,
  timeoutMs: number = 5000,
): Promise<SessionInfo | null> {
  const start = Date.now();
  const pollInterval = 50;

  while (Date.now() - start < timeoutMs) {
    const info = getSessionInfo(nameOrId);
    if (info?.readyFile && existsSync(info.readyFile)) {
      return info;
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  return null;
}

// ==================== Instance Agents ====================

/**
 * Get all sessions belonging to an instance.
 */
export function getInstanceAgents(instance: string): SessionInfo[] {
  return readAllSessions().filter((s) => s.instance === instance);
}

/**
 * Get agent display names (before @) for all agents in an instance.
 */
export function getInstanceAgentNames(instance: string): string[] {
  return getInstanceAgents(instance)
    .map((s) => {
      if (!s.name) return null;
      const atIndex = s.name.indexOf("@");
      return atIndex === -1 ? s.name : s.name.slice(0, atIndex);
    })
    .filter((n): n is string => n !== null);
}

/**
 * Extract agent display name from session name (part before @).
 */
export function getAgentDisplayName(sessionName: string): string {
  const atIndex = sessionName.indexOf("@");
  return atIndex === -1 ? sessionName : sessionName.slice(0, atIndex);
}

// ==================== Auto-naming ====================

/**
 * Generate next available agent name in sequence: a0, a1, ..., a9, b0, ..., z9.
 * Checks existing sessions to avoid collisions.
 */
export function generateAutoName(): string {
  const sessions = readAllSessions();
  const usedNames = new Set<string>();
  for (const s of sessions) {
    if (s.name) {
      const atIndex = s.name.indexOf("@");
      usedNames.add(atIndex === -1 ? s.name : s.name.slice(0, atIndex));
    }
  }

  for (let letter = 0; letter < 26; letter++) {
    for (let digit = 0; digit < 10; digit++) {
      const name = String.fromCharCode(97 + letter) + digit;
      if (!usedNames.has(name)) return name;
    }
  }

  // Fallback if all 260 names taken
  return `agent-${crypto.randomUUID().slice(0, 6)}`;
}
