/**
 * WorkerHandle — Execution contract between daemon and worker.
 *
 * The daemon talks to workers ONLY through this interface.
 * Workers can be local (in-process) or remote (HTTP).
 * State management is the worker's internal concern.
 */

import type { AgentResponse, SessionState } from "./types.ts";
import type { SendOptions } from "./worker.ts";
import { AgentWorker } from "./worker.ts";
import type { AgentConfig } from "./config.ts";
import { createBackend } from "../backends/index.ts";

// ── Interface ──────────────────────────────────────────────────────

export interface WorkerHandle {
  /** Send a message synchronously */
  send(input: string, options?: SendOptions): Promise<AgentResponse>;

  /** Send a message with streaming response */
  sendStream(input: string, options?: SendOptions): AsyncGenerator<string, AgentResponse>;

  /** Snapshot current conversation state (for persistence) */
  getState(): SessionState;
}

// ── LocalWorker ────────────────────────────────────────────────────

/**
 * LocalWorker — In-process execution via AgentWorker.
 *
 * Wraps an AgentWorker instance. State lives in the AgentWorker's memory.
 * This is the default for single-machine deployments.
 */
export class LocalWorker implements WorkerHandle {
  private engine: AgentWorker;

  constructor(config: AgentConfig, restore?: SessionState) {
    const backend =
      config.backend !== "default"
        ? createBackend({ type: config.backend, model: config.model } as Parameters<
            typeof createBackend
          >[0])
        : undefined;

    this.engine = new AgentWorker(
      {
        model: config.model,
        system: config.system,
        tools: {},
        backend,
        provider: config.provider,
      },
      restore,
    );
  }

  send(input: string, options?: SendOptions): Promise<AgentResponse> {
    return this.engine.send(input, options);
  }

  sendStream(input: string, options?: SendOptions): AsyncGenerator<string, AgentResponse> {
    return this.engine.sendStream(input, options);
  }

  getState(): SessionState {
    return this.engine.getState();
  }
}
