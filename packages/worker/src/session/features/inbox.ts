/**
 * Inbox Source — external input abstraction for agents.
 *
 * Inbox is the agent's input view — what external messages
 * are waiting for this agent. Just a reader.
 *
 * At the worker layer, consumption is simple:
 * - Driver loop calls source.poll() to read new inputs
 * - Driver calls session.enqueue() for each input
 * - session.activate() dequeues and processes
 * - Dequeue IS acknowledgment — no explicit ack needed
 *
 * This is NOT an AgentFeature. Polling happens in the driver loop,
 * outside of the activation lifecycle. Features operate within
 * activations; inbox feeding operates between them.
 *
 * Workspace-layer concerns (cursor tracking, multi-agent routing)
 * are internal to the InboxSource implementation, not exposed here.
 */

import type { InputEnvelope } from "../types.ts";

// ── Inbox Source ────────────────────────────────────────────────

/**
 * Abstract inbox source — how the agent receives external inputs.
 *
 * Just a reader. No ack, no cursor management.
 * The workspace layer binds agent identity and cursor tracking
 * internally when creating the source.
 *
 * Implementations:
 * - WorkspaceInboxSource: reads from workspace channel/DM system
 * - DirectInboxSource: single message injection (for request/response)
 * - TestInboxSource: scripted inputs for testing
 */
export interface InboxSource {
  /** Read new inputs. Returns InputEnvelopes ready for the session. */
  poll(): Promise<InputEnvelope[]>;
}
