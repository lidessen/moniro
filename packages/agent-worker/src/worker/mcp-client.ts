/**
 * MCP Client — connects worker to Daemon MCP server.
 *
 * Provides typed wrappers for calling Daemon MCP tools.
 * Workers use this to pull context (inbox, channel, docs)
 * and to send messages/updates.
 */
import type { InboxMessage, Message } from "../shared/types.ts";
import { TOOLS } from "../shared/constants.ts";

export interface DaemonMcpClient {
  /** Call a daemon MCP tool and return the parsed result */
  call(tool: string, args?: Record<string, unknown>): Promise<unknown>;

  /** Typed helpers */
  myInbox(): Promise<InboxMessage[]>;
  channelRead(options?: { since?: string; limit?: number }): Promise<Message[]>;
  teamDocRead(file?: string): Promise<string | null>;
  teamMembers(): Promise<Array<{ name: string; model: string; state: string }>>;
  channelSend(message: string, to?: string): Promise<{ id: string; recipients: string[] }>;
  myInboxAck(until?: string): Promise<void>;
}

/**
 * Create a Daemon MCP client that communicates over HTTP.
 *
 * For the SDK backend, this wraps direct HTTP calls to the daemon's
 * MCP endpoint. For CLI backends, the MCP connection is handled
 * by the CLI tool itself via --mcp-config.
 */
export function createDaemonClient(daemonMcpUrl: string): DaemonMcpClient {
  async function call(tool: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const res = await fetch(daemonMcpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: { name: tool, arguments: args },
      }),
    });

    if (!res.ok) {
      throw new Error(`MCP call failed: ${res.status} ${res.statusText}`);
    }

    const body = await res.json();
    if (body.error) {
      throw new Error(`MCP error: ${body.error.message}`);
    }

    // MCP tool results come as content array
    const content = body.result?.content;
    if (content?.[0]?.text) {
      return JSON.parse(content[0].text);
    }
    return body.result;
  }

  return {
    call,

    async myInbox() {
      return (await call(TOOLS.MY_INBOX)) as InboxMessage[];
    },

    async channelRead(options) {
      return (await call(TOOLS.CHANNEL_READ, options ?? {})) as Message[];
    },

    async teamDocRead(file) {
      return (await call(TOOLS.TEAM_DOC_READ, file ? { file } : {})) as string | null;
    },

    async teamMembers() {
      return (await call(TOOLS.TEAM_MEMBERS)) as Array<{
        name: string;
        model: string;
        state: string;
      }>;
    },

    async channelSend(message, to) {
      return (await call(TOOLS.CHANNEL_SEND, { message, to })) as {
        id: string;
        recipients: string[];
      };
    },

    async myInboxAck(until) {
      await call(TOOLS.MY_INBOX_ACK, until ? { until } : {});
    },
  };
}
