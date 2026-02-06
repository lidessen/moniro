/**
 * Agent Prompt Building
 * Helpers for building agent prompts from context
 */

import type { ChannelEntry, InboxMessage } from '../context/types.ts'
import type { AgentRunContext } from './types.ts'

/**
 * Format inbox messages for display
 */
export function formatInbox(inbox: InboxMessage[]): string {
  if (inbox.length === 0) return '(no messages)'

  return inbox
    .map((m) => {
      const priority = m.priority === 'high' ? ' [HIGH]' : ''
      const time = m.entry.timestamp.slice(11, 19)
      return `- [${time}] From @${m.entry.from}${priority}: ${m.entry.message}`
    })
    .join('\n')
}

/**
 * Format channel entries for display
 */
export function formatChannel(entries: ChannelEntry[]): string {
  if (entries.length === 0) return '(no messages)'

  return entries
    .map((e) => `[${e.timestamp.slice(11, 19)}] @${e.from}: ${e.message}`)
    .join('\n')
}

/**
 * Build the complete agent prompt from run context
 */
export function buildAgentPrompt(ctx: AgentRunContext): string {
  const sections: string[] = []

  // Inbox section (most important)
  sections.push(`## Inbox (${ctx.inbox.length} message${ctx.inbox.length === 1 ? '' : 's'} for you)`)
  sections.push(formatInbox(ctx.inbox))

  // Recent activity section
  sections.push('')
  sections.push(`## Recent Activity (last ${ctx.recentChannel.length} messages)`)
  sections.push(formatChannel(ctx.recentChannel))

  // Current workspace section
  if (ctx.documentContent) {
    sections.push('')
    sections.push('## Current Workspace')
    sections.push(ctx.documentContent)
  }

  // Retry notice
  if (ctx.retryAttempt > 1) {
    sections.push('')
    sections.push(`## Note`)
    sections.push(`This is retry attempt ${ctx.retryAttempt}. Previous attempt failed.`)
  }

  // Instructions section
  sections.push('')
  sections.push('## Instructions')
  sections.push('Process your inbox messages. Use MCP tools to collaborate with other agents.')
  sections.push('When done handling all messages, exit.')

  return sections.join('\n')
}
