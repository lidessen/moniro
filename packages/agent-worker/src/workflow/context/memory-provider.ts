/**
 * Memory Context Provider
 * In-memory storage for testing and development
 */

import type { ContextProvider } from './provider.js'
import type { ChannelEntry, InboxMessage, InboxState, AttachmentResult, AttachmentType } from './types.js'
import { CONTEXT_DEFAULTS, calculatePriority, extractMentions, generateAttachmentId, createAttachmentRef } from './types.js'

/**
 * In-memory implementation of ContextProvider
 * Useful for testing and ephemeral workflows
 */
export class MemoryContextProvider implements ContextProvider {
  private channel: ChannelEntry[] = []
  private documents: Map<string, string> = new Map()
  private attachments: Map<string, string> = new Map()
  private inboxState: InboxState = { readCursors: {} }
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

  async createAttachment(
    content: string,
    createdBy: string,
    _type: AttachmentType = 'text'
  ): Promise<AttachmentResult> {
    const id = generateAttachmentId()
    this.attachments.set(id, content)
    return { id, ref: createAttachmentRef(id) }
  }

  async readAttachment(id: string): Promise<string | null> {
    return this.attachments.get(id) ?? null
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

  async getInbox(agent: string): Promise<InboxMessage[]> {
    const lastAck = this.inboxState.readCursors[agent] || ''

    return this.channel
      .filter((e) => e.timestamp > lastAck && e.mentions.includes(agent))
      .map((entry) => ({
        entry,
        priority: calculatePriority(entry),
      }))
  }

  async ackInbox(agent: string, until: string): Promise<void> {
    this.inboxState.readCursors[agent] = until
  }

  async readDocument(file?: string): Promise<string> {
    const docFile = file || CONTEXT_DEFAULTS.document
    return this.documents.get(docFile) || ''
  }

  async writeDocument(content: string, file?: string): Promise<void> {
    const docFile = file || CONTEXT_DEFAULTS.document
    this.documents.set(docFile, content)
  }

  async appendDocument(content: string, file?: string): Promise<void> {
    const docFile = file || CONTEXT_DEFAULTS.document
    const existing = this.documents.get(docFile) || ''
    this.documents.set(docFile, existing + content)
  }

  async listDocuments(): Promise<string[]> {
    return Array.from(this.documents.keys()).sort()
  }

  async createDocument(file: string, content: string): Promise<void> {
    if (this.documents.has(file)) {
      throw new Error(`Document already exists: ${file}`)
    }
    this.documents.set(file, content)
  }

  // Test helpers

  /** Get all channel entries (for testing) */
  getChannelEntries(): ChannelEntry[] {
    return [...this.channel]
  }

  /** Clear all data (for testing) */
  clear(): void {
    this.channel = []
    this.documents.clear()
    this.attachments.clear()
    this.inboxState = { readCursors: {} }
    this.sequence = 0
  }

  /** Get all attachments (for testing) */
  getAttachments(): Map<string, string> {
    return new Map(this.attachments)
  }

  /** Get inbox state for an agent (for testing) */
  getInboxState(agent: string): string | undefined {
    return this.inboxState.readCursors[agent]
  }

  /** Get all documents (for testing) */
  getDocuments(): Map<string, string> {
    return new Map(this.documents)
  }
}

/**
 * Create a memory context provider
 */
export function createMemoryContextProvider(validAgents: string[]): MemoryContextProvider {
  return new MemoryContextProvider(validAgents)
}
