/**
 * Context MCP Server
 * Provides context tools to agents via Model Context Protocol
 *
 * Tool Taxonomy:
 * - Channel:  channel_send, channel_read (public append-only log)
 * - Team:     team_members, team_doc_*, team_proposal_*, team_vote (shared workspace)
 * - My:       my_inbox, my_inbox_ack (personal agent tools)
 * - Resource: resource_create, resource_read (general-purpose reference mechanism)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ContextProvider, SendOptions } from './provider.js'
import type { Message, InboxMessage, ResourceType } from './types.js'
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
  onMention?: (from: string, target: string, msg: Message) => void
  /**
   * Proposal manager for voting tools (optional)
   * If not provided, proposal tools will not be registered
   */
  proposalManager?: ProposalManager
  /**
   * Debug log function for tool calls (optional)
   * When provided, logs all tool calls with agent and parameters
   */
  debugLog?: (message: string) => void
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
      content: m.entry.content,
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
 * Tool taxonomy:
 * - Channel:  channel_send, channel_read
 * - Team:     team_members, team_doc_read, team_doc_write, team_doc_append,
 *             team_doc_list, team_doc_create, team_proposal_create, team_vote,
 *             team_proposal_status, team_proposal_cancel
 * - My:       my_inbox, my_inbox_ack
 * - Resource: resource_create, resource_read
 */
