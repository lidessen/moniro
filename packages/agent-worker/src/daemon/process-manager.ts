/**
 * Process Manager — spawn, monitor, kill worker child processes.
 *
 * Daemon-side concern. Workers are independent child processes
 * that communicate via IPC (control) and MCP over HTTP (data).
 */
import { fork } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "bun:sqlite";
import type { WorkerConfig, WorkerIpcMessage, SessionResult } from "../shared/types.ts";
import { DEFAULT_WORKER_TIMEOUT } from "../shared/constants.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_ENTRY = resolve(__dirname, "../worker/entry.ts");

export interface SpawnResult {
  /** OS process ID */
  pid: number;
  /** Resolves when worker completes */
  promise: Promise<SessionResult>;
  /** Kill the worker process */
  kill: () => void;
}

export interface ProcessManagerDeps {
  db: Database;
  daemonHost: string;
  daemonPort: number;
}

export function createProcessManager(deps: ProcessManagerDeps) {
  const active = new Map<string, SpawnResult>();

  /**
   * Spawn a worker child process.
   */
  function spawn(config: WorkerConfig, timeout?: number): SpawnResult {
    const key = `${config.agent.name}@${config.workflow}:${config.tag}`;

    // Build daemon MCP URL with agent identity
    const daemonMcpUrl = `http://${deps.daemonHost}:${deps.daemonPort}/mcp?agent=${config.agent.name}`;
    const fullConfig: WorkerConfig = { ...config, daemonMcpUrl };

    const child = fork(WORKER_ENTRY, [], {
      env: {
        ...process.env,
        WORKER_CONFIG: JSON.stringify(fullConfig),
      },
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    });

    const pid = child.pid!;

    // Update worker state in DB
    deps.db.run(
      `INSERT OR REPLACE INTO workers (agent, workflow, tag, pid, state, started_at)
       VALUES (?, ?, ?, ?, 'running', ?)`,
      [config.agent.name, config.workflow, config.tag, pid, Date.now()],
    );

    const promise = new Promise<SessionResult>((resolve, reject) => {
      let result: SessionResult | null = null;
      let timedOut = false;

      // Timeout protection
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 5000);
        reject(new Error(`Worker ${key} timed out after ${timeout ?? DEFAULT_WORKER_TIMEOUT}ms`));
      }, timeout ?? DEFAULT_WORKER_TIMEOUT);

      // IPC messages from worker
      child.on("message", (msg: WorkerIpcMessage) => {
        if (msg.type === "result") {
          result = msg.data;
        } else if (msg.type === "error") {
          reject(new Error(`Worker ${key} error: ${msg.error}`));
        }
      });

      // Capture stderr for diagnostics
      let stderr = "";
      child.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      // Process exit
      child.on("exit", (code) => {
        clearTimeout(timer);
        active.delete(key);

        // Update DB
        deps.db.run(
          `UPDATE workers SET state = 'idle', pid = NULL WHERE agent = ? AND workflow = ? AND tag = ?`,
          [config.agent.name, config.workflow, config.tag],
        );

        if (timedOut) return; // Already rejected

        if (result) {
          resolve(result);
        } else if (code === 0) {
          resolve({ content: "" });
        } else {
          reject(
            new Error(
              `Worker ${key} exited with code ${code}${stderr ? `: ${stderr.slice(0, 500)}` : ""}`,
            ),
          );
        }
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        active.delete(key);
        reject(new Error(`Worker ${key} spawn error: ${err.message}`));
      });
    });

    const spawnResult: SpawnResult = {
      pid,
      promise,
      kill: () => child.kill("SIGTERM"),
    };

    active.set(key, spawnResult);
    return spawnResult;
  }

  /**
   * Kill all active workers.
   */
  function killAll(): void {
    for (const [, worker] of active) {
      worker.kill();
    }
    active.clear();
  }

  /**
   * Get number of active workers.
   */
  function activeCount(): number {
    return active.size;
  }

  return { spawn, killAll, activeCount };
}
