/**
 * Memory Context Provider
 * In-memory storage for testing and development
 */

import type { ContextProvider } from './provider.js'
import type { ChannelEntry, MentionNotification } from './types.js'
import { extractMentions } from './types.js'

/**
 * In-memory implementation of ContextProvider
 * Useful for testing and ephemeral workflows
 */
export class MemoryContextProvider implements ContextProvider {
  private channel: ChannelEntry[] = []
  private document = ''
  private mentionState: Map<string, string> = new Map() // agent -> last ack timestamp
  private sequence = 0 // Ensure unique timestamps

  constructor(private validAgents: string[]) {}

  async appendChannel(from: string, message: string): Promise<ChannelEntry> {
    // Use sequence to ensure unique timestamps even in rapid succession
    const now = new Date()
    const seq = this.sequence++
    // Add sequence as microseconds to ensure uniqueness
    const timestamp = `${now.toISOString().slice(0, -1)}${seq.toString().padStart(3, '0')}Z`

    const entry: ChannelEntry = {
      timestamp,
      from,
      message,
      mentions: extractMentions(message, this.validAgents),
    }
    this.channel.push(entry)
    return entry
  }

  async readChannel(since?: string, limit?: number): Promise<ChannelEntry[]> {
    let entries = this.channel

    if (since) {
      entries = entries.filter((e) => e.timestamp > since)
    }

    if (limit && limit > 0) {
      entries = entries.slice(-limit)
    }

    return entries
  }

  async getUnreadMentions(agent: string): Promise<MentionNotification[]> {
    const lastAck = this.mentionState.get(agent) || ''

    return this.channel
      .filter((e) => e.timestamp > lastAck && e.mentions.includes(agent))
      .map((e) => ({
        from: e.from,
        target: agent,
        message: e.message,
        timestamp: e.timestamp,
      }))
  }

  async acknowledgeMentions(agent: string, until: string): Promise<void> {
    this.mentionState.set(agent, until)
  }

  async readDocument(): Promise<string> {
    return this.document
  }

  async writeDocument(content: string): Promise<void> {
    this.document = content
  }

  async appendDocument(content: string): Promise<void> {
    this.document += content
  }

  // Test helpers

  /** Get all channel entries (for testing) */
  getChannelEntries(): ChannelEntry[] {
    return [...this.channel]
  }

  /** Clear all data (for testing) */
  clear(): void {
    this.channel = []
    this.document = ''
    this.mentionState.clear()
    this.sequence = 0
  }

  /** Get mention state for an agent (for testing) */
  getMentionState(agent: string): string | undefined {
    return this.mentionState.get(agent)
  }
}
