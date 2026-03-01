/**
 * Workflow Factory — Composable primitives for building workflow runtimes.
 *
 * These functions are the building blocks that both runner.ts (CLI direct)
 * and daemon.ts (service) use to create workflow infrastructure.
 *
 * Extracted from the monolithic runWorkflowWithLoops() so that
 * the daemon can create and manage workflow components independently.
 *
 * Usage:
 *   1. createMinimalRuntime()  — context + MCP + event log (the "workspace")
 *   2. createWiredLoop()       — backend + workspace dir + loop (per agent)
 *   3. Caller manages lifecycle  — start/stop loops, send kickoff, shutdown
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
import type { ResolvedWorkflowAgent } from "./types.ts";
import type { Backend } from "../backends/types.ts";
import type { StreamParserCallbacks } from "../backends/stream-json.ts";
import { createAgentLoop } from "./loop/loop.ts";
import { getBackendByType, getBackendForModel } from "./loop/backend.ts";
import type { AgentLoop } from "./loop/types.ts";
import { isAutoProvider, resolveModelFallback } from "../agent/models.ts";
import type { Logger } from "./logger.ts";
import { createSilentLogger } from "./logger.ts";
import type { FeedbackEntry } from "../agent/tools/feedback.ts";
import type { ConversationLog, ThinThread } from "../agent/conversation.ts";

// ── Workspace ───────────────────────────────────────────────────────

/**
 * Workspace — shared infrastructure for agents collaborating in a context.
 *
 * A workspace provides the collaboration space: context provider (channel,
 * inbox, documents), MCP server, and event log. Both standalone agents
 * and workflow agents operate within a workspace.
 *
 * Formerly WorkflowRuntimeHandle.
 */
export interface Workspace {
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
 * It does NOT create loops or backends — those are per-agent concerns.
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
 * creating loops or backends. The daemon can use this to create
 * workflow infrastructure for both standalone and multi-agent workflows.
 *
 * For standalone agents created via `POST /agents`, this gives them
 * the same context infrastructure that workflow agents get.
 */
export async function createMinimalRuntime(
  config: MinimalRuntimeConfig,
): Promise<Workspace> {
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

// ── Loop Creation ────────────────────────────────────────────────────

/**
 * Subset of runtime fields needed by createWiredLoop.
 * Both Workspace and runner's WorkflowRuntime satisfy this.
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
 * Configuration for creating a fully-wired agent loop.
 *
 * "Wired" means: backend is created, workspace directory is set up,
 * logging is configured. The caller just needs to call start().
 */
export interface WiredLoopConfig {
  /** Agent name */
  name: string;
  /** Resolved agent definition */
  agent: ResolvedWorkflowAgent;
  /** The workflow runtime this agent belongs to */
  runtime: RuntimeContext;
  /** Poll interval in ms (default: 5000) */
  pollInterval?: number;
  /** Enable feedback tool */
  feedback?: boolean;
  /** Custom backend factory (overrides default resolution) */
  createBackend?: (agentName: string, agent: ResolvedWorkflowAgent) => Backend;
  /** Logger for this agent's output */
  logger?: Logger;
  /** Conversation log for persistence (standalone agents) */
  conversationLog?: ConversationLog;
  /** Thin thread for bounded conversation context (standalone agents) */
  thinThread?: ThinThread;
}

/**
 * Result of creating a wired loop.
 */
export interface WiredLoopResult {
  /** The agent loop (call start() to begin) */
  loop: AgentLoop;
  /** The backend used by this loop */
  backend: Backend;
}

/**
 * Create a fully-wired agent loop.
 *
 * This handles the full setup:
 * 1. Create backend from agent definition (or use custom factory)
 * 2. Create isolated workspace directory
 * 3. Configure stream callbacks for structured event logging
 * 4. Create the AgentLoop with all wiring
 *
 * Extracted from runWorkflowWithLoops() so both runner.ts and
 * daemon.ts can create loops with the same quality.
 */
export function createWiredLoop(config: WiredLoopConfig): WiredLoopResult {
  const { name, agent, runtime, pollInterval, feedback: feedbackEnabled } = config;

  const logger = config.logger ?? createSilentLogger();

  // Create isolated workspace directory (before backend, so we can pass it)
  const workspaceDir = join(runtime.contextDir, "workspaces", name);
  if (!existsSync(workspaceDir)) {
    mkdirSync(workspaceDir, { recursive: true });
  }

  // Build structured stream callbacks for this agent
  const streamCallbacks: StreamParserCallbacks = {
    debugLog: (msg) => logger.debug(msg),
    outputLog: (msg) => runtime.eventLog.output(name, msg),
    toolCallLog: (toolName, args) => runtime.eventLog.toolCall(name, toolName, args, "backend"),
    mcpToolNames: runtime.mcpToolNames,
  };

  // Resolve "auto" / fallback chain (AGENT_MODEL env) before backend creation
  let effectiveModel: string | undefined;
  let effectiveProvider = agent.provider;
  if (isAutoProvider(agent.model) || isAutoProvider(agent.provider)) {
    const resolved = resolveModelFallback({
      model: agent.model,
      provider: typeof agent.provider === "string" ? agent.provider : undefined,
    });
    effectiveModel = resolved.model;
    effectiveProvider = resolved.provider;
    logger.info(`Model resolved: ${effectiveModel}`);
  } else {
    effectiveModel = agent.model;
  }

  // Resolve backend (workspace passed so CLI backends use it as cwd)
  let backend: Backend;
  if (config.createBackend) {
    backend = config.createBackend(name, agent);
  } else if (agent.backend) {
    backend = getBackendByType(agent.backend, {
      model: effectiveModel,
      provider: effectiveProvider,
      debugLog: (msg) => logger.debug(msg),
      streamCallbacks,
      timeout: agent.timeout,
      workspace: workspaceDir,
    });
  } else if (effectiveModel) {
    backend = getBackendForModel(effectiveModel, {
      provider: effectiveProvider,
      debugLog: (msg) => logger.debug(msg),
      streamCallbacks,
      workspace: workspaceDir,
    });
  } else {
    throw new Error(`Agent "${name}" requires either a backend or model field`);
  }

  // Pass resolved model/provider to the loop so SDK runner uses the concrete
  // model instead of the raw "auto" value from the workflow YAML.
  const resolvedAgent: ResolvedWorkflowAgent =
    effectiveModel !== agent.model || effectiveProvider !== agent.provider
      ? { ...agent, model: effectiveModel, provider: effectiveProvider }
      : agent;

  // Create the loop
  const loop = createAgentLoop({
    name,
    agent: resolvedAgent,
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
    conversationLog: config.conversationLog,
    thinThread: config.thinThread,
  });

  return { loop, backend };
}
