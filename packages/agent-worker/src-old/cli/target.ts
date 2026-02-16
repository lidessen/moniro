/**
 * Target identifier utilities
 *
 * Format: agent@workflow:tag (inspired by Docker image:tag)
 * - agent: agent name (optional for @workflow references)
 * - workflow: workflow name (optional, defaults to 'global')
 * - tag: workflow instance tag (optional, defaults to 'main')
 *
 * Examples:
 * - "alice"              → { agent: "alice", workflow: "global", tag: "main", display: "alice" }
 * - "alice@review"       → { agent: "alice", workflow: "review", tag: "main", display: "alice@review" }
 * - "alice@review:pr-123"→ { agent: "alice", workflow: "review", tag: "pr-123", display: "alice@review:pr-123" }
 * - "@review"            → { agent: undefined, workflow: "review", tag: "main", display: "@review" }
 * - "@review:pr-123"     → { agent: undefined, workflow: "review", tag: "pr-123", display: "@review:pr-123" }
 *
 * Display rules:
 * - Omit @global (standalone agents): "alice" not "alice@global"
 * - Omit :main (default tag): "alice@review" not "alice@review:main"
 */

export const DEFAULT_WORKFLOW = "global";
export const DEFAULT_TAG = "main";

export interface TargetIdentifier {
  /** Agent name (undefined for workflow-level targets like @review) */
  agent?: string;
  /** Workflow name */
  workflow: string;
  /** Workflow instance tag */
  tag: string;
  /** Full identifier: agent@workflow:tag or @workflow:tag */
  full: string;
  /** Display format (omits @global and :main per display rules) */
  display: string;
}

/**
 * Parse target identifier from string
 * Supports: "agent", "agent@workflow", "agent@workflow:tag", "@workflow", "@workflow:tag"
 */
export function parseTarget(input: string): TargetIdentifier {
  // Handle workflow-only targets (starts with @)
  if (input.startsWith("@")) {
    const workflowPart = input.slice(1); // Remove leading @
    const colonIndex = workflowPart.indexOf(":");

    if (colonIndex === -1) {
      // @workflow (no tag)
      const workflow = workflowPart || DEFAULT_WORKFLOW;
      return {
        agent: undefined,
        workflow,
        tag: DEFAULT_TAG,
        full: `@${workflow}:${DEFAULT_TAG}`,
        display: workflow === DEFAULT_WORKFLOW ? `@${workflow}` : `@${workflow}`,
      };
    } else {
      // @workflow:tag
      const workflow = workflowPart.slice(0, colonIndex) || DEFAULT_WORKFLOW;
      const tag = workflowPart.slice(colonIndex + 1) || DEFAULT_TAG;
      return {
        agent: undefined,
        workflow,
        tag,
        full: `@${workflow}:${tag}`,
        display: buildDisplay(undefined, workflow, tag),
      };
    }
  }

  // Handle agent targets (with or without @workflow:tag)
  const atIndex = input.indexOf("@");

  if (atIndex === -1) {
    // Just agent name, no workflow specified
    return {
      agent: input,
      workflow: DEFAULT_WORKFLOW,
      tag: DEFAULT_TAG,
      full: `${input}@${DEFAULT_WORKFLOW}:${DEFAULT_TAG}`,
      display: input, // Omit @global:main
    };
  }

  const agent = input.slice(0, atIndex);
  const workflowPart = input.slice(atIndex + 1);
  const colonIndex = workflowPart.indexOf(":");

  if (colonIndex === -1) {
    // agent@workflow (no tag)
    const workflow = workflowPart || DEFAULT_WORKFLOW;
    return {
      agent,
      workflow,
      tag: DEFAULT_TAG,
      full: `${agent}@${workflow}:${DEFAULT_TAG}`,
      display: buildDisplay(agent, workflow, DEFAULT_TAG),
    };
  } else {
    // agent@workflow:tag (full specification)
    const workflow = workflowPart.slice(0, colonIndex) || DEFAULT_WORKFLOW;
    const tag = workflowPart.slice(colonIndex + 1) || DEFAULT_TAG;
    return {
      agent,
      workflow,
      tag,
      full: `${agent}@${workflow}:${tag}`,
      display: buildDisplay(agent, workflow, tag),
    };
  }
}

/**
 * Build display string following display rules:
 * - Omit @global for standalone agents
 * - Omit :main for default tag
 */
function buildDisplay(agent: string | undefined, workflow: string, tag: string): string {
  const isGlobal = workflow === DEFAULT_WORKFLOW;
  const isMainTag = tag === DEFAULT_TAG;

  if (agent === undefined) {
    // Workflow-only target: @workflow or @workflow:tag
    if (isMainTag) {
      return `@${workflow}`;
    }
    return `@${workflow}:${tag}`;
  }

  // Agent target
  if (isGlobal && isMainTag) {
    // Standalone agent: just show agent name
    return agent;
  }

  if (isGlobal && !isMainTag) {
    // agent@global:non-main → show agent@global:tag
    return `${agent}@${workflow}:${tag}`;
  }

  if (!isGlobal && isMainTag) {
    // agent@non-global:main → show agent@workflow
    return `${agent}@${workflow}`;
  }

  // Full specification needed
  return `${agent}@${workflow}:${tag}`;
}

/**
 * Build full target identifier from parts
 */
export function buildTarget(agent: string | undefined, workflow?: string, tag?: string): string {
  const wf = workflow || DEFAULT_WORKFLOW;
  const t = tag || DEFAULT_TAG;

  if (agent === undefined) {
    return `@${wf}:${t}`;
  }

  return `${agent}@${wf}:${t}`;
}

/**
 * Build display string from parts (following display rules)
 */
export function buildTargetDisplay(
  agent: string | undefined,
  workflow?: string,
  tag?: string,
): string {
  const wf = workflow || DEFAULT_WORKFLOW;
  const t = tag || DEFAULT_TAG;
  return buildDisplay(agent, wf, t);
}

/**
 * Check if workflow/tag name is valid
 * Must be alphanumeric, hyphen, underscore, or dot
 */
export function isValidName(name: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(name);
}

/**
 * Get context directory for a workflow:tag
 * Maps to .workflow/<workflow>/<tag>/
 */
export function getWorkflowContextDir(baseDir: string, workflow: string, tag: string): string {
  return `${baseDir}/.workflow/${workflow}/${tag}`;
}

// ==================== Backward Compatibility ====================
// These maintain compatibility with old instance.ts API

/**
 * @deprecated Use DEFAULT_WORKFLOW and DEFAULT_TAG instead
 */
export const DEFAULT_INSTANCE = DEFAULT_WORKFLOW;

/**
 * @deprecated Use TargetIdentifier instead
 */
export interface AgentIdentifier {
  agent: string;
  instance: string;
  full: string;
}

/**
 * @deprecated Use parseTarget instead
 * Legacy parsing for agent@instance format (treats instance as workflow)
 */
export function parseAgentId(input: string): AgentIdentifier {
  const target = parseTarget(input);

  if (target.agent === undefined) {
    throw new Error("parseAgentId requires an agent name");
  }

  return {
    agent: target.agent,
    instance: target.workflow, // Map workflow to instance for backward compat
    full: `${target.agent}@${target.workflow}`,
  };
}

/**
 * @deprecated Use buildTarget instead
 */
export function buildAgentId(agent: string, instance?: string): string {
  return buildTarget(agent, instance);
}

/**
 * @deprecated Use isValidName instead
 */
export function isValidInstanceName(name: string): boolean {
  return isValidName(name);
}
