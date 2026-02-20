/**
 * Workflow Factory — Composable primitives for building workflow runtimes.
 *
 * These functions are the building blocks that both runner.ts (CLI direct)
 * and daemon.ts (service) use to create workflow infrastructure.
 *
 * Extracted from the monolithic runWorkflowWithControllers() so that
 * the daemon can create and manage workflow components independently.
 *
 * Usage:
 *   1. createMinimalRuntime()  — context + MCP + event log (the "workspace")
 *   2. createWiredController() — backend + workspace dir + controller (per agent)
 *   3. Caller manages lifecycle  — start/stop controllers, send kickoff, shutdown
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import type { ContextProvider } from "./context/provider.ts";
import {
  createFileContextProvider,
  FileContextProvider,
  getDefaultContextDir,
} from "./context/file-provider.ts";
import { createContextMCPServer } from "./context/mcp/server.ts";
import { runWithHttp, type HttpMCPServer } from "./context/http-transport.ts";
import { EventLog } from "./context/event-log.ts";
import type { Message } from "./context/types.ts";
import type { ResolvedAgent } from "./types.ts";
import type { Backend } from "../backends/types.ts";
import type { StreamParserCallbacks } from "../backends/stream-json.ts";
import { createAgentController } from "./controller/controller.ts";
import { getBackendByType, getBackendForModel } from "./controller/backend.ts";
import type { AgentController } from "./controller/types.ts";
import type { Logger } from "./logger.ts";
import { createSilentLogger } from "./logger.ts";
import type { FeedbackEntry } from "../agent/tools/feedback.ts";

// ── Runtime Handle ──────────────────────────────────────────────────

/**
 * A running workflow runtime — the shared infrastructure for agents.
 * Holds context provider, MCP server, event log.
 */
export interface WorkflowRuntimeHandle {
  /** Context provider (channel, inbox, documents, resources) */
  contextProvider: ContextProvider;
  /** Context directory path */
  contextDir: string;
  /** Whether context is persistent (bind mode) */
  persistent: boolean;
  /** Unified event log */
  eventLog: EventLog;
  /** HTTP MCP server */
  httpMcpServer: HttpMCPServer;
  /** MCP HTTP URL (http://127.0.0.1:<port>/mcp) */
  mcpUrl: string;
  /** MCP tool names (for stream parser dedup) */
  mcpToolNames: Set<string>;
  /** Project directory (cwd when runtime was created) */
  projectDir: string;
  /** Feedback accessor (when enabled) */
  getFeedback?: () => FeedbackEntry[];
  /** Shutdown runtime resources (MCP server, file locks) */
  shutdown: () => Promise<void>;
}

// ── Runtime Creation ────────────────────────────────────────────────

/**
 * Configuration for creating a minimal workflow runtime.
 *
 * This is the "workspace" that agents share: context + MCP + event log.
 * It does NOT create controllers or backends — those are per-agent concerns.
 */
export interface MinimalRuntimeConfig {
  /** Workflow name (e.g., "review", "global") */
  workflowName: string;
  /** Workflow tag (e.g., "main", "pr-123") */
  tag: string;
  /** Agent names in this workflow */
  agentNames: string[];
  /** Pre-created context provider (skip creation if provided) */
  contextProvider?: ContextProvider;
  /** Pre-resolved context directory (required when contextProvider is provided) */
  contextDir?: string;
  /** Whether pre-created context is persistent */
  persistent?: boolean;
  /** Callback when an agent is @mentioned */
  onMention?: (from: string, target: string, msg: Message) => void;
  /** Enable feedback tool */
  feedback?: boolean;
  /** Debug log function */
  debugLog?: (msg: string) => void;
}

/**
 * Create a minimal workflow runtime.
 *
 * Sets up the shared infrastructure (context + MCP + event log) without
 * creating controllers or backends. The daemon can use this to create
 * workflow infrastructure for both standalone and multi-agent workflows.
 *
 * For standalone agents created via `POST /agents`, this gives them
 * the same context infrastructure that workflow agents get.
 */
