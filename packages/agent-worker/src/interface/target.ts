/**
 * Target identifier utilities
 *
 * Format: agent@workflow:tag (inspired by Docker image:tag)
 *
 * Examples:
 * - "alice"               → { agent: "alice", workflow: "global", tag: "main" }
 * - "alice@review"        → { agent: "alice", workflow: "review", tag: "main" }
 * - "alice@review:pr-123" → { agent: "alice", workflow: "review", tag: "pr-123" }
 * - "@review"             → { agent: undefined, workflow: "review", tag: "main" }
 * - "@review:pr-123"      → { agent: undefined, workflow: "review", tag: "pr-123" }
 *
 * Display rules:
 * - Omit @global (standalone agents): "alice" not "alice@global"
 * - Omit :main (default tag): "alice@review" not "alice@review:main"
 */
import { DEFAULT_WORKFLOW, DEFAULT_TAG } from "../shared/constants.ts";

export interface TargetIdentifier {
  /** Agent name (undefined for workflow-level targets) */
  agent?: string;
  /** Workflow name */
  workflow: string;
  /** Workflow instance tag */
  tag: string;
  /** Full identifier: agent@workflow:tag */
  full: string;
  /** Display format (omits @global and :main) */
  display: string;
}

/**
 * Parse target identifier from string.
 */
export function parseTarget(input: string): TargetIdentifier {
  // Workflow-only target (starts with @)
  if (input.startsWith("@")) {
    const rest = input.slice(1);
    const colonIdx = rest.indexOf(":");

    if (colonIdx === -1) {
      const workflow = rest || DEFAULT_WORKFLOW;
      return {
        agent: undefined,
        workflow,
        tag: DEFAULT_TAG,
        full: `@${workflow}:${DEFAULT_TAG}`,
        display: `@${workflow}`,
      };
    }

    const workflow = rest.slice(0, colonIdx) || DEFAULT_WORKFLOW;
    const tag = rest.slice(colonIdx + 1) || DEFAULT_TAG;
    return {
      agent: undefined,
      workflow,
      tag,
      full: `@${workflow}:${tag}`,
      display: buildDisplay(undefined, workflow, tag),
    };
  }

  // Agent target
  const atIdx = input.indexOf("@");

  if (atIdx === -1) {
    // Just agent name
    return {
      agent: input,
      workflow: DEFAULT_WORKFLOW,
      tag: DEFAULT_TAG,
      full: `${input}@${DEFAULT_WORKFLOW}:${DEFAULT_TAG}`,
      display: input,
    };
  }

  const agent = input.slice(0, atIdx);
  const rest = input.slice(atIdx + 1);
  const colonIdx = rest.indexOf(":");

  if (colonIdx === -1) {
    const workflow = rest || DEFAULT_WORKFLOW;
    return {
      agent,
      workflow,
      tag: DEFAULT_TAG,
      full: `${agent}@${workflow}:${DEFAULT_TAG}`,
      display: buildDisplay(agent, workflow, DEFAULT_TAG),
    };
  }

  const workflow = rest.slice(0, colonIdx) || DEFAULT_WORKFLOW;
  const tag = rest.slice(colonIdx + 1) || DEFAULT_TAG;
  return {
    agent,
    workflow,
    tag,
    full: `${agent}@${workflow}:${tag}`,
    display: buildDisplay(agent, workflow, tag),
  };
}

/**
 * Build display string following display rules.
 */
function buildDisplay(agent: string | undefined, workflow: string, tag: string): string {
  const isGlobal = workflow === DEFAULT_WORKFLOW;
  const isMain = tag === DEFAULT_TAG;

  if (agent === undefined) {
    return isMain ? `@${workflow}` : `@${workflow}:${tag}`;
  }

  if (isGlobal && isMain) return agent;
  if (isMain) return `${agent}@${workflow}`;
  return `${agent}@${workflow}:${tag}`;
}

/**
 * Build full target string from parts.
 */
export function buildTarget(agent: string | undefined, workflow?: string, tag?: string): string {
  const wf = workflow || DEFAULT_WORKFLOW;
  const t = tag || DEFAULT_TAG;
  return agent === undefined ? `@${wf}:${t}` : `${agent}@${wf}:${t}`;
}

/**
 * Build display string from parts.
 */
export function buildTargetDisplay(agent: string | undefined, workflow?: string, tag?: string): string {
  return buildDisplay(agent, workflow || DEFAULT_WORKFLOW, tag || DEFAULT_TAG);
}

/**
 * Check if name is valid (alphanumeric, hyphen, underscore, dot).
 */
export function isValidName(name: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(name);
}
