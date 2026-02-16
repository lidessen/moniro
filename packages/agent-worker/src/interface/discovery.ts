/**
 * Daemon discovery — find running daemon via daemon.json.
 *
 * The daemon writes ~/.agent-worker/daemon.json on startup with
 * { pid, host, port, startedAt }. Clients read this to connect.
 */
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";

export interface DaemonInfo {
  pid: number;
  host: string;
  port: number;
  startedAt: number;
}

/** Config directory */
export const CONFIG_DIR = resolve(homedir(), ".agent-worker");

/** daemon.json path */
export const DAEMON_JSON = resolve(CONFIG_DIR, "daemon.json");

/**
 * Read daemon.json. Returns null if missing or malformed.
 */
export function readDaemonInfo(): DaemonInfo | null {
  try {
    if (!existsSync(DAEMON_JSON)) return null;
    return JSON.parse(readFileSync(DAEMON_JSON, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Check if daemon is running (daemon.json exists + PID alive).
 * Cleans up stale daemon.json if PID is dead.
 */
export function findDaemon(): DaemonInfo | null {
  const info = readDaemonInfo();
  if (!info) return null;

  try {
    process.kill(info.pid, 0);
    return info;
  } catch {
    // PID dead — clean up stale file
    try {
      unlinkSync(DAEMON_JSON);
    } catch {
      // ignore
    }
    return null;
  }
}

/**
 * Ensure daemon is running. Spawns one if not found.
 * Returns daemon info on success, throws on failure.
 */
export async function ensureDaemon(options?: {
  port?: number;
  host?: string;
}): Promise<DaemonInfo> {
  const existing = findDaemon();
  if (existing) return existing;

  // Spawn daemon as background process
  const scriptPath = process.argv[1] ?? "";
  const args = [scriptPath, "daemon"];
  if (options?.port) args.push("--port", String(options.port));
  if (options?.host) args.push("--host", options.host);

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  // Wait for daemon.json to appear (max 5s)
  const maxWait = 5000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const info = findDaemon();
    if (info) return info;
    await new Promise((r) => setTimeout(r, 100));
  }

  throw new Error("Failed to start daemon within 5s");
}
