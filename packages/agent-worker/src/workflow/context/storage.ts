/**
 * Storage Backend
 * Abstract storage layer for workflow context persistence.
 *
 * Keys are logical paths (e.g., "channel.jsonl", "documents/notes.md", "_state/inbox.json").
 * Implementations map these to actual storage (filesystem, memory, DB, etc.).
 */

import { existsSync, mkdirSync } from "node:fs";
import {
  readFile,
  writeFile,
  appendFile,
  readdir,
  stat,
  open,
  mkdir,
  unlink,
} from "node:fs/promises";
import { dirname, join, relative } from "node:path";

// ==================== Interface ====================

/**
 * Storage backend interface — minimal primitives for all context persistence.
 */
export interface StorageBackend {
  /** Read content by key. Returns null if not found. */
  read(key: string): Promise<string | null>;

  /** Read content starting from a byte/char offset. Returns new content and updated offset. */
  readFrom(key: string, offset: number): Promise<{ content: string; offset: number }>;

  /** Write content by key (creates or overwrites). */
  write(key: string, content: string): Promise<void>;

  /** Append content to key (creates if not exists). */
  append(key: string, content: string): Promise<void>;

  /** Check if key exists. */
  exists(key: string): Promise<boolean>;

  /** List keys under a prefix (like a directory listing). */
  list(prefix: string): Promise<string[]>;

  /** Delete a key. No-op if not found. */
  delete(key: string): Promise<void>;
}

// ==================== Memory Storage ====================

/**
 * In-memory storage backend for testing and ephemeral workflows.
 */
export class MemoryStorage implements StorageBackend {
  private data = new Map<string, string>();

  async read(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }

  async readFrom(key: string, offset: number): Promise<{ content: string; offset: number }> {
    const data = this.data.get(key) ?? "";
    if (offset >= data.length) return { content: "", offset: data.length };
    return { content: data.slice(offset), offset: data.length };
  }

  async write(key: string, content: string): Promise<void> {
    this.data.set(key, content);
  }

  async append(key: string, content: string): Promise<void> {
    const existing = this.data.get(key) ?? "";
    this.data.set(key, existing + content);
  }

  async exists(key: string): Promise<boolean> {
    return this.data.has(key);
  }

  async list(prefix: string): Promise<string[]> {
    const normalizedPrefix = prefix.endsWith("/") ? prefix : prefix + "/";
    const results: string[] = [];
    for (const key of this.data.keys()) {
      if (key.startsWith(normalizedPrefix)) {
        // Return the relative part after the prefix
        results.push(key.slice(normalizedPrefix.length));
      }
    }
    return results.sort();
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  /** Clear all data (for testing) */
  clear(): void {
    this.data.clear();
  }

  /** Get the number of stored keys (for testing) */
  get size(): number {
    return this.data.size;
  }

  /** Get all keys (for testing) */
  keys(): string[] {
    return [...this.data.keys()];
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
      mkdirSync(baseDir, { recursive: true });
    }
  }

  private resolve(key: string): string {
    return join(this.baseDir, key);
  }

  private async ensureParentDir(filePath: string): Promise<void> {
    const dir = dirname(filePath);
    await mkdir(dir, { recursive: true });
  }

  async read(key: string): Promise<string | null> {
    const filePath = this.resolve(key);
    try {
      return await readFile(filePath, "utf-8");
    } catch {
      return null;
    }
  }

  async readFrom(key: string, offset: number): Promise<{ content: string; offset: number }> {
    const filePath = this.resolve(key);
    let fh;
    try {
      fh = await open(filePath, "r");
      const { size } = await fh.stat();
      if (offset >= size) return { content: "", offset: size };
      const length = size - offset;
      const buffer = Buffer.alloc(length);
      await fh.read(buffer, 0, length, offset);
      return { content: buffer.toString("utf-8"), offset: size };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { content: "", offset: 0 };
      }
      return { content: "", offset };
    } finally {
      await fh?.close();
    }
  }

  async write(key: string, content: string): Promise<void> {
    const filePath = this.resolve(key);
    await this.ensureParentDir(filePath);
    await writeFile(filePath, content);
  }

  async append(key: string, content: string): Promise<void> {
    const filePath = this.resolve(key);
    await this.ensureParentDir(filePath);
    await appendFile(filePath, content);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const dir = this.resolve(prefix);
    try {
      const results: string[] = [];
      const walk = async (currentDir: string): Promise<void> => {
        const entries = await readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(currentDir, entry.name);
          if (entry.isDirectory()) {
            await walk(fullPath);
          } else if (entry.isFile()) {
            results.push(relative(dir, fullPath));
          }
        }
      };
      await walk(dir);
      return results.sort();
    } catch {
      return [];
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolve(key));
    } catch {
      // Ignore deletion errors (including ENOENT)
    }
  }
}
