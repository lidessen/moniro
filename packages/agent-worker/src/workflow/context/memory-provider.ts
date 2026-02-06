/**
 * Memory Context Provider
 * Thin wrapper around ContextProviderImpl + MemoryStorage for testing.
 */

import type { ContextProvider } from './provider.js'
import type { ChannelEntry, InboxMessage, ResourceResult, ResourceType } from './types.js'
import { ContextProviderImpl } from './provider.js'
import { MemoryStorage } from './storage.js'

/**
 * In-memory ContextProvider for testing.
 * Delegates all domain logic to ContextProviderImpl;
 * adds test helpers for inspection and cleanup.
 */
export class MemoryContextProvider implements ContextProvider {
  private impl: ContextProviderImpl
  private storage: MemoryStorage

  constructor(private validAgents: string[]) {
    this.storage = new MemoryStorage()
    this.impl = new ContextProviderImpl(this.storage, validAgents)
  }

  // ==================== Delegate to impl ====================

  appendChannel(from: string, message: string): Promise<ChannelEntry> {
    return this.impl.appendChannel(from, message)
  }

  readChannel(since?: string, limit?: number): Promise<ChannelEntry[]> {
    return this.impl.readChannel(since, limit)
  }

  getInbox(agent: string): Promise<InboxMessage[]> {
    return this.impl.getInbox(agent)
  }

  ackInbox(agent: string, until: string): Promise<void> {
    return this.impl.ackInbox(agent, until)
  }

  readDocument(file?: string): Promise<string> {
    return this.impl.readDocument(file)
  }

  writeDocument(content: string, file?: string): Promise<void> {
    return this.impl.writeDocument(content, file)
  }

  appendDocument(content: string, file?: string): Promise<void> {
    return this.impl.appendDocument(content, file)
  }

  listDocuments(): Promise<string[]> {
    return this.impl.listDocuments()
  }

  createDocument(file: string, content: string): Promise<void> {
    return this.impl.createDocument(file, content)
  }

  createResource(content: string, createdBy: string, type?: ResourceType): Promise<ResourceResult> {
    return this.impl.createResource(content, createdBy, type)
  }

  readResource(id: string): Promise<string | null> {
    return this.impl.readResource(id)
  }

  // ==================== Test Helpers ====================

  /** Get underlying storage (for testing) */
  getStorage(): MemoryStorage {
    return this.storage
  }

  /** Get underlying impl (for testing) */
  getImpl(): ContextProviderImpl {
    return this.impl
  }

  /** Get all channel entries (for testing) */
  async getChannelEntries(): Promise<ChannelEntry[]> {
    return this.readChannel()
  }

  /** Clear all data (for testing) */
  clear(): void {
    this.storage.clear()
  }

  /** Get all resources (for testing) */
  async getResources(): Promise<Map<string, string>> {
    const keys = await this.storage.list('resources/')
    const map = new Map<string, string>()
    for (const key of keys) {
      const content = await this.storage.read(`resources/${key}`)
      if (content !== null) {
        // Extract ID from filename (strip extension)
        const id = key.replace(/\.[^.]+$/, '')
        map.set(id, content)
      }
    }
    return map
  }

  /** @deprecated Use getResources */
  async getAttachments(): Promise<Map<string, string>> {
    return this.getResources()
  }

  /** Get inbox state for an agent (for testing) */
  async getInboxState(agent: string): Promise<string | undefined> {
    const raw = await this.storage.read('_state/inbox.json')
    if (!raw) return undefined
    try {
      const data = JSON.parse(raw)
      return data.readCursors?.[agent]
    } catch {
      return undefined
    }
  }

  /** Get all documents (for testing) */
  async getDocuments(): Promise<Map<string, string>> {
    const files = await this.storage.list('documents/')
    const map = new Map<string, string>()
    for (const file of files) {
      const content = await this.storage.read(`documents/${file}`)
      if (content !== null) {
        map.set(file, content)
      }
    }
    return map
  }

  // Legacy aliases
  /** @deprecated Use createResource */
  createAttachment(content: string, createdBy: string, type?: ResourceType): Promise<ResourceResult> {
    return this.createResource(content, createdBy, type)
  }
  /** @deprecated Use readResource */
  readAttachment(id: string): Promise<string | null> {
    return this.readResource(id)
  }
}

/**
 * Create a memory context provider
 */
export function createMemoryContextProvider(validAgents: string[]): MemoryContextProvider {
  return new MemoryContextProvider(validAgents)
}
