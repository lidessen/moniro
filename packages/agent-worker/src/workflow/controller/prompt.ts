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

  // Project context (what codebase to work on)
  sections.push('## Project')
  sections.push(`Working on: ${ctx.projectDir}`)

  // Inbox section (most important)
  sections.push('')
  sections.push(`## Inbox (${ctx.inbox.length} message${ctx.inbox.length === 1 ? '' : 's'} for you)`)
  sections.push(formatInbox(ctx.inbox))

  // Recent activity section
  sections.push('')
  sections.push(`## Recent Activity (last ${ctx.recentChannel.length} messages)`)
  sections.push(formatChannel(ctx.recentChannel))

  // Shared document section
  if (ctx.documentContent) {
    sections.push('')
    sections.push('## Shared Document')
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
  sections.push('You are an agent in a multi-agent workflow. Communicate ONLY through the MCP tools below.')
  sections.push('Your text output is NOT seen by other agents — you MUST use channel_send to communicate.')
  sections.push('')
  sections.push('### Communication Tools (MCP)')
  sections.push('- **channel_send**: Send a message to the shared channel. Use @agentname to mention/notify other agents.')
  sections.push('  Example: channel_send({ message: "Hey @bob, what is an AI agent?" })')
  sections.push('- **channel_read**: Read recent channel messages.')
  sections.push('- **inbox_check**: Check your unread messages.')
  sections.push('- **inbox_ack**: Acknowledge messages after processing (pass the latest timestamp).')
  sections.push('- **workflow_agents**: List all agents you can @mention.')
  sections.push('')
  sections.push('### Workflow')
  sections.push('1. Read your inbox messages above')
  sections.push('2. Use channel_send with @mentions to communicate with other agents')
  sections.push('3. Acknowledge your inbox with inbox_ack')
  sections.push('4. Exit when done')

  return sections.join('\n')
}
