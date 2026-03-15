/**
 * EventLog — unified event entry point.
 *
 * All channel events (tool calls, system logs, runtime output, debug)
 * should flow through this class instead of calling appendChannel() directly.
 * This ensures consistent kind/toolCall/source fields across all event sources.
 */

import type { ContextProvider } from "./provider.ts";
import type { ToolCallSource } from "./types.ts";

export class EventLog {
  constructor(private provider: ContextProvider) {}

  /** Record a tool invocation (MCP, SDK, or runtime native) */
  toolCall(agent: string, name: string, args: string, source: ToolCallSource): void {
    this.provider
      .appendChannel(agent, `${name}(${args})`, {
        kind: "tool_call",
        toolCall: { name, args, source },
      })
      .catch(() => {});
  }

  /** Record an operational log (workflow lifecycle, warnings, errors) */
  system(from: string, message: string): void {
    this.provider.appendChannel(from, message, { kind: "system" }).catch(() => {});
  }

  /** Record runtime streaming text output (not tool calls) */
  output(agent: string, text: string): void {
    this.provider.appendChannel(agent, text, { kind: "output" }).catch(() => {});
  }

  /** Record debug-level detail (only shown with --debug) */
  debug(from: string, message: string): void {
    this.provider.appendChannel(from, message, { kind: "debug" }).catch(() => {});
  }
}
