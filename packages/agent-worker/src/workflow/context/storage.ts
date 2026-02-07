/**
 * Storage Backend
 * Abstract storage layer for workflow context persistence.
 *
 * Keys are logical paths (e.g., "channel.jsonl", "documents/notes.md", "_state/inbox.json").
 * Implementations map these to actual storage (filesystem, memory, DB, etc.).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

// ==================== Interface ====================

/**
 * Storage backend interface — minimal primitives for all context persistence.
 */
export interface StorageBackend {
  /** Read content by key. Returns null if not found. */
  read(key: string): Promise<string | null>

  /** Write content by key (creates or overwrites). */
  write(key: string, content: string): Promise<void>

  /** Append content to key (creates if not exists). */
  append(key: string, content: string): Promise<void>

  /** Check if key exists. */
  exists(key: string): Promise<boolean>

  /** List keys under a prefix (like a directory listing). */
  list(prefix: string): Promise<string[]>

  /** Delete a key. No-op if not found. */
  delete(key: string): Promise<void>
}

// ==================== Memory Storage ====================

/**
 * In-memory storage backend for testing and ephemeral workflows.
 */
export class MemoryStorage implements StorageBackend {
  private data = new Map<string, string>()

  async read(key: string): Promise<string | null> {
    return this.data.get(key) ?? null
  }

  async write(key: string, content: string): Promise<void> {
    this.data.set(key, content)
  }

  async append(key: string, content: string): Promise<void> {
    const existing = this.data.get(key) ?? ''
    this.data.set(key, existing + content)
  }

  async exists(key: string): Promise<boolean> {
    return this.data.has(key)
  }

  async list(prefix: string): Promise<string[]> {
    const normalizedPrefix = prefix.endsWith('/') ? prefix : prefix + '/'
    const results: string[] = []
    for (const key of this.data.keys()) {
      if (key.startsWith(normalizedPrefix)) {
        // Return the relative part after the prefix
        results.push(key.slice(normalizedPrefix.length))
      }
    }
    return results.sort()
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key)
  }

  /** Clear all data (for testing) */
  clear(): void {
    this.data.clear()
  }

  /** Get the number of stored keys (for testing) */
  get size(): number {
    return this.data.size
  }

  /** Get all keys (for testing) */
  keys(): string[] {
    return [...this.data.keys()]
  }
}

// ==================== File Storage ====================

/**
 * File-based storage backend.
 * Keys map to file paths relative to a base directory.
 */
export class FileStorage implements StorageBackend {
  constructor(private baseDir: string) {
    if (!existsSync(baseDir)) {
      mkdirSync(baseDir, { recursive: true })
    }
  }

  private resolve(key: string): string {
    return join(this.baseDir, key)
  }

  private ensureParentDir(filePath: string): void {
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  async read(key: string): Promise<string | null> {
    const filePath = this.resolve(key)
    try {
      if (existsSync(filePath)) {
        return readFileSync(filePath, 'utf-8')
      }
      return null
    } catch {
      return null
    }
  }

  async write(key: string, content: string): Promise<void> {
    const filePath = this.resolve(key)
    this.ensureParentDir(filePath)
    writeFileSync(filePath, content)
  }

  async append(key: string, content: string): Promise<void> {
    const filePath = this.resolve(key)
    this.ensureParentDir(filePath)
    appendFileSync(filePath, content)
  }

  async exists(key: string): Promise<boolean> {
    return existsSync(this.resolve(key))
  }

  async list(prefix: string): Promise<string[]> {
    const dir = this.resolve(prefix)
    if (!existsSync(dir)) {
      return []
    }

    const results: string[] = []
    const walk = (currentDir: string): void => {
      const entries = readdirSync(currentDir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = join(currentDir, entry.name)
        if (entry.isDirectory()) {
          walk(fullPath)
        } else if (entry.isFile()) {
          results.push(relative(dir, fullPath))
        }
      }
    }
    walk(dir)
    return results.sort()
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolve(key)
    try {
      if (existsSync(filePath)) {
        const { unlinkSync } = await import('node:fs')
        unlinkSync(filePath)
      }
    } catch {
      // Ignore deletion errors
    }
  }
}
