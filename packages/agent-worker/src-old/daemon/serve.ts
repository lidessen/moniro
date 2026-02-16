/**
 * Runtime-agnostic HTTP server for Hono apps.
 *
 * Default: Node.js via @hono/node-server
 * When running in Bun: uses Bun.serve() for native performance
 *
 * The daemon and all callers use ServerHandle — they never
 * touch runtime-specific server APIs directly.
 */

import type { Hono } from "hono";

export interface ServerHandle {
  /** Actual port the server is listening on */
  port: number;
  /** Gracefully close the server */
  close(): Promise<void>;
}

export interface ServeOptions {
  port: number;
  hostname?: string;
}

/**
 * Start an HTTP server for a Hono app.
 * Auto-detects runtime: Bun.serve() when available, @hono/node-server otherwise.
 */
export async function startHttpServer(app: Hono, options: ServeOptions): Promise<ServerHandle> {
  if (typeof globalThis.Bun !== "undefined") {
    return startBun(app, options);
  }
  return startNode(app, options);
}

// ── Bun ──────────────────────────────────────────────────────────

function startBun(app: Hono, options: ServeOptions): ServerHandle {
  const server = Bun.serve({
    fetch: app.fetch,
    port: options.port,
    hostname: options.hostname,
  });

  return {
    port: server.port ?? options.port,
    close: async () => server.stop(true),
  };
}

// ── Node.js ──────────────────────────────────────────────────────

async function startNode(app: Hono, options: ServeOptions): Promise<ServerHandle> {
  // Dynamic import — only loaded when running on Node.js
  const mod = await import("@hono/node-server");

  return new Promise<ServerHandle>((resolve, reject) => {
    const server = mod.serve(
      {
        fetch: app.fetch as Parameters<typeof mod.serve>[0]["fetch"],
        port: options.port,
        hostname: options.hostname,
      },
      (info: { port: number }) => {
        resolve({
          port: info.port,
          close: () => new Promise<void>((r) => server.close(() => r())),
        });
      },
    );

    server.on("error", reject);
  });
}
