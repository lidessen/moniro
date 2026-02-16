/**
 * Workflow file type definitions.
 *
 * These describe the YAML structure that users write and
 * the resolved form that the daemon consumes.
 */

// ==================== Workflow File ====================

/** Raw workflow YAML structure */
export interface WorkflowFile {
  /** Workflow name (defaults to filename) */
  name?: string;
  /** Agent definitions */
  agents: Record<string, AgentDefinition>;
  /** Setup commands — run before kickoff */
  setup?: SetupTask[];
  /** Kickoff message — initiates workflow via @mention */
  kickoff?: string;
}

/** Agent definition in YAML */
export interface AgentDefinition {
  /** Backend: 'default' | 'claude' | 'cursor' | 'codex' | 'mock' */
  backend?: string;
  /** Model identifier */
  model?: string;
  /** Provider: string name or { name, base_url?, api_key? } */
  provider?: string | ProviderConfig;
  /** System prompt — inline string or file path (.txt/.md) */
  system_prompt?: string;
  /** Tool names to enable */
  tools?: string[];
  /** Maximum tokens */
  max_tokens?: number;
  /** Periodic wakeup: number (ms), duration ("30s"), or cron expression */
  wakeup?: string | number;
  /** Custom prompt for wakeup events */
  wakeup_prompt?: string;
}

/** Custom provider config */
export interface ProviderConfig {
  name: string;
  base_url?: string;
  api_key?: string;
}

/** Setup task — shell command before kickoff */
export interface SetupTask {
  shell: string;
  as?: string;
}

// ==================== Parsed (Resolved) ====================

/** Parsed workflow — ready for daemon consumption */
export interface ParsedWorkflow {
  name: string;
  filePath: string;
  agents: Record<string, ResolvedAgent>;
  setup: SetupTask[];
  kickoff?: string;
}

/** Resolved agent — system prompt loaded, schedule extracted */
export interface ResolvedAgent extends AgentDefinition {
  /** Resolved system prompt content (loaded from file if path) */
  resolvedSystemPrompt?: string;
  /** Schedule config derived from wakeup/wakeup_prompt */
  schedule?: { wakeup: string | number; prompt?: string };
}

// ==================== Validation ====================

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}
