/**
 * Target identifier utilities
 *
 * Format: agent@workspace:tag
 * - agent: agent name (optional for @workspace references)
 * - workspace: workspace name (optional, defaults to 'global')
 * - tag: workspace instance tag (optional, nullable)
 *
 * Examples:
 * - "alice"              → { agent: "alice", workspace: "global", display: "alice" }
 * - "alice@review"       → { agent: "alice", workspace: "review", display: "alice@review" }
 * - "alice@review:pr-123"→ { agent: "alice", workspace: "review", tag: "pr-123", display: "alice@review:pr-123" }
 * - "@review"            → { agent: undefined, workspace: "review", display: "@review" }
 * - "@review:pr-123"     → { agent: undefined, workspace: "review", tag: "pr-123", display: "@review:pr-123" }
 *
 * Display rules:
 * - Omit @global (standalone agents): "alice" not "alice@global"
 * - Omit :tag when no tag: "@review" not "@review:"
 */

export const DEFAULT_WORKSPACE = "global";

export interface TargetIdentifier {
  /** Agent name (undefined for workspace-level targets like @review) */
  agent?: string;
  /** Workspace name */
  workspace: string;
  /** Workspace instance tag (undefined = no tag) */
  tag?: string;
  /** Full identifier: agent@workspace:tag or @workspace:tag */
  full: string;
  /** Display format (omits @global and empty tag per display rules) */
  display: string;
}

/**
 * Parse target identifier from string
 * Supports: "agent", "agent@workspace", "agent@workspace:tag", "@workspace", "@workspace:tag"
 */
export function parseTarget(input: string): TargetIdentifier {
  // Handle workspace-only targets (starts with @)
  if (input.startsWith("@")) {
    const workspacePart = input.slice(1); // Remove leading @
    const colonIndex = workspacePart.indexOf(":");

    if (colonIndex === -1) {
      // @workspace (no tag)
      const workspace = workspacePart || DEFAULT_WORKSPACE;
      return {
        agent: undefined,
        workspace,
        tag: undefined,
        full: `@${workspace}`,
        display: `@${workspace}`,
      };
    } else {
      // @workspace:tag
      const workspace = workspacePart.slice(0, colonIndex) || DEFAULT_WORKSPACE;
      const tag = workspacePart.slice(colonIndex + 1) || undefined;
      return {
        agent: undefined,
        workspace,
        tag,
        full: tag ? `@${workspace}:${tag}` : `@${workspace}`,
        display: buildDisplay(undefined, workspace, tag),
      };
    }
  }

  // Handle agent targets (with or without @workspace:tag)
  const atIndex = input.indexOf("@");

  if (atIndex === -1) {
    // Just agent name, no workspace specified
    return {
      agent: input,
      workspace: DEFAULT_WORKSPACE,
      tag: undefined,
      full: `${input}@${DEFAULT_WORKSPACE}`,
      display: input, // Omit @global
    };
  }

  const agent = input.slice(0, atIndex);
  const workspacePart = input.slice(atIndex + 1);
  const colonIndex = workspacePart.indexOf(":");

  if (colonIndex === -1) {
    // agent@workspace (no tag)
    const workspace = workspacePart || DEFAULT_WORKSPACE;
    return {
      agent,
      workspace,
      tag: undefined,
      full: `${agent}@${workspace}`,
      display: buildDisplay(agent, workspace, undefined),
    };
  } else {
    // agent@workspace:tag (full specification)
    const workspace = workspacePart.slice(0, colonIndex) || DEFAULT_WORKSPACE;
    const tag = workspacePart.slice(colonIndex + 1) || undefined;
    return {
      agent,
      workspace,
      tag,
      full: tag ? `${agent}@${workspace}:${tag}` : `${agent}@${workspace}`,
      display: buildDisplay(agent, workspace, tag),
    };
  }
}

/**
 * Build display string following display rules:
 * - Omit @global for standalone agents
 * - Omit :tag when no tag
 */
function buildDisplay(
  agent: string | undefined,
  workspace: string,
  tag: string | undefined,
): string {
  const isGlobal = workspace === DEFAULT_WORKSPACE;

  if (agent === undefined) {
    // Workspace-only target: @workspace or @workspace:tag
    if (tag) {
      return `@${workspace}:${tag}`;
    }
    return `@${workspace}`;
  }

  // Agent target
  if (isGlobal && !tag) {
    // Standalone agent: just show agent name
    return agent;
  }

  if (isGlobal && tag) {
    // agent@global:tag → show agent@global:tag
    return `${agent}@${workspace}:${tag}`;
  }

  if (!isGlobal && !tag) {
    // agent@non-global → show agent@workspace
    return `${agent}@${workspace}`;
  }

  // Full specification needed
  return `${agent}@${workspace}:${tag}`;
}

/**
 * Build full target identifier from parts
 */
export function buildTarget(agent: string | undefined, workspace?: string, tag?: string): string {
  const ws = workspace || DEFAULT_WORKSPACE;

  if (agent === undefined) {
    return tag ? `@${ws}:${tag}` : `@${ws}`;
  }

  return tag ? `${agent}@${ws}:${tag}` : `${agent}@${ws}`;
}

/**
 * Build display string from parts (following display rules)
 */
export function buildTargetDisplay(
  agent: string | undefined,
  workspace?: string,
  tag?: string,
): string {
  const ws = workspace || DEFAULT_WORKSPACE;
  return buildDisplay(agent, ws, tag);
}

/**
 * Check if workspace/tag name is valid
 * Must be alphanumeric, hyphen, underscore, or dot
 */
export function isValidName(name: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(name);
}
