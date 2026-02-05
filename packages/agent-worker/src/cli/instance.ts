/**
 * Instance naming utilities
 *
 * Format: agent@instance (email style)
 * - agent: agent name (required)
 * - instance: instance name (optional, defaults to 'default')
 *
 * Examples:
 * - "reviewer" → { agent: "reviewer", instance: "default" }
 * - "reviewer@pr-123" → { agent: "reviewer", instance: "pr-123" }
 * - "reviewer@default" → { agent: "reviewer", instance: "default" }
 */

export const DEFAULT_INSTANCE = 'default'

export interface AgentIdentifier {
  agent: string
  instance: string
  /** Full identifier: agent@instance */
  full: string
}

/**
 * Parse agent identifier from string
 * Supports: "agent", "agent@instance"
 */
export function parseAgentId(input: string): AgentIdentifier {
  const atIndex = input.indexOf('@')

  if (atIndex === -1) {
    // No instance specified
    return {
      agent: input,
      instance: DEFAULT_INSTANCE,
      full: `${input}@${DEFAULT_INSTANCE}`,
    }
  }

  const agent = input.slice(0, atIndex)
  const instance = input.slice(atIndex + 1) || DEFAULT_INSTANCE

  return {
    agent,
    instance,
    full: `${agent}@${instance}`,
  }
}

/**
 * Build full agent identifier from parts
 */
export function buildAgentId(agent: string, instance?: string): string {
  const inst = instance || DEFAULT_INSTANCE
  return `${agent}@${inst}`
}

/**
 * Check if instance name is valid
 * Must be alphanumeric, hyphen, or underscore
 */
export function isValidInstanceName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name)
}

/**
 * Normalize agent target for lookup
 * Handles both old-style names and new agent@instance format
 */
export function normalizeTarget(target?: string): string | undefined {
  if (!target) return undefined

  // If already has @, return as-is
  if (target.includes('@')) {
    return target
  }

  // Old-style name without instance - don't add @default
  // to maintain backwards compatibility with existing sessions
  return target
}
