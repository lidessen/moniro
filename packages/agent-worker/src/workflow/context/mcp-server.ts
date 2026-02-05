/**
 * Context MCP Server
 * Provides context tools to agents via Model Context Protocol
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ContextProvider } from './provider.js'

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
 * Create an MCP server that exposes context tools
 *
 * Tools provided:
 * - channel_send: Send message to channel (with @mention support)
 * - channel_read: Read and acknowledge mentions
 * - channel_peek: Read without acknowledging
 * - channel_mentions: Get unread mentions
 * - document_read: Read shared document
 * - document_write: Write shared document
 * - document_append: Append to shared document
 * - workflow_agents: List all agents in the workflow (for @mention discovery)
 */
export function createContextMCPServer(options: ContextMCPServerOptions) {
  const { provider, validAgents, name = 'workflow-context', version = '1.0.0' } = options

  const server = new McpServer({
    name,
    version,
  })

  // Track connected agents for notifications
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
    'Read channel messages and acknowledge any mentions for you.',
    {
      since: z.string().optional().describe('Read entries after this timestamp (ISO format)'),
      limit: z.number().optional().describe('Maximum entries to return'),
    },
    async ({ since, limit }, extra) => {
      const agent = getAgentId(extra) || 'anonymous'
      const entries = await provider.readChannel(since, limit)

      // Acknowledge mentions for this agent up to latest entry
      if (entries.length > 0) {
        const latest = entries[entries.length - 1].timestamp
        await provider.acknowledgeMentions(agent, latest)
      }

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

  server.tool(
    'channel_peek',
    'Read channel messages without acknowledging mentions (for preview).',
    {
      limit: z.number().optional().describe('Maximum entries to return'),
    },
    async ({ limit }) => {
      // Peek doesn't acknowledge mentions
      const entries = await provider.readChannel(undefined, limit)

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

  server.tool(
    'channel_mentions',
    'Get unread mentions for you.',
    {
      unread_only: z.boolean().optional().describe('Only return unread mentions (default: true)'),
    },
    async ({ unread_only = true }, extra) => {
      const agent = getAgentId(extra) || 'anonymous'

      const mentions = unread_only ? await provider.getUnreadMentions(agent) : []

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(mentions),
          },
        ],
      }
    }
  )

  // ==================== Document Tools ====================

  server.tool('document_read', 'Read the shared document.', {}, async () => {
    const content = await provider.readDocument()

    return {
      content: [
        {
          type: 'text' as const,
          text: content || '(empty document)',
        },
      ],
    }
  })

  server.tool(
    'document_write',
    'Write/replace the shared document content.',
    {
      content: z.string().describe('New document content (replaces existing)'),
    },
    async ({ content }) => {
      await provider.writeDocument(content)

      return {
        content: [
          {
            type: 'text' as const,
            text: 'Document written successfully',
          },
        ],
      }
    }
  )

  server.tool(
    'document_append',
    'Append content to the shared document.',
    {
      content: z.string().describe('Content to append to the document'),
    },
    async ({ content }) => {
      await provider.appendDocument(content)

      return {
        content: [
          {
            type: 'text' as const,
            text: 'Content appended successfully',
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
