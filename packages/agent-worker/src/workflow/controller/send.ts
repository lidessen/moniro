/**
 * CLI Send Command Utilities
 * Target pattern parsing and message routing
 */

import type { ContextProvider } from '../../context/provider.ts'

/**
 * Send target types
 */
export type SendTargetType = 'standalone' | 'workflow-agent' | 'workflow-channel'

/**
 * Parsed send target
 */
export interface ParsedSendTarget {
  /** Target type */
  type: SendTargetType
  /** Agent name (for standalone and workflow-agent) */
  agent?: string
  /** Workflow instance (for workflow-agent and workflow-channel) */
  instance?: string
}

/**
 * Parse send target pattern
 *
 * Patterns:
 * - `agent` → standalone agent
 * - `agent@instance` → workflow agent (channel with @mention)
 * - `@instance` → workflow channel (broadcast)
 *
 * @param target Target string (e.g., "reviewer", "reviewer@default", "@default")
 * @returns Parsed target with type and components
 */
export function parseSendTarget(target: string): ParsedSendTarget {
  // @instance → workflow channel broadcast
  if (target.startsWith('@') && !target.includes('@', 1)) {
    return {
      type: 'workflow-channel',
      instance: target.slice(1),
    }
  }

  // agent@instance → workflow agent
  if (target.includes('@')) {
    const [agent, instance] = target.split('@')
    return {
      type: 'workflow-agent',
      agent,
      instance,
    }
  }

  // agent → standalone
  return {
    type: 'standalone',
    agent: target,
  }
}

/**
 * Send message result
 */
export interface SendResult {
  /** Success status */
  success: boolean
  /** Target type that was used */
  type: SendTargetType
  /** Timestamp of sent message (for workflow targets) */
  timestamp?: string
  /** Error message if failed */
  error?: string
}

/**
 * Send message to workflow channel
 *
 * @param provider Context provider for the workflow
 * @param from Sender name (usually 'user' for CLI)
 * @param message Message content
 * @param mention Optional agent to @mention
 */
export async function sendToWorkflowChannel(
  provider: ContextProvider,
  from: string,
  message: string,
  mention?: string
): Promise<SendResult> {
  try {
    // Add @mention if specified
    const fullMessage = mention ? `@${mention} ${message}` : message

    const entry = await provider.appendChannel(from, fullMessage)

    return {
      success: true,
      type: mention ? 'workflow-agent' : 'workflow-channel',
      timestamp: entry.timestamp,
    }
  } catch (error) {
    return {
      success: false,
      type: mention ? 'workflow-agent' : 'workflow-channel',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Format sender name for user messages
 * Uses [user] format to distinguish from agent messages
 */
export function formatUserSender(username?: string): string {
  return username ? `user:${username}` : 'user'
}
