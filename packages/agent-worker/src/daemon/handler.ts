import type { Server } from "node:net";
import { tool, jsonSchema } from "ai";
import type { AgentSession } from "../agent/session.ts";
import type { SkillImporter } from "../agent/skills/index.ts";
import type { FeedbackEntry } from "../agent/tools/feedback.ts";
import type { ContextProvider } from "../workflow/context/provider.ts";
import { resolveSchedule, type SessionInfo, type ScheduleConfig } from "./registry.ts";
import { parseCron } from "./cron.ts";

export interface ServerState {
  session: AgentSession; // Always non-null: unified session for all backends
  server: Server;
  info: SessionInfo;
  lastActivity: number;
  pendingRequests: number;
  idleTimer?: ReturnType<typeof setTimeout>;
  scheduleTimer?: ReturnType<typeof setTimeout>; // Interval-based wakeup timer
  cronTimer?: ReturnType<typeof setTimeout>; // Cron-based wakeup timer
  inboxPollTimer?: ReturnType<typeof setInterval>; // Inbox polling timer
  importer?: SkillImporter; // For cleaning up imported skills
  getFeedback?: () => FeedbackEntry[]; // Populated when --feedback is enabled
  contextProvider?: ContextProvider; // Shared context for instance
  agentDisplayName?: string; // Agent name for channel operations (part before @)
}

export interface Request {
  action: string;
  payload?: unknown;
}

export interface Response {
  success: boolean;
  data?: unknown;
  error?: string;
}

