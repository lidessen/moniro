/**
 * Conversation Feature — persistence for agent conversation history.
 *
 * The session itself handles conversation continuity:
 * - ThinThread (bounded buffer) is built into AgentSession
 * - buildMessages() injects thinThread as proper role-based messages
 *
 * This feature adds persistence on top:
 * - Records user input + assistant output to ConversationLog (JSONL)
 * - Without this feature: conversation is in-memory only, lost on restart
 * - With this feature: conversation survives across sessions
 *
 * Does NOT produce a prompt section — buildMessages() already
 * handles conversation injection as message history. Duplicating
 * it as a prompt section would waste context and confuse the model.
 */

import type { ConversationLog, ConversationMessage } from "../../conversation.ts";
import type { AgentFeature, ActivationContext } from "../feature.ts";

// ── Config ──────────────────────────────────────────────────────

export interface ConversationFeatureConfig {
  /** Conversation log for persistence */
  log: ConversationLog;
}

// ── Feature ─────────────────────────────────────────────────────

/**
 * Create a conversation feature for persistent conversation history.
 *
 * Usage:
 * ```ts
 * const session = new AgentSession({
 *   features: [
 *     conversation({ log: new ConversationLog(path) }),
 *   ],
 * });
 * ```
 */
export function conversation(config: ConversationFeatureConfig): AgentFeature {
  const { log } = config;

  return {
    name: "conversation",

    afterActivation(ctx: ActivationContext): void {
      if (!ctx.outcome) return;

      // Persist user input
      const batch = ctx.snapshot.inputBatch;
      const realInputs = batch.filter((b) => b.kind !== "resume");
      if (realInputs.length > 0) {
        const userContent =
          realInputs.length === 1
            ? realInputs[0]!.content
            : realInputs
                .map((b) => {
                  const prefix = b.source ? `[${b.source}] ` : "";
                  return `${prefix}${b.content}`;
                })
                .join("\n\n---\n\n");

        const userMsg: ConversationMessage = {
          role: "user",
          content: userContent,
          timestamp: new Date().toISOString(),
        };
        log.append(userMsg);
      }

      // Persist assistant output (only on non-failure)
      if (ctx.outcome.content && ctx.outcome.result !== "failed") {
        const assistantMsg: ConversationMessage = {
          role: "assistant",
          content: ctx.outcome.content,
          timestamp: new Date().toISOString(),
        };
        log.append(assistantMsg);
      }
    },
  };
}
