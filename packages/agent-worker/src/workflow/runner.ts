/**
 * Workflow Runner
 *
 * All output flows through the channel:
 * - Operational events (init, setup, connect) → kind="log" (always visible)
 * - Debug details (MCP traces, idle checks) → kind="debug" (visible with --debug)
 * - Agent messages → kind=undefined (always visible)
 *
 * The display layer (display.ts) handles filtering and formatting.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ParsedWorkflow,
  SetupTask,
  ResolvedAgent,
  ResolvedContext,
  ResolvedFileContext,
} from "./types.ts";
import { interpolate, createContext, type VariableContext } from "./interpolate.ts";
import { createFileContextProvider, FileContextProvider } from "./context/file-provider.ts";
import { createMemoryContextProvider } from "./context/memory-provider.ts";
import { createContextMCPServer } from "./context/mcp-server.ts";
import { runWithHttp, type HttpMCPServer } from "./context/http-transport.ts";
import type { ContextProvider } from "./context/provider.ts";
import {
  createAgentController,
  checkWorkflowIdle,
  getBackendForModel,
  getBackendByType,
  type AgentController,
} from "./controller/index.ts";
import type { Backend } from "../backends/types.ts";
import { startChannelWatcher } from "./display.ts";
import { createChannelLogger, createSilentLogger, type Logger } from "./logger.ts";

const execAsync = promisify(exec);

/**
 * Workflow run configuration
 */
export interface RunConfig {
  /** Workflow to run */
  workflow: ParsedWorkflow;
  /** Workflow name (defaults to "global") */
  workflowName?: string;
  /** Workflow tag (defaults to "main") */
  tag?: string;
  /** @deprecated Use workflowName instead. Instance name */
  instance?: string;
  /** Agent startup function */
  startAgent: (agentName: string, config: ResolvedAgent, mcpUrl: string) => Promise<void>;
  /** Callback when an agent @mentions another agent */
  onMention?: (from: string, target: string, msg: import("./context/types.ts").Message) => void;
  /** Debug log function for MCP tool calls */
  debugLog?: (message: string) => void;
  /** Logger instance */
  logger?: Logger;
  /** Pre-created context provider (skips provider creation) */
  contextProvider?: ContextProvider;
  /** Pre-resolved context directory (required when contextProvider is provided) */
  contextDir?: string;
  /** Whether context is persistent (bind mode) */
  persistent?: boolean;
  /** Enable feedback tool on MCP server */
  feedback?: boolean;
}

/**
 * Workflow run result
 */
export interface RunResult {
  /** Success flag */
  success: boolean;
  /** Error if failed */
  error?: string;
  /** Setup variable results */
  setupResults: Record<string, string>;
  /** Execution time in ms */
  duration: number;
  /** MCP HTTP URL (for external agents) */
  mcpUrl?: string;
  /** Context provider for polling/reading state */
  contextProvider?: ContextProvider;
  /** Agent names in the workflow */
  agentNames?: string[];
  /** Shutdown function */
  shutdown?: () => Promise<void>;
}

/**
 * Workflow runtime instance
 */
export interface WorkflowRuntime {
  /** Workflow name */
  name: string;
  /** Instance name */
  instance: string;
  /** Context directory (for shared channel, documents, workspaces) */
  contextDir: string;
  /** Project directory (the codebase agents work on) */
  projectDir: string;
  /** Context provider */
  contextProvider: ContextProvider;
  /** HTTP MCP server */
  httpMcpServer: HttpMCPServer;
  /** MCP HTTP URL (http://127.0.0.1:<port>/mcp) */
  mcpUrl: string;
  /** Agent names */
  agentNames: string[];
  /** Setup results */
  setupResults: Record<string, string>;
  /** Send kickoff message */
  sendKickoff: () => Promise<void>;
  /** Shutdown all resources */
  shutdown: () => Promise<void>;
  /** Retrieve collected feedback (only when feedback enabled) */
  getFeedback?: () => import("../agent/tools/feedback.ts").FeedbackEntry[];
}

