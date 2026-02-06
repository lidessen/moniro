/**
 * Context MCP Server
 * Provides context tools to agents via Model Context Protocol
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ContextProvider } from './provider.js'
import type { ChannelEntry, InboxMessage, AttachmentType } from './types.js'
import { formatProposal, formatProposalList, type ProposalManager } from './proposals.js'

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
  /**
   * Callback when an agent is @mentioned in channel_send
   * Used by controller to wake agents on mention
   */
  onMention?: (from: string, target: string, entry: ChannelEntry) => void
  /**
   * Proposal manager for voting tools (optional)
   * If not provided, proposal tools will not be registered
   */
  proposalManager?: ProposalManager
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
 * - attachment_create: Create attachment, returns ID and ref for markdown links
 * - attachment_read: Read attachment content by ID
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
  const {
    provider,
    validAgents,
    name = 'workflow-context',
    version = '1.0.0',
    onMention,
    proposalManager,
  } = options

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

      // Notify mentioned agents
      for (const target of entry.mentions) {
        // Call onMention callback (used by controller to wake agents)
        if (onMention) {
          onMention(from, target, entry)
        }

        // Also try MCP notifications (if connected)
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

  server.tool(
    'attachment_create',
    'Create an attachment for large content. Returns ID and ref for use in markdown links like [title](attachment:id)',
    {
      content: z.string().describe('Content to store as attachment'),
      type: z
        .enum(['markdown', 'json', 'text', 'diff'])
        .optional()
        .describe('Content type hint (default: text)'),
    },
    async ({ content, type }, extra) => {
      const createdBy = getAgentId(extra) || 'anonymous'
      const result = await provider.createAttachment(content, createdBy, type as AttachmentType)

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              id: result.id,
              ref: result.ref,
              hint: `Use [description](${result.ref}) in your message`,
            }),
          },
        ],
      }
    }
  )

  server.tool(
    'attachment_read',
    'Read attachment content by ID. Use when a message contains attachment:id references.',
    {
      id: z.string().describe('Attachment ID (e.g., att_abc123)'),
    },
    async ({ id }) => {
      const content = await provider.readAttachment(id)

      if (content === null) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: `Attachment not found: ${id}` }),
            },
          ],
        }
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: content,
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

  // ==================== Proposal Tools ====================
  // Only register if proposal manager is provided

  if (proposalManager) {
    server.tool(
      'proposal_create',
      'Create a new proposal for voting. Use for decisions, elections, approvals, or assignments.',
      {
        type: z.enum(['election', 'decision', 'approval', 'assignment']).describe('Type of proposal'),
        title: z.string().describe('Brief title for the proposal'),
        description: z.string().optional().describe('Detailed description'),
        options: z
          .array(
            z.object({
              id: z.string().describe('Unique option identifier'),
              label: z.string().describe('Display label for the option'),
            })
          )
          .optional()
          .describe('Voting options (required except for approval type)'),
        resolution: z
          .object({
            type: z
              .enum(['plurality', 'majority', 'unanimous'])
              .optional()
              .describe('How to determine winner'),
            quorum: z.number().optional().describe('Minimum votes required'),
            tieBreaker: z
              .enum(['first', 'random', 'creator-decides'])
              .optional()
              .describe('How to break ties'),
          })
          .optional()
          .describe('Resolution rules'),
        binding: z.boolean().optional().describe('Whether result is binding (default: true)'),
        timeoutSeconds: z.number().optional().describe('Timeout in seconds (default: 3600)'),
      },
      async (params, extra) => {
        const createdBy = getAgentId(extra) || 'anonymous'

        try {
          const proposal = proposalManager.create({
            type: params.type,
            title: params.title,
            description: params.description,
            options: params.options,
            resolution: params.resolution,
            binding: params.binding,
            timeoutSeconds: params.timeoutSeconds,
            createdBy,
          })

          // Announce in channel
          const optionsList = proposal.options.map((o) => `${o.id}: ${o.label}`).join(', ')
          await provider.appendChannel(
            createdBy,
            `📋 Created proposal "${proposal.title}" (${proposal.id})\nOptions: ${optionsList}\nUse vote tool to cast your vote.`
          )

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  status: 'created',
                  proposal: {
                    id: proposal.id,
                    title: proposal.title,
                    options: proposal.options,
                    expiresAt: proposal.expiresAt,
                  },
                }),
              },
            ],
          }
        } catch (error) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  status: 'error',
                  error: error instanceof Error ? error.message : String(error),
                }),
              },
            ],
          }
        }
      }
    )

    server.tool(
      'vote',
      'Cast your vote on a proposal.',
      {
        proposal: z.string().describe('Proposal ID (e.g., prop-1)'),
        choice: z.string().describe('Option ID to vote for'),
        reason: z.string().optional().describe('Optional reason for your vote'),
      },
      async ({ proposal: proposalId, choice, reason }, extra) => {
        const voter = getAgentId(extra) || 'anonymous'

        const result = proposalManager.vote({
          proposalId,
          voter,
          choice,
          reason,
        })

        if (!result.success) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ status: 'error', error: result.error }),
              },
            ],
          }
        }

        // Announce vote in channel
        const reasonText = reason ? ` (reason: ${reason})` : ''
        await provider.appendChannel(voter, `🗳️ Voted "${choice}" on ${proposalId}${reasonText}`)

        // If resolved, announce result
        if (result.resolved && result.proposal) {
          const winnerOption = result.proposal.options.find(
            (o) => o.id === result.proposal!.result?.winner
          )
          await provider.appendChannel(
            'system',
            `✅ Proposal ${proposalId} resolved! Winner: ${winnerOption?.label || result.proposal.result?.winner || 'none'}`
          )
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                status: 'voted',
                proposal: proposalId,
                choice,
                resolved: result.resolved,
                winner: result.proposal?.result?.winner,
              }),
            },
          ],
        }
      }
    )

    server.tool(
      'proposal_status',
      'Check status of proposals. Omit proposal ID to see all active proposals.',
      {
        proposal: z.string().optional().describe('Proposal ID (omit for all active)'),
      },
      async ({ proposal: proposalId }) => {
        if (proposalId) {
          const proposal = proposalManager.get(proposalId)
          if (!proposal) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({ status: 'error', error: `Proposal not found: ${proposalId}` }),
                },
              ],
            }
          }

          return {
            content: [
              {
                type: 'text' as const,
                text: formatProposal(proposal),
              },
            ],
          }
        }

        // List all active proposals
        const activeProposals = proposalManager.list('active')

        return {
          content: [
            {
              type: 'text' as const,
              text:
                activeProposals.length > 0
                  ? formatProposalList(activeProposals)
                  : '(no active proposals)',
            },
          ],
        }
      }
    )

    server.tool(
      'proposal_cancel',
      'Cancel a proposal you created.',
      {
        proposal: z.string().describe('Proposal ID to cancel'),
      },
      async ({ proposal: proposalId }, extra) => {
        const cancelledBy = getAgentId(extra) || 'anonymous'

        const result = proposalManager.cancel(proposalId, cancelledBy)

        if (!result.success) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ status: 'error', error: result.error }),
              },
            ],
          }
        }

        // Announce cancellation
        await provider.appendChannel(cancelledBy, `❌ Cancelled proposal ${proposalId}`)

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ status: 'cancelled', proposal: proposalId }),
            },
          ],
        }
      }
    )
  }

  return {
    server,
    agentConnections,
    validAgents,
    proposalManager,
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
