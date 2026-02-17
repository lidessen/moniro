/**
 * Daemon — the kernel.
 *
 * Single process. Single SQLite file. Sole authority for all state.
 * Lifecycle: start → serve → shutdown.
 */
import { openDatabase, openMemoryDatabase } from "./db.ts";
import { createApp, type HttpDeps } from "./http.ts";
import { ensureGlobalWorkflow } from "./registry.ts";
import { createProcessManager } from "./process-manager.ts";
import { createSchedulerManager } from "./scheduler.ts";
import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";

export interface DaemonOptions {
  /** Database path (default: ~/.agent-worker/agent-worker.db) */
  dbPath?: string;
  /** HTTP port (default: 0 = auto) */
  port?: number;
  /** Host to bind (default: 127.0.0.1) */
  host?: string;
  /** Use in-memory database (for testing) */
  inMemory?: boolean;
}

export interface DaemonHandle {
  db: Database;
  port: number;
  host: string;
  startedAt: number;
  shutdown: () => Promise<void>;
}

/** daemon.json location */
function getDaemonJsonPath(): string {
  return resolve(homedir(), ".agent-worker", "daemon.json");
}

/** Default database path */
function getDefaultDbPath(): string {
  return resolve(homedir(), ".agent-worker", "agent-worker.db");
}

/**
 * Start the daemon.
 */
export async function startDaemon(options: DaemonOptions = {}): Promise<DaemonHandle> {
  const startedAt = Date.now();

  // 1. Open database
  const db = options.inMemory
    ? openMemoryDatabase()
    : (() => {
        const dbPath = options.dbPath ?? getDefaultDbPath();
        const dir = dirname(dbPath);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        return openDatabase(dbPath);
      })();

  // 2. Ensure @global workflow exists
  ensureGlobalWorkflow(db);

  // 3. Mutable state — declared early so shutdown closure can reference them
  let server: ReturnType<typeof Bun.serve> | null = null;
  let isShuttingDown = false;
  let onSignal: (() => void) | null = null;
  let processManager: ReturnType<typeof createProcessManager> | null = null;
  let schedulerManager: ReturnType<typeof createSchedulerManager> | null = null;

  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    // Remove signal handlers to prevent leak
    if (onSignal) {
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
      onSignal = null;
    }

    // Stop schedulers and workers
    schedulerManager?.stopAll();
    processManager?.killAll();

    // Close HTTP server
    if (server) {
      server.stop(true);
      server = null;
    }

    // Close database
    db.close();

    // Remove daemon.json
    const djPath = getDaemonJsonPath();
    try {
      if (existsSync(djPath)) unlinkSync(djPath);
    } catch {
      // ignore
    }
  };

  // 4. Create HTTP app (schedulerManager injected after server starts)
  const deps: HttpDeps = { db, startedAt, shutdown: () => void shutdown() };
  const app = createApp(deps);

  // 5. Start HTTP server
  const host = options.host ?? "127.0.0.1";
  server = Bun.serve({
    port: options.port ?? 0,
    hostname: host,
    fetch: app.fetch,
  });

  const port = server.port;

  // 6. Create process manager + scheduler (needs host:port from server)
  processManager = createProcessManager({ db, daemonHost: host, daemonPort: port });
  schedulerManager = createSchedulerManager({ db, processManager });
  deps.schedulerManager = schedulerManager;

  // 7. Write daemon.json
  if (!options.inMemory) {
    const djPath = getDaemonJsonPath();
    const djDir = dirname(djPath);
    if (!existsSync(djDir)) mkdirSync(djDir, { recursive: true });
    writeFileSync(
      djPath,
      JSON.stringify({ pid: process.pid, host, port, startedAt }, null, 2),
    );
  }

  // 8. Signal handlers (stored for cleanup on shutdown)
  onSignal = () => void shutdown();
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  return { db, port: port!, host, startedAt, shutdown };
}
