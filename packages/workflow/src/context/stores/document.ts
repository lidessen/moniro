/**
 * Document Store
 * Raw text documents for team collaboration.
 */

import type { StorageBackend } from "../storage.ts";
import { CONTEXT_DEFAULTS } from "../types.ts";

const DOCUMENT_PREFIX = "documents/";

// ==================== Interface ====================

export interface DocumentStore {
  read(file?: string): Promise<string>;
  write(content: string, file?: string): Promise<void>;
  append(content: string, file?: string): Promise<void>;
  list(): Promise<string[]>;
  create(file: string, content: string): Promise<void>;
}

// ==================== Default Implementation ====================

/**
 * Default document store backed by a StorageBackend.
 * Documents are stored as raw text under a key prefix.
 */
export class DefaultDocumentStore implements DocumentStore {
  constructor(private storage: StorageBackend) {}

  private key(file?: string): string {
    return DOCUMENT_PREFIX + (file || CONTEXT_DEFAULTS.document);
  }

  async read(file?: string): Promise<string> {
    return (await this.storage.read(this.key(file))) ?? "";
  }

  async write(content: string, file?: string): Promise<void> {
    await this.storage.write(this.key(file), content);
  }

  async append(content: string, file?: string): Promise<void> {
    await this.storage.append(this.key(file), content);
  }

  async list(): Promise<string[]> {
    const files = await this.storage.list(DOCUMENT_PREFIX);
    return files.filter((f) => f.endsWith(".md")).sort();
  }

  async create(file: string, content: string): Promise<void> {
    const key = this.key(file);
    if (await this.storage.exists(key)) {
      throw new Error(`Document already exists: ${file}`);
    }
    await this.storage.write(key, content);
  }
}
