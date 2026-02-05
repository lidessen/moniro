/**
 * Context Provider interface
 * Abstract storage layer for channel and document operations
 */

import type { ChannelEntry, MentionNotification } from './types.js'

/**
 * Context Provider interface - storage abstraction for workflow context
 *
 * Implementations:
 * - MemoryContextProvider: In-memory storage for testing
 * - FileContextProvider: File-based storage with markdown format
 */
export interface ContextProvider {
  /**
   * Append a message to the channel
   * @param from - Agent name or 'system'
   * @param message - Message content (may include @mentions)
   * @returns The created channel entry with extracted mentions
   */
  appendChannel(from: string, message: string): Promise<ChannelEntry>

  /**
   * Read channel entries
   * @param since - Optional timestamp to read entries after
   * @param limit - Optional max entries to return
   * @returns Array of channel entries
   */
  readChannel(since?: string, limit?: number): Promise<ChannelEntry[]>

  /**
   * Get unread mentions for an agent
   * @param agent - Agent name to get mentions for
   * @returns Array of unread mention notifications
   */
  getUnreadMentions(agent: string): Promise<MentionNotification[]>

  /**
   * Acknowledge mentions up to a timestamp
   * @param agent - Agent name acknowledging
   * @param until - Timestamp to acknowledge up to
   */
  acknowledgeMentions(agent: string, until: string): Promise<void>

  /**
   * Read the shared document
   * @returns Document content (empty string if not exists)
   */
  readDocument(): Promise<string>

  /**
   * Write/replace the shared document
   * @param content - New document content
   */
  writeDocument(content: string): Promise<void>

  /**
   * Append to the shared document
   * @param content - Content to append
   */
  appendDocument(content: string): Promise<void>
}
