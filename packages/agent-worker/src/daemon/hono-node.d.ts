/**
 * Minimal type declaration for @hono/node-server.
 *
 * Only the serve() function we actually use.
 * The full package provides more, but Bun's module resolution
 * doesn't hoist types — so we declare what we need.
 */

declare module "@hono/node-server" {
  import type { Server } from "node:http";

  export function serve(
    options: {
      fetch: (req: Request) => Response | Promise<Response>;
      port?: number;
      hostname?: string;
    },
    callback?: (info: { port: number; address: string; family: string }) => void,
  ): Server;
}
