/**
 * FileDocumentProvider — filesystem-backed document storage.
 *
 * Each workflow:tag gets a directory. Documents are plain files.
 * This is the default provider; can be swapped for SQLite or S3.
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, relative } from "node:path";
import type { DocumentProvider } from "../../shared/types.ts";

/**
 * Create a file-based document provider.
 *
 * Directory layout:
 *   baseDir/workflow/tag/path
 */
export function createFileDocumentProvider(baseDir: string): DocumentProvider {
  function resolvePath(workflow: string, tag: string, path: string): string {
    return join(baseDir, workflow, tag, path);
  }

  function ensureDir(filePath: string): void {
    const dir = filePath.substring(0, filePath.lastIndexOf("/"));
    if (dir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  return {
    async read(workflow, tag, path) {
      const fullPath = resolvePath(workflow, tag, path);
      if (!existsSync(fullPath)) return null;
      return readFileSync(fullPath, "utf-8");
    },

    async write(workflow, tag, path, content) {
      const fullPath = resolvePath(workflow, tag, path);
      ensureDir(fullPath);
      writeFileSync(fullPath, content);
    },

    async append(workflow, tag, path, content) {
      const fullPath = resolvePath(workflow, tag, path);
      ensureDir(fullPath);
      appendFileSync(fullPath, content);
    },

    async list(workflow, tag) {
      const dir = join(baseDir, workflow, tag);
      if (!existsSync(dir)) return [];

      const files: string[] = [];
      function walk(currentDir: string): void {
        for (const entry of readdirSync(currentDir)) {
          const fullPath = join(currentDir, entry);
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            // Skip internal directories
            if (!entry.startsWith("_")) walk(fullPath);
          } else {
            files.push(relative(dir, fullPath));
          }
        }
      }
      walk(dir);
      return files;
    },

    async create(workflow, tag, path, content) {
      const fullPath = resolvePath(workflow, tag, path);
      if (existsSync(fullPath)) {
        throw new Error(`Document already exists: ${path}`);
      }
      ensureDir(fullPath);
      writeFileSync(fullPath, content);
    },
  };
}
