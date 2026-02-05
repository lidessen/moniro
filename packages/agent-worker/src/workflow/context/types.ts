/**
 * Context types for workflow v2
 * Shared context for agent collaboration via channel + document
 */

/** A single channel entry */
export interface ChannelEntry {
  /** ISO timestamp */
  timestamp: string
  /** Author agent name or 'system' */
  from: string
  /** Message content */
  message: string
  /** Extracted @mentions */
  mentions: string[]
}

/** @mention notification */
export interface MentionNotification {
  /** Who sent the message */
  from: string
  /** Who was mentioned */
  target: string
  /** The message content */
  message: string
  /** Entry timestamp */
  timestamp: string
}

/** Context configuration in workflow file */
export interface ContextConfig {
  /** Context directory (default: .workflow/${{ instance }}/) */
  dir?: string

  /** Channel config (null/empty = defaults, undefined = disabled) */
  channel?: ChannelConfig | null

  /** Document config (null/empty = defaults, undefined = disabled) */
  document?: DocumentConfig | null
}

export interface ChannelConfig {
  file?: string // default: channel.md
}

export interface DocumentConfig {
  file?: string // default: notes.md
}

/** Default context configuration values */
export const CONTEXT_DEFAULTS = {
  dir: '.workflow/default/',
  channel: {
    file: 'channel.md',
  },
  document: {
    file: 'notes.md',
  },
} as const

/** Mention pattern for extracting @mentions */
export const MENTION_PATTERN = /@([a-zA-Z][a-zA-Z0-9_-]*)/g

/**
 * Extract @mentions from a message
 */
export function extractMentions(message: string, validAgents: string[]): string[] {
  const mentions: string[] = []
  let match: RegExpExecArray | null

  // Reset regex state
  MENTION_PATTERN.lastIndex = 0

  while ((match = MENTION_PATTERN.exec(message)) !== null) {
    const agent = match[1]
    if (validAgents.includes(agent) && !mentions.includes(agent)) {
      mentions.push(agent)
    }
  }

  return mentions
}
