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
  /** Message content */
  message: string
  /** Extracted @mentions */
  mentions: string[]
}

// ==================== Attachment System ====================

/** Attachment metadata */
export interface Attachment {
  /** Unique ID (e.g., att_abc123) */
  id: string
  /** Content type hint */
  type: AttachmentType
  /** ISO timestamp of creation */
  createdAt: string
  /** Agent who created the attachment */
  createdBy: string
}

/** Attachment content types */
export type AttachmentType = 'markdown' | 'json' | 'text' | 'diff'

/** Attachment creation result */
export interface AttachmentResult {
  /** Unique ID */
  id: string
  /** Ready-to-use markdown reference: attachment:id */
  ref: string
}

/** Attachment ID prefix */
export const ATTACHMENT_PREFIX = 'att_'

/** Attachment URI scheme */
export const ATTACHMENT_SCHEME = 'attachment:'

/** Attachments storage directory name */
export const ATTACHMENTS_DIR = 'attachments'

/** Attachment threshold in characters - messages longer than this should use attachments */
export const ATTACHMENT_THRESHOLD = 500

/**
 * Generate a unique attachment ID
 */
export function generateAttachmentId(): string {
  // Use timestamp + random for uniqueness
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 8)
  return `${ATTACHMENT_PREFIX}${timestamp}${random}`
}

/**
 * Create attachment reference for use in markdown
 * Example: attachment:att_abc123
 */
export function createAttachmentRef(id: string): string {
  return `${ATTACHMENT_SCHEME}${id}`
}

/**
 * Parse attachment reference from markdown link
 * Extracts ID from "attachment:att_xxx" format
 */
export function parseAttachmentRef(ref: string): string | null {
  if (ref.startsWith(ATTACHMENT_SCHEME)) {
    return ref.slice(ATTACHMENT_SCHEME.length)
  }
  return null
}

/**
 * Check if a string is an attachment ID
 */
export function isAttachmentId(str: string): boolean {
  return str.startsWith(ATTACHMENT_PREFIX)
}

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