// ==================== Provider Creation ====================

/**
 * Create context provider and resolve context directory from workflow config.
 * Extracted so the channel logger can be created before full init.
 */
export function createWorkflowProvider(
  workflow: ParsedWorkflow,
  _workflowName: string,
  tag: string,
): { contextProvider: ContextProvider; contextDir: string; persistent: boolean } {
  const agentNames = Object.keys(workflow.agents);

  if (!workflow.context) {
    throw new Error(
      'Workflow context is disabled. Remove "context: false" to enable agent collaboration.',
    );
  }

  const resolvedContext = workflow.context as ResolvedContext;

  if (resolvedContext.provider === "memory") {
    return {
      contextProvider: createMemoryContextProvider(agentNames),
      contextDir: join(tmpdir(), `agent-worker-${workflow.name}-${tag}`),
      persistent: false,
    };
  }

  // File provider (default or bind)
  const fileContext = resolvedContext as ResolvedFileContext;
  const contextDir = fileContext.dir;
  const persistent = fileContext.persistent === true;

  if (!existsSync(contextDir)) {
    mkdirSync(contextDir, { recursive: true });
  }

  const fileProvider = createFileContextProvider(contextDir, agentNames);
  fileProvider.acquireLock();

  return {
    contextProvider: fileProvider,
    contextDir,
    persistent,
  };
}

// ==================== Init ====================

/**
 * Initialize workflow runtime
 *
 * This sets up:
 * 1. Context provider (file or memory) — or uses pre-created one
 * 2. Context directory (for file provider)
 * 3. MCP server (HTTP)
 * 4. Runs setup commands
 */
