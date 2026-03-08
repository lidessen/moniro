/**
 * Agent features and input abstractions.
 *
 * Features compose into AgentSession as AgentFeature instances:
 *   conversation(config) — conversation persistence
 *
 * Input abstractions (used by driver loops, not features):
 *   InboxSource — external input polling
 */

export { conversation } from "./conversation.ts";
export type { ConversationFeatureConfig } from "./conversation.ts";

export type { InboxSource } from "./inbox.ts";
