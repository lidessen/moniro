/**
 * MCP Transport utilities
 * Provides different transport options for the Context MCP Server
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer, type Server as NetServer, type Socket } from "node:net";
import { Readable, Writable } from "node:stream";
import { randomUUID } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";

/**
 * Run MCP server with stdio transport (for testing or CLI wrapper)
 */
export async function runWithStdio(
  server: McpServer,
  options?: {
    stdin?: Readable;
    stdout?: Writable;
  },
): Promise<void> {
  const transport = new StdioServerTransport(
    options?.stdin ?? process.stdin,
    options?.stdout ?? process.stdout,
  );

  await server.connect(transport);
}

/**
 * Unix socket connection state
 */
interface SocketConnection {
  socket: Socket;
  transport: StdioServerTransport;
  agentId?: string;
}

/**
 * Unix socket server result
 */
export interface UnixSocketServer {
  /** The underlying net server */
  netServer: NetServer;
  /** Socket file path */
  socketPath: string;
  /** Active connections by ID */
  connections: Map<string, SocketConnection>;
  /** Close the server and all connections */
  close(): Promise<void>;
  /** Register an agent connection callback */
  onAgentConnect?: (agentId: string, connectionId: string) => void;
  /** Register an agent disconnect callback */
  onAgentDisconnect?: (agentId: string, connectionId: string) => void;
}

/**
 * Run MCP server with Unix socket transport (primary for multi-agent)
 *
 * Each agent connects to the same socket. The server identifies agents
 * via the X-Agent-Id header sent during the initial handshake.
 */
export async function runWithUnixSocket(
  createServerInstance: () => McpServer,
  socketPath: string,
  options?: {
    /** Callback when an agent connects */
    onConnect?: (agentId: string, connectionId: string) => void;
    /** Callback when an agent disconnects */
    onDisconnect?: (agentId: string, connectionId: string) => void;
  },
): Promise<UnixSocketServer> {
  // Remove existing socket file if it exists
  if (existsSync(socketPath)) {
    unlinkSync(socketPath);
  }

  const connections = new Map<string, SocketConnection>();

  const netServer = createServer((socket) => {
    const connectionId = randomUUID();
    let agentId: string | undefined;

    // Create readable/writable streams for this connection
    const readable = new Readable({
      read() {
        // Data is pushed from socket data event
      },
    });

    const writable = new Writable({
      write(chunk, _encoding, callback) {
        if (!socket.destroyed) {
          socket.write(chunk, callback);
        } else {
          callback();
        }
      },
    });

    // Create MCP server instance for this connection
    const mcpServer = createServerInstance();

    // Create transport with socket streams
    const transport = new StdioServerTransport(readable, writable);

    // Handle incoming data
    socket.on("data", (chunk) => {
      // First message might contain X-Agent-Id header
      // Format: X-Agent-Id: <agentId>\n\n<MCP message>
      if (!agentId) {
        const str = chunk.toString();
        const headerMatch = str.match(/^X-Agent-Id:\s*([^\n]+)\n\n/);
        if (headerMatch) {
          agentId = headerMatch[1]!.trim();
          // Set sessionId on transport so MCP SDK passes it to tool handlers as extra.sessionId
          Object.assign(transport, { sessionId: agentId });
          // Remove header from chunk
          const remaining = str.slice(headerMatch[0].length);
          if (remaining) {
            readable.push(Buffer.from(remaining));
          }
          // Update connection with resolved agentId
          const conn = connections.get(connectionId);
          if (conn) {
            conn.agentId = agentId;
          }
          // Notify connection
          if (options?.onConnect) {
            options.onConnect(agentId, connectionId);
          }
          return;
        }
      }
      readable.push(chunk);
    });

    socket.on("end", () => {
      readable.push(null);
    });

    socket.on("close", () => {
      connections.delete(connectionId);
      if (agentId && options?.onDisconnect) {
        options.onDisconnect(agentId, connectionId);
      }
    });

    socket.on("error", (err) => {
      console.error(`Socket error for ${agentId || connectionId}:`, err.message);
      connections.delete(connectionId);
    });

    // Store connection (agentId will be updated when X-Agent-Id header arrives)
    connections.set(connectionId, {
      socket,
      transport,
      agentId,
    });

    // Connect MCP server to transport
    mcpServer.connect(transport).catch((err) => {
      console.error(`MCP connection error for ${agentId || connectionId}:`, err.message);
    });
  });

  // Start listening
  await new Promise<void>((resolve, reject) => {
    netServer.on("error", reject);
    netServer.listen(socketPath, () => {
      netServer.removeListener("error", reject);
      resolve();
    });
  });

  return {
    netServer,
    socketPath,
    connections,
    onAgentConnect: options?.onConnect,
    onAgentDisconnect: options?.onDisconnect,
    async close() {
      // Close all connections
      for (const [, conn] of connections) {
        conn.socket.destroy();
      }
      connections.clear();

      // Close server
      await new Promise<void>((resolve) => {
        netServer.close(() => resolve());
      });

      // Remove socket file
      if (existsSync(socketPath)) {
        unlinkSync(socketPath);
      }
    },
  };
}

/**
 * Generate a unique socket path for a workflow instance
 */
export function getSocketPath(workflowName: string, instance: string): string {
  const tmpDir = process.env.TMPDIR || process.env.TMP || "/tmp";
  return `${tmpDir}/agent-worker-${workflowName}-${instance}.sock`;
}
