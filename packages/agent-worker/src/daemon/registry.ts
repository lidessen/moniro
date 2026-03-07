/**
 * Daemon Registry
 *
 * Discovery: daemon.json = { pid, host, port, startedAt, token }
 * One daemon process on a fixed port. Clients read daemon.json to find it.
 */

import { existsSync, unlinkSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CONFIG_DIR = join(homedir(), ".agent-worker");
export const DEFAULT_PORT = 5099;

const DAEMON_FILE = join(CONFIG_DIR, "daemon.json");

// ── Daemon Discovery ─────────────────────────────────────────────

export interface DaemonInfo {
  pid: number;
  host: string;
  port: number;
  startedAt: string;
  /** Auth token for API access (random per daemon instance) */
  token?: string;
}

/** Write daemon.json for client discovery */
export function writeDaemonInfo(info: DaemonInfo): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(DAEMON_FILE, JSON.stringify(info, null, 2));
}

/** Read daemon.json. Returns null if missing or malformed. */
export function readDaemonInfo(): DaemonInfo | null {
  try {
    return JSON.parse(readFileSync(DAEMON_FILE, "utf-8"));
  } catch {
    return null;
  }
}

/** Remove daemon.json (on shutdown) */
export function removeDaemonInfo(): void {
  try {
    unlinkSync(DAEMON_FILE);
  } catch {
    // Already removed
  }
}

/** Check if a daemon is already running (daemon.json exists + PID alive) */
export function isDaemonRunning(): DaemonInfo | null {
  const info = readDaemonInfo();
  if (!info) return null;
  try {
    process.kill(info.pid, 0);
    return info;
  } catch {
    // PID dead, clean up stale daemon.json
    removeDaemonInfo();
    return null;
  }
}
