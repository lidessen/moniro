/**
 * Memory Context Provider
 * Extends ContextProviderImpl with MemoryStorage for testing.
 */

import type { Message } from './types.js'
import { ContextProviderImpl } from './provider.js'
import { MemoryStorage } from './storage.js'

/**
 * In-memory ContextProvider for testing.
 * All domain logic is inherited from ContextProviderImpl;
 * this class adds test helpers for inspection and cleanup.
 */
export class MemoryContextProvider extends ContextProviderImpl {
  private memoryStorage: MemoryStorage

  constructor(validAgents: string[]) {
    const storage = new MemoryStorage()
    super(storage, validAgents)
    this.memoryStorage = storage
  }

  // ==================== Test Helpers ====================

  /** Get underlying MemoryStorage (for testing) */
  override getStorage(): MemoryStorage {
    return this.memoryStorage
  }

  /** Get all channel messages (for testing, unfiltered) */
  async getMessages(): Promise<Message[]> {
    return this.readChannel()
  }

  /** Clear all data (for testing) */
  clear(): void {
    this.memoryStorage.clear()
  }

  /** Get all resources (for testing) */
  async getResources(): Promise<Map<string, string>> {
    const keys = await this.memoryStorage.list('resources/')
    const map = new Map<string, string>()
    for (const key of keys) {
      const content = await this.memoryStorage.read(`resources/${key}`)
      if (content !== null) {
        // Extract ID from filename (strip extension)
        const id = key.replace(/\.[^.]+$/, '')
        map.set(id, content)
      }
    }
    return map
  }

  /** Get inbox state for an agent (for testing) */
  async getInboxState(agent: string): Promise<string | undefined> {
    const raw = await this.memoryStorage.read('_state/inbox.json')
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
    const files = await this.memoryStorage.list('documents/')
    const map = new Map<string, string>()
    for (const file of files) {
      const content = await this.memoryStorage.read(`documents/${file}`)
      if (content !== null) {
        map.set(file, content)
      }
    }
    return map
  }
}

/**
 * Create a memory context provider
 */
export function createMemoryContextProvider(validAgents: string[]): MemoryContextProvider {
  return new MemoryContextProvider(validAgents)
}