export async function handleRequest(
  getState: () => ServerState | null,
  req: Request,
  resetIdleTimer: () => void,
  gracefulShutdown: () => Promise<void>,
  resetAllTimers?: () => void,
  onRequestDone?: () => void,
): Promise<Response> {
  const state = getState();
  if (!state) {
    return { success: false, error: "No active session" };
  }

  // Track activity
  state.pendingRequests++;
  resetIdleTimer();

  const { session, info } = state;

  try {
    switch (req.action) {
      case "ping":
        return {
          success: true,
          data: {
            id: info.id,
            model: info.model,
            backend: info.backend,
            name: info.name,
          },
        };

      case "send": {
        const {
          message,
          options,
          async: isAsync,
        } = req.payload as {
          message: string;
          options?: { autoApprove?: boolean };
          async?: boolean;
        };

        if (isAsync) {
          // Track async send as a pending request so idle timer and
          // shutdown wait for it to complete
          state.pendingRequests++;
          resetIdleTimer();
          session
            .send(message, options)
            .catch((error) => {
              console.error("Background send error:", error);
            })
            .finally(() => {
              const s = getState();
              if (s) {
                s.pendingRequests--;
                resetIdleTimer();
                if (s.pendingRequests === 0 && onRequestDone) {
                  onRequestDone();
                }
              }
            });

          return {
            success: true,
            data: {
              async: true,
              message: "Processing in background. Use `peek` to check the response.",
            },
          };
        }

        const response = await session.send(message, options);
        return { success: true, data: response };
      }

      case "tool_add": {
        const { name, description, parameters, needsApproval } = req.payload as {
          name: string;
          description: string;
          parameters: { type: "object"; properties: Record<string, unknown>; required?: string[] };
          needsApproval?: boolean;
        };
        // Create AI SDK tool from the CLI payload
        const t = tool({
          description,
          inputSchema: jsonSchema(parameters),
          execute: async () => ({ error: "No implementation - use tool mock to set response" }),
        });
        session.addTool(name, t);
        if (needsApproval) {
          session.setApproval(name, true);
        }
        return { success: true, data: { name } };
      }

      case "tool_mock": {
        const { name, response } = req.payload as { name: string; response: unknown };
        session.setMockResponse(name, response);
        return { success: true, data: { name } };
      }

      case "tool_list": {
        const tools = session.getTools();
        return { success: true, data: tools };
      }

      case "tool_import": {
        if (!session.supportsTools) {
          return { success: false, error: "Tool import not supported for CLI backends" };
        }
        const { filePath } = req.payload as { filePath: string };

        if (!filePath || typeof filePath !== "string") {
          return { success: false, error: "File path is required" };
        }

        let module: Record<string, unknown>;
        try {
          module = await import(filePath);
        } catch (importError) {
          const message = importError instanceof Error ? importError.message : String(importError);
          const sanitizedMsg = message.replace(filePath, "<file>");
          return { success: false, error: `Failed to import file: ${sanitizedMsg}` };
        }

        // Extract tools from module — expect Record<string, tool()> or { tools: Record }
        let toolsRecord: Record<string, unknown> = {};
        if (
          module.default &&
          typeof module.default === "object" &&
          !Array.isArray(module.default)
        ) {
          toolsRecord = module.default as Record<string, unknown>;
        } else if (typeof module.default === "function") {
          try {
            const result = await module.default();
            if (result && typeof result === "object" && !Array.isArray(result)) {
              toolsRecord = result as Record<string, unknown>;
            }
          } catch (factoryError) {
            const message =
              factoryError instanceof Error ? factoryError.message : String(factoryError);
            return { success: false, error: `Factory function failed: ${message}` };
          }
        } else if (
          module.tools &&
          typeof module.tools === "object" &&
          !Array.isArray(module.tools)
        ) {
          toolsRecord = module.tools as Record<string, unknown>;
        } else {
          return {
            success: false,
            error: 'No tools found. Export default Record<name, tool()> or named "tools" Record.',
          };
        }

        const imported: string[] = [];
        for (const [name, t] of Object.entries(toolsRecord)) {
          if (t && typeof t === "object") {
            session.addTool(name, t);
            imported.push(name);
          }
        }

        return {
          success: true,
          data: { imported },
        };
      }

      case "history":
        return { success: true, data: session.history() };

      case "stats":
        return { success: true, data: session.stats() };

      case "export":
        return { success: true, data: session.export() };

      case "clear":
        session.clear();
        return { success: true };

      case "pending":
        return { success: true, data: session.getPendingApprovals() };

      case "approve": {
        const { id } = req.payload as { id: string };
        const result = await session.approve(id);
        return { success: true, data: result };
      }

      case "deny": {
        const { id, reason } = req.payload as { id: string; reason?: string };
        session.deny(id, reason);
        return { success: true };
      }

      case "feedback_list": {
        if (!state.getFeedback) {
          return { success: false, error: "Feedback not enabled. Start agent with --feedback" };
        }
        return { success: true, data: state.getFeedback() };
      }

      case "schedule_get":
        return {
          success: true,
          data: info.schedule ?? null,
        };

      case "schedule_set": {
        const payload = req.payload as { wakeup?: string | number; prompt?: string };
        if (!payload?.wakeup && payload?.wakeup !== 0) {
          return {
            success: false,
            error:
              "Invalid schedule: provide wakeup (number ms, duration string, or cron expression)",
          };
        }
        const schedule: ScheduleConfig = {
          wakeup: payload.wakeup,
          prompt: payload.prompt,
        };
        // Validate upfront: resolveSchedule checks number/duration, parseCron checks cron syntax
        try {
          const resolved = resolveSchedule(schedule);
          if (resolved.type === "cron") {
            parseCron(resolved.expr!);
          }
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
        info.schedule = schedule;
        // Reset all timers so the new schedule takes effect immediately
        if (resetAllTimers) resetAllTimers();
        return { success: true, data: info.schedule };
      }

      case "schedule_clear":
        info.schedule = undefined;
        // Reset all timers to clear schedules
        if (resetAllTimers) resetAllTimers();
        return { success: true };

      case "shutdown":
        // Decrement before scheduling shutdown (we handle our own counter)
        state.pendingRequests--;
        // Stop accepting new connections immediately to prevent race
        state.server.close();
        // Schedule graceful shutdown on next tick to allow this response to be sent
        setImmediate(() => gracefulShutdown());
        return { success: true, data: "Shutting down" };

      default:
        return { success: false, error: `Unknown action: ${req.action}` };
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (getState() && req.action !== "shutdown") {
      state.pendingRequests--;
      // Notify daemon that a request completed (used to drain queued inbox)
      if (state.pendingRequests === 0 && onRequestDone) {
        onRequestDone();
      }
    }
  }
}