export function createContextMCPServer(options: ContextMCPServerOptions) {
  const {
    provider,
    validAgents,
    name = 'workflow-context',
    version = '1.0.0',
    onMention,
    proposalManager,
    debugLog,
  } = options

  // Helper to log tool calls
  const logTool = (tool: string, agent: string | undefined, params: Record<string, unknown>) => {
    if (debugLog) {
      const agentStr = agent || 'anonymous'
      const paramsStr = Object.entries(params)
        .filter(([_, v]) => v !== undefined)
        .map(([k, v]) => {
          const val = typeof v === 'string' && v.length > 50 ? v.slice(0, 50) + '...' : v
          return `${k}=${JSON.stringify(val)}`
        })
        .join(', ')
      debugLog(`[mcp:${agentStr}] ${tool}(${paramsStr})`)
    }
  }

  const server = new McpServer({
    name,
    version,
  })

  // Track connected agents for notifications (placeholder for future MCP notification support)
  const agentConnections = new Map<string, unknown>()

  // ==================== Channel Tools ====================

  server.tool(
    'channel_send',
    'Send a message to the shared channel. Use @agent to mention/notify. Use "to" for private DMs.',
    {
      message: z.string().describe('Message content, can include @mentions like @reviewer or @coder'),
      to: z.string().optional().describe('Send as DM to a specific agent (private, only you and recipient see it)'),
    },
    async ({ message, to }, extra) => {
      const from = getAgentId(extra) || 'anonymous'
      logTool('channel_send', from, { message, to })
      const sendOpts: SendOptions | undefined = to ? { to } : undefined
      const msg = await provider.appendChannel(from, message, sendOpts)

      // Notify mentioned agents
      for (const target of msg.mentions) {
        if (onMention) {
          onMention(from, target, msg)
        }
      }

      // Also notify DM recipient (even if not @mentioned)
      if (to && !msg.mentions.includes(to) && onMention) {
        onMention(from, to, msg)
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              status: 'sent',
              timestamp: msg.timestamp,
              mentions: msg.mentions,
              to: msg.to,
            }),
          },
        ],
      }
    }
  )

  server.tool(
    'channel_read',
    'Read messages from the shared channel. DMs and logs are automatically filtered based on your identity.',
    {
      since: z.string().optional().describe('Read entries after this timestamp (ISO format)'),
      limit: z.number().optional().describe('Maximum entries to return'),
    },
    async ({ since, limit }, extra) => {
      const agent = getAgentId(extra)
      logTool('channel_read', agent, { since, limit })
      const entries = await provider.readChannel({ since, limit, agent })

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

  // ==================== Resource Tools ====================
  // General-purpose resource reference mechanism.
  // Resources can be referenced from channel messages, documents, or anywhere.

  server.tool(
    'resource_create',
    'Store large content as a resource. Returns a reference (resource:id) usable in channel messages or documents.',
    {
      content: z.string().describe('Content to store as resource'),
      type: z
        .enum(['markdown', 'json', 'text', 'diff'])
        .optional()
        .describe('Content type hint (default: text)'),
    },
    async ({ content, type }, extra) => {
      const createdBy = getAgentId(extra) || 'anonymous'
      logTool('resource_create', createdBy, { type, contentLen: content.length })
      const result = await provider.createResource(content, createdBy, type as ResourceType)

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              id: result.id,
              ref: result.ref,
              hint: `Use [description](${result.ref}) in messages or documents`,
            }),
          },
        ],
      }
    }
  )

  server.tool(
    'resource_read',
    'Read resource content by ID. Use when you encounter resource:id references.',
    {
      id: z.string().describe('Resource ID (e.g., res_abc123)'),
    },
    async ({ id }) => {
      const content = await provider.readResource(id)

      if (content === null) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: `Resource not found: ${id}` }),
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

  // ==================== My Tools (Personal) ====================

  server.tool(
    'my_inbox',
    'Check your unread inbox messages. Does NOT acknowledge — use my_inbox_ack after processing.',
    {},
    async (_args, extra) => {
      const agent = getAgentId(extra) || 'anonymous'
      logTool('my_inbox', agent, {})
      const messages = await provider.getInbox(agent)
      if (debugLog && messages.length > 0) {
        debugLog(`[mcp:${agent}] my_inbox → ${messages.length} unread`)
      }

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
    'my_inbox_ack',
    'Acknowledge inbox messages up to a timestamp. Call after processing messages.',
    {
      until: z.string().describe('Acknowledge messages up to this timestamp (inclusive)'),
    },
    async ({ until }, extra) => {
      const agent = getAgentId(extra) || 'anonymous'
      logTool('my_inbox_ack', agent, { until })
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

  // ==================== Team Tools ====================

  server.tool(
    'team_members',
    'List all agents in this workflow. Use to discover who you can @mention.',
    {},
    async (_args, extra) => {
      const currentAgent = getAgentId(extra) || 'anonymous'

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

  // Team Document Tools

  server.tool(
    'team_doc_read',
    'Read a shared team document.',
    {
      file: z.string().optional().describe('Document file path (default: notes.md)'),
    },
    async ({ file }, extra) => {
      const agent = getAgentId(extra)
      logTool('team_doc_read', agent, { file })
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
    'team_doc_write',
    'Write/replace a shared team document.',
    {
      content: z.string().describe('New document content (replaces existing)'),
      file: z.string().optional().describe('Document file path (default: notes.md)'),
    },
    async ({ content, file }, extra) => {
      const agent = getAgentId(extra)
      logTool('team_doc_write', agent, { file, contentLen: content.length })
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
    'team_doc_append',
    'Append content to a shared team document.',
    {
      content: z.string().describe('Content to append to the document'),
      file: z.string().optional().describe('Document file path (default: notes.md)'),
    },
    async ({ content, file }, extra) => {
      const agent = getAgentId(extra)
      logTool('team_doc_append', agent, { file, contentLen: content.length })
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

  server.tool('team_doc_list', 'List all shared team document files.', {}, async () => {
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
    'team_doc_create',
    'Create a new shared team document file.',
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

  // ==================== Team Proposal Tools ====================
  // Only register if proposal manager is provided

  if (proposalManager) {
    server.tool(
      'team_proposal_create',
      'Create a new proposal for team voting. Use for decisions, elections, approvals, or assignments.',
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
            `Created proposal "${proposal.title}" (${proposal.id})\nOptions: ${optionsList}\nUse team_vote tool to cast your vote.`
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
      'team_vote',
      'Cast your vote on a team proposal.',
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
        await provider.appendChannel(voter, `Voted "${choice}" on ${proposalId}${reasonText}`)

        // If resolved, announce result
        if (result.resolved && result.proposal) {
          const winnerOption = result.proposal.options.find(
            (o) => o.id === result.proposal!.result?.winner
          )
          await provider.appendChannel(
            'system',
            `Proposal ${proposalId} resolved! Winner: ${winnerOption?.label || result.proposal.result?.winner || 'none'}`
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
      'team_proposal_status',
      'Check status of team proposals. Omit proposal ID to see all active proposals.',
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
      'team_proposal_cancel',
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
        await provider.appendChannel(cancelledBy, `Cancelled proposal ${proposalId}`)

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

  // Try sessionId first (set by sessionIdGenerator in HTTP transport)
  // Session ID format: "agentName-uuid8chars" — extract agent name
  if ('sessionId' in extra && typeof extra.sessionId === 'string') {
    const sid = extra.sessionId
    // Strip the trailing "-xxxxxxxx" UUID suffix (8 hex chars)
    const match = sid.match(/^(.+)-[0-9a-f]{8}$/)
    return match ? match[1] : sid
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
