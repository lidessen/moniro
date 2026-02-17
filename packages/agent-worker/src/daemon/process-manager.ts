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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Dev: running from src/daemon/ → entry at ../worker/entry.ts
// Built: running from dist/ (chunk files) → entry at worker/entry.mjs
const WORKER_ENTRY = __filename.endsWith(".ts")
  ? resolve(__dirname, "../worker/entry.ts")
  : resolve(__dirname, "worker/entry.mjs");

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

    // Map provider config to env vars so SDK providers and CLI backends can find API keys
    const providerEnv = resolveProviderEnv(fullConfig.agent.provider, fullConfig.agent.model);

    const child = fork(WORKER_ENTRY, [], {
      env: {
        ...process.env,
        ...providerEnv,
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

        // Update DB (best-effort — DB may be closed during shutdown)
        try {
          deps.db.run(
            `UPDATE workers SET state = 'idle', pid = NULL WHERE agent = ? AND workflow = ? AND tag = ?`,
            [config.agent.name, config.workflow, config.tag],
          );
        } catch {
          // DB closed during shutdown — expected race condition
        }

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

// ==================== Provider → Env Var Mapping ====================

/** Env var names per provider for the Vercel AI SDK */
const PROVIDER_ENV_KEYS: Record<string, { apiKey: string; baseUrl?: string }> = {
  anthropic: { apiKey: "ANTHROPIC_API_KEY", baseUrl: "ANTHROPIC_BASE_URL" },
  openai: { apiKey: "OPENAI_API_KEY", baseUrl: "OPENAI_BASE_URL" },
  deepseek: { apiKey: "DEEPSEEK_API_KEY" },
  google: { apiKey: "GOOGLE_GENERATIVE_AI_API_KEY" },
  groq: { apiKey: "GROQ_API_KEY" },
  mistral: { apiKey: "MISTRAL_API_KEY" },
  xai: { apiKey: "XAI_API_KEY" },
};

/**
 * Map provider config to environment variables.
 * Falls back to inferring provider from model string (e.g., "anthropic/claude-sonnet-4-5").
 */
function resolveProviderEnv(
  provider?: { name?: string; apiKey?: string; baseUrl?: string },
  model?: string,
): Record<string, string> {
  if (!provider?.apiKey) return {};

  // Determine provider name: explicit > parsed from model string
  let providerName = provider.name;
  if (!providerName && model) {
    const slash = model.indexOf("/");
    if (slash > 0) providerName = model.slice(0, slash);
    const colon = model.indexOf(":");
    if (!providerName && colon > 0) providerName = model.slice(0, colon);
  }
  if (!providerName) return {};

  const envKeys = PROVIDER_ENV_KEYS[providerName];
  if (!envKeys) return {};

  const env: Record<string, string> = {};
  env[envKeys.apiKey] = provider.apiKey;
  if (provider.baseUrl && envKeys.baseUrl) {
    env[envKeys.baseUrl] = provider.baseUrl;
  }
  return env;
}
