/**
 * Instance naming utilities (DEPRECATED)
 *
 * @deprecated This module is deprecated. Use target.ts instead for the new workflow:tag model.
 * This file now re-exports from target.ts for backward compatibility.
 *
 * Old format: agent@instance (email style)
 * New format: agent@workflow:tag (Docker-style)
 *
 * Migration:
 * - Replace "instance" with "workflow:tag" terminology
 * - Use parseTarget() instead of parseAgentId() for full functionality
 * - Use buildTarget() instead of buildAgentId() for workflow:tag support
 */

// Re-export backward-compatible APIs from target.ts
export {
  DEFAULT_INSTANCE,
  type AgentIdentifier,
  parseAgentId,
  buildAgentId,
  isValidInstanceName,
} from "./target.ts";
