/**
 * File Context Provider
 * Thin wrapper around ContextProviderImpl + FileStorage.
 * Includes instance lock to prevent concurrent access to the same context directory.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { ContextProviderImpl } from "./provider.ts";
import { FileStorage } from "./storage.ts";
import { CONTEXT_DEFAULTS } from "./types.ts";

/** Lock file name within context directory */
const LOCK_FILE = "_state/instance.lock";

/** Lock file content */
interface LockInfo {
  pid: number;
  startedAt: string;
}

/**
 * File-based ContextProvider.
 * All domain logic is in ContextProviderImpl;
 * FileStorage handles I/O.
 *
 * Adds instance locking: only one process can hold the lock at a time.
 * Stale locks (from crashed processes) are automatically cleaned up.
 */
export class FileContextProvider extends ContextProviderImpl {
  private lockPath: string;

  constructor(
    storage: FileStorage,
    validAgents: string[],
    private contextDir: string,
  ) {
    super(storage, validAgents);
    this.lockPath = join(contextDir, LOCK_FILE);
  }

  /**
   * Acquire instance lock.
   * Throws if another live process holds the lock.
   * Automatically cleans up stale locks from dead processes.
   */
  acquireLock(): void {
    if (existsSync(this.lockPath)) {
      try {
        const existing: LockInfo = JSON.parse(readFileSync(this.lockPath, "utf-8"));
        // Check if the process is still alive
        try {
          process.kill(existing.pid, 0);
          // Process is alive — lock is held
          throw new Error(
            `Context directory is locked by another process (PID ${existing.pid}, started ${existing.startedAt}). ` +
              `If the process is no longer running, delete ${this.lockPath}`,
          );
        } catch (e) {
          if (e instanceof Error && e.message.includes("Context directory is locked")) {
            throw e;
          }
          // process.kill threw — process is dead, clean up stale lock
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes("Context directory is locked")) {
          throw e;
        }
        // Malformed lock file, clean up
      }
    }

    const lock: LockInfo = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
    };
    // Ensure _state directory exists (FileStorage may not have created it yet)
    const stateDir = join(this.contextDir, "_state");
    if (!existsSync(stateDir)) {
      mkdirSync(stateDir, { recursive: true });
    }
    writeFileSync(this.lockPath, JSON.stringify(lock, null, 2));
  }

  /**
   * Release instance lock.
   * Safe to call even if lock is not held (no-op).
   */
  releaseLock(): void {
    try {
      if (existsSync(this.lockPath)) {
        const existing: LockInfo = JSON.parse(readFileSync(this.lockPath, "utf-8"));
        // Only release if we own it
        if (existing.pid === process.pid) {
          unlinkSync(this.lockPath);
        }
      }
    } catch {
      // Ignore errors during cleanup
    }
  }

  /**
   * Override destroy to release lock and clean up transient state.
   */
  override async destroy(): Promise<void> {
    await super.destroy();
    this.releaseLock();
  }
}

/**
 * Resolve a context directory template to an absolute path.
 *
 * Supports:
 * - ${{ workflow.name }} — substituted with workflowName
 * - ${{ instance }} — substituted with instance
 * - ~ expansion to home directory
 * - Relative paths resolved against baseDir (or cwd if not provided)
 * - Absolute paths used as-is
 */
export function resolveContextDir(
  dirTemplate: string,
  opts: {
    workflowName?: string;
    workflow?: string;
    tag?: string;
    instance?: string;
    baseDir?: string;
  },
): string {
  // Support new workflow:tag format
  const workflow = opts.workflow ?? opts.workflowName ?? opts.instance ?? "global";
  const workflowName = opts.workflowName ?? workflow;
  const tag = opts.tag ?? "main";

  let dir = dirTemplate
    .replace("${{ workflow.name }}", workflowName)
    .replace("${{ workflow.tag }}", tag)
    .replace("${{ instance }}", opts.instance ?? workflow); // Backward compat

  if (dir.startsWith("~/")) {
    dir = join(homedir(), dir.slice(2));
  } else if (dir === "~") {
    dir = homedir();
  } else if (!isAbsolute(dir)) {
    dir = join(opts.baseDir ?? process.cwd(), dir);
  }

  return dir;
}

/**
 * Resolve context dir for a workflow:tag using default template.
 * Shorthand for the common case.
 * @param workflow Workflow name (defaults to "global")
 * @param tag Workflow instance tag (defaults to "main")
 * @param instanceOrWorkflowName (deprecated) Legacy parameter for backward compatibility
 */
export function getDefaultContextDir(
  workflow?: string,
  tag?: string,
  instanceOrWorkflowName?: string,
): string {
  // Backward compatibility: if called with old signature (instance, workflowName)
  // First param could be instance (old usage) or workflow (new usage)
  const wf = workflow ?? instanceOrWorkflowName ?? "global";
  const t = tag ?? "main";

  return resolveContextDir(CONTEXT_DEFAULTS.dir, {
    workflow: wf,
    tag: t,
  });
}

/**
 * Create a FileContextProvider with default paths.
 *
 * Directory layout:
 *   contextDir/
 *   ├── channel.jsonl        # Channel log (JSONL)
 *   ├── documents/           # Team documents
 *   │   └── notes.md         # Default document
 *   ├── resources/           # Resource blobs
 *   ├── _state/
 *   │   ├── inbox.json       # Inbox read cursors
 *   │   ├── instance.lock    # Instance lock (PID-based)
 *   │   └── proposals.json   # Proposal state
 *   └── ...
 */
export function createFileContextProvider(
  contextDir: string,
  validAgents: string[],
): FileContextProvider {
  const storage = new FileStorage(contextDir);
  return new FileContextProvider(storage, validAgents, contextDir);
}