export async function initWorkflow(config: RunConfig): Promise<WorkflowRuntime> {
  const {
    workflow,
    workflowName: workflowNameParam,
    tag: tagParam,
    instance,
    onMention,
    debugLog,
    feedback: feedbackEnabled,
  } = config;

  // Extract workflow name and tag
  const workflowName = workflowNameParam ?? instance ?? "global";
  const tag = tagParam ?? "main";

  // Use provided logger, or create a silent one
  const logger = config.logger ?? createSilentLogger();

  const startTime = Date.now();
  const agentNames = Object.keys(workflow.agents);

  // Use pre-created provider or create one
  let contextProvider: ContextProvider;
  let contextDir: string;
  let isPersistent = false;

  if (config.contextProvider && config.contextDir) {
    contextProvider = config.contextProvider;
    contextDir = config.contextDir;
    isPersistent = config.persistent ?? false;
    logger.debug("Using pre-created context provider");
  } else {
    const created = createWorkflowProvider(workflow, workflowName, tag);
    contextProvider = created.contextProvider;
    contextDir = created.contextDir;
    isPersistent = created.persistent;
    const mode = isPersistent ? "persistent (bind)" : "ephemeral";
    logger.debug(`Context directory: ${contextDir} [${mode}]`);

    // Mark run epoch so inbox ignores messages from previous runs
    await contextProvider.markRunStart();
  }

  // Project directory is where the workflow was invoked from
  const projectDir = process.cwd();

  // Create MCP server (HTTP)
  let mcpGetFeedback: (() => import("../agent/tools/feedback.ts").FeedbackEntry[]) | undefined;
  const createMCPServerInstance = () => {
    const mcp = createContextMCPServer({
      provider: contextProvider,
      validAgents: agentNames,
      name: `${workflow.name}-context`,
      version: "1.0.0",
      onMention,
      feedback: feedbackEnabled,
      debugLog,
    });
    mcpGetFeedback = mcp.getFeedback;
    return mcp.server;
  };

  const httpMcpServer = await runWithHttp({
    createServerInstance: createMCPServerInstance,
    port: 0,
    onConnect: (agentId, sessionId) => {
      logger.debug(`Agent connected: ${agentId} (${sessionId.slice(0, 8)})`);
    },
    onDisconnect: (agentId, sessionId) => {
      logger.debug(`Agent disconnected: ${agentId} (${sessionId.slice(0, 8)})`);
    },
  });

  logger.debug(`MCP server: ${httpMcpServer.url}`);

  // Run setup commands
  const setupResults: Record<string, string> = {};
  const context = createContext(workflow.name, tag, setupResults);

  if (workflow.setup && workflow.setup.length > 0) {
    logger.info("Running setup...");
    for (const task of workflow.setup) {
      try {
        const result = await runSetupTask(task, context, logger);
        if (task.as) {
          setupResults[task.as] = result;
          context[task.as] = result;
        }
      } catch (error) {
        // Release lock before propagating error
        if (contextProvider instanceof FileContextProvider) {
          contextProvider.releaseLock();
        }
        await httpMcpServer.close();
        throw new Error(`Setup failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // Interpolate kickoff with setup results
  const interpolatedKickoff = workflow.kickoff
    ? interpolate(workflow.kickoff, context, (msg) => logger.warn(msg))
    : undefined;

  // Build runtime
  const runtime: WorkflowRuntime = {
    name: workflow.name,
    instance: instance ?? `${workflowName}:${tag}`,
    contextDir,
    projectDir,
    contextProvider,
    httpMcpServer,
    mcpUrl: httpMcpServer.url,
    agentNames,
    setupResults,

    async sendKickoff() {
      if (!interpolatedKickoff) {
        logger.debug("No kickoff message configured");
        return;
      }

      logger.debug(`Kickoff: ${interpolatedKickoff.slice(0, 100)}...`);

      // Send kickoff as 'system' to the channel (smartSend auto-converts long messages to resources)
      await contextProvider.smartSend("system", interpolatedKickoff);
    },

    async shutdown() {
      logger.debug("Shutting down...");
      if (isPersistent) {
        // Persistent (bind) mode: only release lock, preserve all state for resume
        if (contextProvider instanceof FileContextProvider) {
          contextProvider.releaseLock();
        }
      } else {
        // Ephemeral mode: clean up transient state + release lock
        await contextProvider.destroy();
      }
      await httpMcpServer.close();
    },

    getFeedback: mcpGetFeedback,
  };

  logger.debug(`Workflow initialized in ${Date.now() - startTime}ms`);
  logger.debug(`Agents: ${agentNames.join(", ")}`);

  return runtime;
}

/**
 * Run a setup task
 */
async function runSetupTask(
  task: SetupTask,
  context: VariableContext,
  logger: Logger,
): Promise<string> {
  const command = interpolate(task.shell, context);

  const displayCmd = command.length > 60 ? command.slice(0, 60) + "..." : command;
  logger.debug(`  $ ${displayCmd}`);

  try {
    // Capture both stdout and stderr to prevent unwanted error output
    const { stdout, stderr } = await execAsync(command);
    const result = stdout.trim();

    // Log stderr as debug if present (not as error, since many commands write to stderr)
    if (stderr && stderr.trim()) {
      logger.debug(`  stderr: ${stderr.trim().slice(0, 100)}${stderr.length > 100 ? "..." : ""}`);
    }

    if (task.as) {
      const displayResult = result.length > 60 ? result.slice(0, 60) + "..." : result;
      logger.debug(`  ${task.as} = ${displayResult}`);
    }

    return result;
  } catch (error) {
    throw new Error(
      `Command failed: ${command}\n${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Run a workflow (start mode)
 *
 * This initializes the runtime, starts agents, and sends kickoff.
 * Agents remain running until explicitly stopped.
 */
export async function runWorkflow(config: RunConfig): Promise<RunResult> {
  const { workflow } = config;
  const logger = config.logger ?? createSilentLogger();
  const startTime = Date.now();

  try {
    // Initialize runtime
    const runtime = await initWorkflow(config);

    // Start all agents with MCP config
    logger.info("Starting agents...");

    for (const agentName of runtime.agentNames) {
      const agentDef = workflow.agents[agentName]!;
      try {
        await config.startAgent(agentName, agentDef, runtime.mcpUrl);
        logger.debug(`Started: ${agentName}`);
      } catch (error) {
        await runtime.shutdown();
        return {
          success: false,
          error: `Failed to start agent ${agentName}: ${error instanceof Error ? error.message : String(error)}`,
          setupResults: runtime.setupResults,
          duration: Date.now() - startTime,
        };
      }
    }

    // Send kickoff
    await runtime.sendKickoff();

    return {
      success: true,
      setupResults: runtime.setupResults,
      duration: Date.now() - startTime,
      mcpUrl: runtime.mcpUrl,
      contextProvider: runtime.contextProvider,
      agentNames: runtime.agentNames,
      shutdown: () => runtime.shutdown(),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      setupResults: {},
      duration: Date.now() - startTime,
    };
  }
}

// ==================== Controller-based Runner ====================

/**
 * Controller-based run configuration
 */
export interface ControllerRunConfig {
  /** Workflow to run */
  workflow: ParsedWorkflow;
  /** Workflow name (defaults to "global") */
  workflowName?: string;
  /** Workflow tag (defaults to "main") */
  tag?: string;
  /** @deprecated Use workflowName instead. Instance name */
  instance?: string;
  /** Debug mode (show debug channel entries in output) */
  debug?: boolean;
  /** Log function (for terminal output) */
  log?: (message: string) => void;
  /** Run mode: 'run' exits when idle, 'start' runs until stopped */
  mode?: "run" | "start";
  /** Poll interval for controllers (ms) */
  pollInterval?: number;
  /** Custom backend factory (optional, defaults to getBackendForModel) */
  createBackend?: (agentName: string, agent: ResolvedAgent) => Backend;
  /** Enable feedback tool for all workflow agents */
  feedback?: boolean;
  /** Use pretty display mode (with @clack/prompts) */
  prettyDisplay?: boolean;
}

/**
 * Controller-based run result
 */
export interface ControllerRunResult {
  /** Success flag */
  success: boolean;
  /** Error if failed */
  error?: string;
  /** Setup variable results */
  setupResults: Record<string, string>;
  /** Execution time in ms */
  duration: number;
  /** MCP HTTP URL */
  mcpUrl?: string;
  /** Context provider */
  contextProvider?: ContextProvider;
  /** Agent controllers */
  controllers?: Map<string, AgentController>;
  /** Shutdown function */
  shutdown?: () => Promise<void>;
  /** Feedback entries collected during workflow (when --feedback enabled, run mode) */
  feedback?: import("../agent/tools/feedback.ts").FeedbackEntry[];
  /** Live feedback accessor (when --feedback enabled, start mode) */
  getFeedback?: () => import("../agent/tools/feedback.ts").FeedbackEntry[];
}

/**
 * Run a workflow with agent controllers
 *
 * All output flows through the channel. The channel watcher (display layer)
 * filters what to show: --debug includes kind="debug" entries.
 */
export async function runWorkflowWithControllers(
  config: ControllerRunConfig,
): Promise<ControllerRunResult> {
  const {
    workflow,
    workflowName: workflowNameParam,
    tag: tagParam,
    instance,
    debug = false,
    log = console.log,
    mode = "run",
    pollInterval = 5000,
    createBackend,
    feedback: feedbackEnabled,
  } = config;
  const startTime = Date.now();

  // Extract workflow name and tag
  const workflowName = workflowNameParam ?? instance ?? "global";
  const tag = tagParam ?? "main";

  try {
    // 1. Create context provider first (so channel logger can use it)
    const { contextProvider, contextDir, persistent } = createWorkflowProvider(
      workflow,
      workflowName,
      tag,
    );

    // Capture current channel position so watcher skips entries from previous runs
    const { cursor: channelStart } = await contextProvider.tailChannel(0);

    // Mark run epoch: inbox will ignore messages before this point
    await contextProvider.markRunStart();

    // 2. Create channel logger — all output goes to channel
    const logger = createChannelLogger({ provider: contextProvider, from: "workflow" });

    logger.info(`Running workflow: ${workflow.name}`);
    logger.info(`Agents: ${Object.keys(workflow.agents).join(", ")}`);
    logger.debug("Starting workflow with controllers", { mode, instance, pollInterval });

    // 3. Create controllers map for wake() on mention
    const controllers = new Map<string, AgentController>();

    logger.debug("Initializing workflow runtime...");

    // 4. Initialize runtime with pre-created provider and channel logger
    const runtime = await initWorkflow({
      workflow,
      instance,
      startAgent: async () => {}, // Not used; controllers start agents below
      logger,
      contextProvider,
      contextDir,
      persistent,
      onMention: (from, target, entry) => {
        const controller = controllers.get(target);
        if (controller) {
          const preview =
            entry.content.length > 80 ? entry.content.slice(0, 80) + "..." : entry.content;
          logger.debug(`@mention: ${from} → @${target} (state=${controller.state}): ${preview}`);
          controller.wake();
        } else {
          logger.debug(`@mention: ${from} → @${target} (no controller found!)`);
        }
      },
      // Tool calls are important - show them in normal mode (not just debug)
      debugLog: (msg) => {
        if (msg.startsWith("CALL ")) {
          logger.info(msg); // Tool calls → always visible
        } else {
          logger.debug(msg); // Other debug info → debug only
        }
      },
      feedback: feedbackEnabled,
    });

    logger.debug("Runtime initialized", {
      agentNames: runtime.agentNames,
      mcpUrl: runtime.mcpUrl,
    });

    // 5. Create and start controllers for each agent
    logger.info("Starting agents...");

    for (const agentName of runtime.agentNames) {
      const agentDef = workflow.agents[agentName]!;

      logger.debug(`Creating controller for ${agentName}`, {
        backend: agentDef.backend,
        model: agentDef.model,
      });

      // Get backend for this agent
      // Tool calls are shown in normal mode, other debug info only in debug mode
      const backendDebugLog = (msg: string) => {
        if (msg.startsWith("CALL ")) {
          logger.info(msg); // Tool calls → always visible
        } else {
          logger.debug(msg); // Other debug info → debug only
        }
      };
      let backend: Backend;
      if (createBackend) {
        backend = createBackend(agentName, agentDef);
      } else if (agentDef.backend) {
        backend = getBackendByType(agentDef.backend, {
          model: agentDef.model,
          debugLog: backendDebugLog,
          timeout: agentDef.timeout,
        });
      } else if (agentDef.model) {
        backend = getBackendForModel(agentDef.model, { debugLog: backendDebugLog });
      } else {
        throw new Error(`Agent "${agentName}" requires either a backend or model field`);
      }

      logger.debug(`Using backend: ${backend.type} for ${agentName}`);

      // Each agent gets an isolated workspace directory
      const workspaceDir = join(runtime.contextDir, "workspaces", agentName);
      if (!existsSync(workspaceDir)) {
        mkdirSync(workspaceDir, { recursive: true });
      }

      const controllerLogger = logger.child(agentName);
      const controller = createAgentController({
        name: agentName,
        agent: agentDef,
        contextProvider: runtime.contextProvider,
        mcpUrl: runtime.mcpUrl,
        workspaceDir,
        projectDir: runtime.projectDir,
        backend,
        pollInterval,
        log: (msg) => controllerLogger.debug(msg),
        infoLog: (msg) => controllerLogger.info(msg),
        errorLog: (msg) => controllerLogger.error(msg),
        feedback: feedbackEnabled,
      });

      controllers.set(agentName, controller);
      await controller.start();

      logger.debug(`Controller started: ${agentName}`);
    }

    // 6. Send kickoff
    logger.debug("Sending kickoff message...");
    await runtime.sendKickoff();
    logger.debug("Kickoff sent");

    // 7. Start channel watcher — the unified display layer
    // Skip entries from previous runs — channelStart was captured before any current-run writes
    let channelWatcher: { stop: () => void } | undefined;

    if (config.prettyDisplay) {
      // Pretty display mode (non-debug, non-json)
      const { startPrettyDisplay } = await import("./display-pretty.ts");
      channelWatcher = startPrettyDisplay({
        contextProvider: runtime.contextProvider,
        agentNames: runtime.agentNames,
        initialCursor: channelStart,
        pollInterval: 250,
      });
    } else {
      // Standard display mode (debug or programmatic)
      channelWatcher = startChannelWatcher({
        contextProvider: runtime.contextProvider,
        agentNames: runtime.agentNames,
        log,
        showDebug: debug,
        initialCursor: channelStart,
        pollInterval: 250, // Fast polling for responsive output
      });
    }

    // Handle run mode vs start mode
    if (mode === "run") {
      logger.debug('Running in "run" mode, waiting for completion...');

      let idleCheckCount = 0;
      while (true) {
        const isIdle = await checkWorkflowIdle(controllers, runtime.contextProvider);
        idleCheckCount++;

        if (idleCheckCount % 10 === 0) {
          const states = [...controllers.entries()].map(([n, c]) => `${n}=${c.state}`).join(", ");
          logger.debug(`Idle check #${idleCheckCount}: ${states}`);

          for (const [agentName] of controllers) {
            const inbox = await runtime.contextProvider.getInbox(agentName);
            if (inbox.length > 0) {
              const unseenCount = inbox.filter((m) => !m.seen).length;
              const seenCount = inbox.filter((m) => m.seen).length;
              const parts: string[] = [];
              if (seenCount > 0) parts.push(`${seenCount} processing`);
              if (unseenCount > 0) parts.push(`${unseenCount} unread`);
              logger.debug(
                `  ${agentName} inbox: ${parts.join(", ")} from [${inbox.map((m) => m.entry.from).join(", ")}]`,
              );
            }
          }
        }

        if (isIdle) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          logger.info(`Workflow complete (${elapsed}s)`);
          break;
        }
        await sleep(1000);
      }

      // Stop channel watcher and shutdown
      channelWatcher?.stop();
      await shutdownControllers(controllers, logger);
      await runtime.shutdown();

      logger.debug(`Workflow finished in ${Date.now() - startTime}ms`);

      return {
        success: true,
        setupResults: runtime.setupResults,
        duration: Date.now() - startTime,
        mcpUrl: runtime.mcpUrl,
        contextProvider: runtime.contextProvider,
        feedback: runtime.getFeedback?.(),
      };
    }

    // Start mode: return immediately, caller manages lifecycle
    logger.debug('Running in "start" mode, returning control to caller');

    return {
      success: true,
      setupResults: runtime.setupResults,
      duration: Date.now() - startTime,
      mcpUrl: runtime.mcpUrl,
      contextProvider: runtime.contextProvider,
      controllers,
      shutdown: async () => {
        channelWatcher?.stop();
        await shutdownControllers(controllers, logger);
        await runtime.shutdown();
      },
      getFeedback: runtime.getFeedback,
    };
  } catch (error) {
    // Error during init — no channel logger available, fall back to console
    const errorMsg = error instanceof Error ? error.message : String(error);
    log(`Error: ${errorMsg}`);
    return {
      success: false,
      error: errorMsg,
      setupResults: {},
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Gracefully shutdown all controllers
 */
export async function shutdownControllers(
  controllers: Map<string, AgentController>,
  logger: Logger,
): Promise<void> {
  logger.debug("Stopping controllers...");

  const stopPromises = [...controllers.values()].map(async (controller) => {
    await controller.stop();
    logger.debug(`Stopped controller: ${controller.name}`);
  });

  await Promise.all(stopPromises);
  logger.debug("All controllers stopped");
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
