/**
 * Prompt assembly types for personal agents.
 *
 * These are independent of workspace-specific context (no inbox, channel, etc.).
 * A personal agent can build its prompt using only these types.
 */

import type { AgentSoul } from "@moniro/agent-loop";
import type { PersonalContext } from "@/context/types.ts";

/**
 * Context available to personal prompt sections.
 *
 * This is the minimal context needed for personal agent prompt building.
 * Workspace layers can extend this with collaboration-specific fields.
 */
export interface PersonalPromptContext {
  /** Agent name */
  name: string;
  /** Agent's personal context (soul, memory, todos) */
  personalContext?: PersonalContext;
}

/**
 * A prompt section: receives context, returns content or null (skip).
 * Each section is independent and can be added/removed/reordered.
 */
export type PersonalPromptSection = (ctx: PersonalPromptContext) => string | null;
