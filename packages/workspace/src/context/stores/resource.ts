/**
 * Resource Store
 * Content-addressed blobs for long-form content.
 */

import type { StorageBackend } from "../storage.ts";
import type { ResourceType, ResourceResult } from "../types.ts";
import { generateResourceId, createResourceRef } from "../types.ts";

const RESOURCE_PREFIX = "resources/";

// ==================== Interface ====================

export interface ResourceStore {
  create(content: string, createdBy: string, type?: ResourceType): Promise<ResourceResult>;
  read(id: string): Promise<string | null>;
}

// ==================== Default Implementation ====================

/**
 * Default resource store backed by a StorageBackend.
 * Resources are keyed by generated ID with type-based extensions.
 */
export class DefaultResourceStore implements ResourceStore {
  constructor(private storage: StorageBackend) {}

  async create(
    content: string,
    _createdBy: string,
    type: ResourceType = "text",
  ): Promise<ResourceResult> {
    const id = generateResourceId();
    const ext = type === "json" ? "json" : type === "diff" ? "diff" : "md";
    const key = `${RESOURCE_PREFIX}${id}.${ext}`;

    await this.storage.write(key, content);

    return { id, ref: createResourceRef(id) };
  }

  async read(id: string): Promise<string | null> {
    // Try common extensions
    for (const ext of ["md", "json", "diff", "txt"]) {
      const key = `${RESOURCE_PREFIX}${id}.${ext}`;
      const content = await this.storage.read(key);
      if (content !== null) return content;
    }
    return null;
  }
}