export async function createMinimalRuntime(
  config: MinimalRuntimeConfig,
): Promise<WorkflowRuntimeHandle> {
  const { workflowName, tag, agentNames, onMention, feedback: feedbackEnabled, debugLog } = config;

  // Resolve context provider
  let contextProvider: ContextProvider;
  let contextDir: string;
  let persistent = false;

  if (config.contextProvider && config.contextDir) {
    contextProvider = config.contextProvider;
    contextDir = config.contextDir;
    persistent = config.persistent ?? false;
  } else {
    // Create default file-based context
    contextDir = getDefaultContextDir(workflowName, tag);
    if (!existsSync(contextDir)) {
      mkdirSync(contextDir, { recursive: true });
    }
    contextProvider = createFileContextProvider(contextDir, agentNames);
    persistent = false;
  }

  // Mark run epoch so inbox ignores messages from previous runs
  await contextProvider.markRunStart();

  const projectDir = process.cwd();

  // Create MCP server
  let mcpGetFeedback: (() => FeedbackEntry[]) | undefined;
  let mcpToolNames = new Set<string>();
  const eventLog = new EventLog(contextProvider);

  const createMCPServerInstance = () => {
    const mcp = createContextMCPServer({
      provider: contextProvider,
      validAgents: agentNames,
      name: `${workflowName}-context`,
      version: "1.0.0",
      onMention,
      feedback: feedbackEnabled,
      debugLog,
    });
    mcpGetFeedback = mcp.getFeedback;
    mcpToolNames = mcp.mcpToolNames;
    return mcp.server;
  };

  const httpMcpServer = await runWithHttp({
    createServerInstance: createMCPServerInstance,
    port: 0,
  });

  const shutdown = async () => {
    if (persistent) {
      // Persistent mode: only release lock, preserve state
      if (contextProvider instanceof FileContextProvider) {
        contextProvider.releaseLock();
      }
    } else {
      // Ephemeral mode: clean up transient state + release lock
      await contextProvider.destroy();
    }
    await httpMcpServer.close();
  };

  return {
    contextProvider,
    contextDir,
    persistent,
    eventLog,
    httpMcpServer,
    mcpUrl: httpMcpServer.url,
    mcpToolNames,
    projectDir,
    getFeedback: mcpGetFeedback,
    shutdown,
  };
}

// ── Controller Creation ──────────────────────────────────────────────

/**
 * Subset of runtime fields needed by createWiredController.
 * Both WorkflowRuntimeHandle and runner's WorkflowRuntime satisfy this.
 */
export interface RuntimeContext {
  contextProvider: ContextProvider;
  contextDir: string;
  eventLog: EventLog;
  mcpUrl: string;
  mcpToolNames: Set<string>;
  projectDir: string;
}

/**
 * Configuration for creating a fully-wired agent controller.
 *
 * "Wired" means: backend is created, workspace directory is set up,
 * logging is configured. The caller just needs to call start().
 */
export interface WiredControllerConfig {
  /** Agent name */
  name: string;
  /** Resolved agent definition */
  agent: ResolvedAgent;
  /** The workflow runtime this agent belongs to */
  runtime: RuntimeContext;
  /** Poll interval in ms (default: 5000) */
  pollInterval?: number;
  /** Enable feedback tool */
  feedback?: boolean;
  /** Custom backend factory (overrides default resolution) */
  createBackend?: (agentName: string, agent: ResolvedAgent) => Backend;
  /** Logger for this agent's output */
  logger?: Logger;
}

/**
 * Result of creating a wired controller.
 */
export interface WiredControllerResult {
  /** The agent controller (call start() to begin) */
  controller: AgentController;
  /** The backend used by this controller */
  backend: Backend;
}

/**
 * Create a fully-wired agent controller.
 *
 * This handles the full setup:
 * 1. Create backend from agent definition (or use custom factory)
 * 2. Create isolated workspace directory
 * 3. Configure stream callbacks for structured event logging
 * 4. Create the AgentController with all wiring
 *
 * Extracted from runWorkflowWithControllers() so both runner.ts and
 * daemon.ts can create controllers with the same quality.
 */
export function createWiredController(config: WiredControllerConfig): WiredControllerResult {
  const { name, agent, runtime, pollInterval, feedback: feedbackEnabled } = config;

  const logger = config.logger ?? createSilentLogger();

  // Build structured stream callbacks for this agent
  const streamCallbacks: StreamParserCallbacks = {
    debugLog: (msg) => logger.debug(msg),
    outputLog: (msg) => runtime.eventLog.output(name, msg),
    toolCallLog: (toolName, args) => runtime.eventLog.toolCall(name, toolName, args, "backend"),
    mcpToolNames: runtime.mcpToolNames,
  };

  // Resolve backend
  let backend: Backend;
  if (config.createBackend) {
    backend = config.createBackend(name, agent);
  } else if (agent.backend) {
    backend = getBackendByType(agent.backend, {
      model: agent.model,
      provider: agent.provider,
      debugLog: (msg) => logger.debug(msg),
      streamCallbacks,
      timeout: agent.timeout,
    });
  } else if (agent.model) {
    backend = getBackendForModel(agent.model, {
      provider: agent.provider,
      debugLog: (msg) => logger.debug(msg),
      streamCallbacks,
    });
  } else {
    throw new Error(`Agent "${name}" requires either a backend or model field`);
  }

  // Create isolated workspace directory
  const workspaceDir = join(runtime.contextDir, "workspaces", name);
  if (!existsSync(workspaceDir)) {
    mkdirSync(workspaceDir, { recursive: true });
  }

  // Create the controller
  const controller = createAgentController({
    name,
    agent,
    contextProvider: runtime.contextProvider,
    eventLog: runtime.eventLog,
    mcpUrl: runtime.mcpUrl,
    workspaceDir,
    projectDir: runtime.projectDir,
    backend,
    pollInterval,
    log: (msg) => logger.debug(msg),
    infoLog: (msg) => logger.info(msg),
    errorLog: (msg) => logger.error(msg),
    feedback: feedbackEnabled,
  });

  return { controller, backend };
}
