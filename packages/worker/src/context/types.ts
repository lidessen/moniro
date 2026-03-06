/**
 * PersonalContextProvider — Pluggable storage abstraction for agent personal context.
 *
 * Extracted from AgentHandleRef (workflow/types.ts) and AgentHandle (agent-worker/agent-handle.ts).
 * This interface lives in @moniro/agent-worker so both the agent-worker and workspace layers
 * can depend on it without circular dependencies.
 *
 * Default implementation: FileContextProvider (file-based, extracted from AgentHandle).
 * Future: RedisContextProvider, SQLiteContextProvider, APIContextProvider.
 */

/**
 * Pluggable storage for agent personal context (memory, notes, todos).
 *
 * All methods are optional — an agent without persistent storage
 * simply has no personal context.
 */
export interface PersonalContextProvider {
  /** Read all memory entries (key-value from memory/*.yaml). */
  readMemory?(): Promise<Record<string, unknown>>;
  /** Write a memory entry (creates/overwrites memory/<key>.yaml). */
  writeMemory?(key: string, value: unknown): Promise<void>;
  /** Read agent's notes, most recent first. */
  readNotes?(limit?: number): Promise<string[]>;
  /** Append a note (creates notes/<date>-<slug>.md). Returns filename. */
  appendNote?(content: string, slug?: string): Promise<string>;
  /** Read active todo items (from todo/index.md). */
  readTodos?(): Promise<string[]>;
  /** Write the full todo list (replaces todo/index.md). */
  writeTodos?(todos: string[]): Promise<void>;
}

/**
 * Personal context data — resolved snapshot for prompt injection.
 *
 * This is the READ-ONLY view used by prompt sections. The provider
 * interface above is for read/write operations (tools).
 */
export interface PersonalContext {
  /** Agent soul — persistent identity traits */
  soul?: import("@moniro/agent-loop").AgentSoul;
  /** Memory entries (key-value from memory/*.yaml) */
  memory?: Record<string, unknown>;
  /** Active todo items (from todo/index.md) */
  todos?: string[];
}
