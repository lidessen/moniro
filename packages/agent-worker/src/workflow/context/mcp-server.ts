/**
 * Context MCP Server
 * Provides context tools to agents via Model Context Protocol
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ContextProvider } from './provider.js'
import type { InboxMessage } from './types.js'

/**
 * MCP Server options
 */
export interface ContextMCPServerOptions {
  /** Context provider for storage */
  provider: ContextProvider
  /** Valid agent names for @mention validation */
  validAgents: string[]
  /** Server name (default: 'workflow-context') */
  name?: string
  /** Server version (default: '1.0.0') */
  version?: string
}

/**
 * Format inbox messages for display
 */
function formatInbox(messages: InboxMessage[]): string {
  if (messages.length === 0) {
    return JSON.stringify({ messages: [], count: 0 })
  }

  return JSON.stringify({
    messages: messages.map((m) => ({
      from: m.entry.from,
      message: m.entry.message,
      timestamp: m.entry.timestamp,
      priority: m.priority,
    })),
    count: messages.length,
    latestTimestamp: messages[messages.length - 1]!.entry.timestamp,
  })
}

/**
 * Create an MCP server that exposes context tools
 *
 * Tools provided:
 * - channel_send: Send message to channel (with @mention support)
 * - channel_read: Read channel messages (does NOT acknowledge)
 * - inbox_check: Get unread inbox messages (does NOT acknowledge)
 * - inbox_ack: Acknowledge inbox messages up to timestamp
 * - document_read: Read document (supports multiple files)
 * - document_write: Write document (supports multiple files)
 * - document_append: Append to document (supports multiple files)
 * - document_list: List all document files
 * - document_create: Create new document file
 * - workflow_agents: List all agents in the workflow
 */
export function createContextMCPServer(options: ContextMCPServerOptions) {
  const { provider, validAgents, name = 'workflow-context', version = '1.0.0' } = options

  const server = new McpServer({
    name,
    version,
  })

  // Track connected agents for notifications (placeholder for future MCP notification support)
  // Currently unused - MCP SDK doesn't support custom notifications yet
  // When supported, the transport layer will populate this map on agent connect
  const agentConnections = new Map<string, unknown>()

  // ==================== Channel Tools ====================

  server.tool(
    'channel_send',
    'Send a message to the channel. Use @agent to mention other agents.',
    {
      message: z.string().describe('Message to send, can include @mentions like @reviewer or @coder'),
    },
    async ({ message }, extra) => {
      // Agent identity from session (set during connection)
      const from = getAgentId(extra) || 'anonymous'
      const entry = await provider.appendChannel(from, message)

      // Notify mentioned agents via MCP notifications (if connected)
      for (const target of entry.mentions) {
        const conn = agentConnections.get(target)
        if (conn) {
          // TODO: Send notification when MCP SDK supports it
          // await conn.notify('notifications/mention', {
          //   from,
          //   target,
          //   message,
          //   timestamp: entry.timestamp,
          // })
        }
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              status: 'sent',
              timestamp: entry.timestamp,
              mentions: entry.mentions,
            }),
          },
        ],
      }
    }
  )

  server.tool(
    'channel_read',
    'Read channel messages. Does NOT acknowledge inbox - use inbox_ack after processing.',
    {
      since: z.string().optional().describe('Read entries after this timestamp (ISO format)'),
      limit: z.number().optional().describe('Maximum entries to return'),
    },
    async ({ since, limit }) => {
      const entries = await provider.readChannel(since, limit)

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(entries),
          },
        ],
      }
    }
  )

  // ==================== Inbox Tools ====================

  server.tool(
    'inbox_check',
    'Get your unread inbox messages. Does NOT acknowledge - use inbox_ack after processing.',
    {},
    async (_args, extra) => {
      const agent = getAgentId(extra) || 'anonymous'
      const messages = await provider.getInbox(agent)

      return {
        content: [
          {
            type: 'text' as const,
            text: formatInbox(messages),
          },
        ],
      }
    }
  )

  server.tool(
    'inbox_ack',
    'Acknowledge inbox messages up to a timestamp. Call after successfully processing messages.',
    {
      until: z.string().describe('Acknowledge messages up to this timestamp (inclusive)'),
    },
    async ({ until }, extra) => {
      const agent = getAgentId(extra) || 'anonymous'
      await provider.ackInbox(agent, until)

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ status: 'acknowledged', until }),
          },
        ],
      }
    }
  )

  // ==================== Document Tools ====================

  server.tool(
    'document_read',
    'Read a document file.',
    {
      file: z.string().optional().describe('Document file path (default: notes.md)'),
    },
    async ({ file }) => {
      const content = await provider.readDocument(file)

      return {
        content: [
          {
            type: 'text' as const,
            text: content || '(empty document)',
          },
        ],
      }
    }
  )

  server.tool(
    'document_write',
    'Write/replace a document file.',
    {
      content: z.string().describe('New document content (replaces existing)'),
      file: z.string().optional().describe('Document file path (default: notes.md)'),
    },
    async ({ content, file }) => {
      await provider.writeDocument(content, file)

      return {
        content: [
          {
            type: 'text' as const,
            text: `Document ${file || 'notes.md'} written successfully`,
          },
        ],
      }
    }
  )

  server.tool(
    'document_append',
    'Append content to a document file.',
    {
      content: z.string().describe('Content to append to the document'),
      file: z.string().optional().describe('Document file path (default: notes.md)'),
    },
    async ({ content, file }) => {
      await provider.appendDocument(content, file)

      return {
        content: [
          {
            type: 'text' as const,
            text: `Content appended to ${file || 'notes.md'}`,
          },
        ],
      }
    }
  )

  server.tool('document_list', 'List all document files.', {}, async () => {
    const files = await provider.listDocuments()

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ files, count: files.length }),
        },
      ],
    }
  })

  server.tool(
    'document_create',
    'Create a new document file.',
    {
      file: z.string().describe('Document file path (e.g., "findings/auth.md")'),
      content: z.string().describe('Initial document content'),
    },
    async ({ file, content }) => {
      await provider.createDocument(file, content)

      return {
        content: [
          {
            type: 'text' as const,
            text: `Document ${file} created successfully`,
          },
        ],
      }
    }
  )

  // ==================== Workflow Tools ====================

  server.tool(
    'workflow_agents',
    'List all agents in this workflow. Use to discover which agents you can @mention.',
    {},
    async (_args, extra) => {
      const currentAgent = getAgentId(extra) || 'anonymous'

      // Return list of agents with their names
      const agents = validAgents.map((name) => ({
        name,
        mention: `@${name}`,
        isYou: name === currentAgent,
      }))

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              agents,
              count: agents.length,
              hint: 'Use @agent in channel_send to mention other agents',
            }),
          },
        ],
      }
    }
  )

  return {
    server,
    agentConnections,
    validAgents,
  }
}

/**
 * Extract agent ID from MCP extra context
 * The agent ID is set via X-Agent-Id header or session metadata
 */
function getAgentId(extra: unknown): string | undefined {
  if (!extra || typeof extra !== 'object') return undefined

  // Try sessionId first (set by sessionIdGenerator)
  if ('sessionId' in extra && typeof extra.sessionId === 'string') {
    return extra.sessionId
  }

  // Try meta.agentId as fallback
  if ('meta' in extra && extra.meta && typeof extra.meta === 'object') {
    const meta = extra.meta as Record<string, unknown>
    if ('agentId' in meta && typeof meta.agentId === 'string') {
      return meta.agentId
    }
  }

  return undefined
}

export type ContextMCPServer = ReturnType<typeof createContextMCPServer>
