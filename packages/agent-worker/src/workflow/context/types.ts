/**
 * Context types for workflow
 * Shared context for agent collaboration via channel + document
 */

/** A single channel entry */
export interface ChannelEntry {
  /** ISO timestamp */
  timestamp: string
  /** Author agent name or 'system' */
  from: string
  /** Message content (preview if attachment exists) */
  message: string
  /** Extracted @mentions */
  mentions: string[]
  /** Path to attachment file (relative to context dir) if message was too long */
  attachment?: string
}

/** Attachment threshold in characters - messages longer than this are stored as attachments */
export const ATTACHMENT_THRESHOLD = 500

/** Attachments directory name */
export const ATTACHMENTS_DIR = 'attachments'

/** Inbox message (unread @mention) */
export interface InboxMessage {
  /** Original channel entry */
  entry: ChannelEntry
  /** Priority level */
  priority: 'normal' | 'high'
}

/** Inbox state (per-agent read cursors) */
export interface InboxState {
  /** Per-agent read cursor: agent name → timestamp of last acknowledged message */
  readCursors: Record<string, string>
}

/**
 * Context configuration in workflow file
 *
 * - undefined (not set): default file provider enabled
 * - false: explicitly disabled
 * - { provider: 'file', config?: {...} }: file provider with optional config
 * - { provider: 'memory' }: memory provider (for testing)
 */
export type ContextConfig = false | FileContextConfig | MemoryContextConfig

/** File-based context provider configuration */
export interface FileContextConfig {
  provider: 'file'
  /** Document owner (single-writer model, optional) */
  documentOwner?: string
  config?: FileProviderConfig
}

/** Memory-based context provider configuration (for testing) */
export interface MemoryContextConfig {
  provider: 'memory'
  /** Document owner (single-writer model, optional) */
  documentOwner?: string
}

/** Configuration for file provider */
export interface FileProviderConfig {
  /** Context directory (default: .workflow/${{ instance }}/) */
  dir?: string
  /** Channel file name (default: channel.md) */
  channel?: string
  /** Document directory (default: documents/) */
  documentDir?: string
  /** Default document file name (default: notes.md) */
  document?: string
}

/** Default context configuration values */
export const CONTEXT_DEFAULTS = {
  dir: '.workflow/${{ instance }}/',
  channel: 'channel.md',
  stateDir: '_state/',
  documentDir: 'documents/',
  document: 'notes.md',
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
    if (agent && validAgents.includes(agent) && !mentions.includes(agent)) {
      mentions.push(agent)
    }
  }

  return mentions
}

/** Urgent keyword pattern */
const URGENT_PATTERN = /\b(urgent|asap|blocked|critical)\b/i

/**
 * Calculate priority for an inbox message
 */
export function calculatePriority(entry: ChannelEntry): 'normal' | 'high' {
  // Multiple mentions = coordination needed
  if (entry.mentions.length > 1) return 'high'

  // Urgent keywords
  if (URGENT_PATTERN.test(entry.message)) return 'high'

  return 'normal'
}
