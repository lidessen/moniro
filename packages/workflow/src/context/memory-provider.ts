/**
 * Memory Context Provider
 * Composes default stores with MemoryStorage for testing.
 */

import type { Message } from "./types.ts";
import { ContextProviderImpl } from "./provider.ts";
import { MemoryStorage } from "./storage.ts";
import { DefaultChannelStore } from "./stores/channel.ts";
import { DefaultInboxStore } from "./stores/inbox.ts";
import { DefaultDocumentStore } from "./stores/document.ts";
import { DefaultResourceStore } from "./stores/resource.ts";
import { DefaultStatusStore } from "./stores/status.ts";

/**
 * In-memory ContextProvider for testing.
 * All domain logic is in the composed stores;
 * this class adds test helpers for inspection and cleanup.
 */
export class MemoryContextProvider extends ContextProviderImpl {
  private memoryStorage: MemoryStorage;

  constructor(validAgents: string[]) {
    const storage = new MemoryStorage();
    const channel = new DefaultChannelStore(storage, validAgents);
    const inbox = new DefaultInboxStore(channel, storage);
    const documents = new DefaultDocumentStore(storage);
    const resources = new DefaultResourceStore(storage);
    const status = new DefaultStatusStore(storage);
    super(channel, inbox, documents, resources, status, validAgents);
    this.memoryStorage = storage;
  }

  // ==================== Test Helpers ====================

  /** Get underlying MemoryStorage (for testing) */
  getStorage(): MemoryStorage {
    return this.memoryStorage;
  }

  /** Get all channel messages (for testing, unfiltered) */
  async getMessages(): Promise<Message[]> {
    return this.readChannel();
  }

  /** Clear all data (for testing) */
  clear(): void {
    this.memoryStorage.clear();
  }

  /** Get all resources (for testing) */
  async getResources(): Promise<Map<string, string>> {
    const keys = await this.memoryStorage.list("resources/");
    const map = new Map<string, string>();
    for (const key of keys) {
      const content = await this.memoryStorage.read(`resources/${key}`);
      if (content !== null) {
        // Extract ID from filename (strip extension)
        const id = key.replace(/\.[^.]+$/, "");
        map.set(id, content);
      }
    }
    return map;
  }

  /** Get inbox state for an agent (for testing) */
  async getInboxState(agent: string): Promise<string | undefined> {
    const raw = await this.memoryStorage.read("_state/inbox.json");
    if (!raw) return undefined;
    try {
      const data = JSON.parse(raw);
      return data.readCursors?.[agent];
    } catch {
      return undefined;
    }
  }

  /** Get all documents (for testing) */
  async getDocuments(): Promise<Map<string, string>> {
    const files = await this.memoryStorage.list("documents/");
    const map = new Map<string, string>();
    for (const file of files) {
      const content = await this.memoryStorage.read(`documents/${file}`);
      if (content !== null) {
        map.set(file, content);
      }
    }
    return map;
  }
}

/**
 * Create a memory context provider
 */
export function createMemoryContextProvider(validAgents: string[]): MemoryContextProvider {
  return new MemoryContextProvider(validAgents);
}
