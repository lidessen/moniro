/**
 * Workflow Runner
 * Supports setup + kickoff model with shared context
 */

import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ParsedWorkflow, SetupTask, ResolvedAgent, ResolvedContext, ResolvedFileContext } from './types.ts'
import { interpolate, createContext, type VariableContext } from './interpolate.ts'
import { createFileContextProvider } from '../context/file-provider.ts'
import { createMemoryContextProvider } from '../context/memory-provider.ts'
import { createContextMCPServer } from '../context/mcp-server.ts'
import { runWithHttp, type HttpMCPServer } from '../context/http-transport.ts'
import type { ContextProvider } from '../context/provider.ts'
import {
  createAgentController,
  checkWorkflowIdle,
  getBackendForModel,
  getBackendByType,
  type AgentController,
} from './controller/index.ts'
import type { Backend } from '../backends/types.ts'
import type { Message } from '../context/types.ts'
import { startChannelWatcher, type ChannelWatcher } from './display.ts'
import { createLogger, createSilentLogger, type Logger } from './logger.ts'

const execAsync = promisify(exec)


/**
 * Workflow run configuration
 */
export interface RunConfig {
  /** Workflow to run */
  workflow: ParsedWorkflow
  /** Instance name */
  instance?: string
  /** Verbose output */
  verbose?: boolean
  /** Log function */
  log?: (message: string) => void
  /** Agent startup function */
  startAgent: (agentName: string, config: ResolvedAgent, mcpUrl: string) => Promise<void>
  /** Callback when an agent @mentions another agent */
  onMention?: (from: string, target: string, msg: import('../context/types.ts').Message) => void
  /** Debug log function for MCP tool calls */
  debugLog?: (message: string) => void
}

/**
 * Workflow run result
 */
export interface RunResult {
  /** Success flag */
  success: boolean
  /** Error if failed */
  error?: string
  /** Setup variable results */
  setupResults: Record<string, string>
  /** Execution time in ms */
  duration: number
  /** MCP HTTP URL (for external agents) */
  mcpUrl?: string
  /** Context provider for polling/reading state */
  contextProvider?: ContextProvider
  /** Agent names in the workflow */
  agentNames?: string[]
  /** Shutdown function */
  shutdown?: () => Promise<void>
}

/**
 * Workflow runtime instance
 */
export interface WorkflowRuntime {
  /** Workflow name */
  name: string
  /** Instance name */
  instance: string
  /** Context directory (for shared channel, documents, workspaces) */
  contextDir: string
  /** Project directory (the codebase agents work on) */
  projectDir: string
  /** Context provider */
  contextProvider: ContextProvider
  /** HTTP MCP server */
  httpMcpServer: HttpMCPServer
  /** MCP HTTP URL (http://127.0.0.1:<port>/mcp) */
  mcpUrl: string
  /** Agent names */
  agentNames: string[]
  /** Setup results */
  setupResults: Record<string, string>
  /** Send kickoff message */
  sendKickoff: () => Promise<void>
  /** Shutdown all resources */
  shutdown: () => Promise<void>
}

/**
 * Initialize workflow runtime
 *
 * This sets up:
 * 1. Context provider (file or memory)
 * 2. Context directory (for file provider)
 * 3. MCP server (HTTP)
 * 4. Runs setup commands
 */
export async function initWorkflow(config: RunConfig): Promise<WorkflowRuntime> {
  const { workflow, instance = 'default', verbose = false, log = console.log, onMention, debugLog } = config
  const startTime = Date.now()

  const agentNames = Object.keys(workflow.agents)

  // Ensure context is enabled (only false if explicitly disabled with `context: false`)
  if (!workflow.context) {
    throw new Error('Workflow context is disabled. Remove "context: false" to enable agent collaboration.')
  }

  const resolvedContext = workflow.context as ResolvedContext

  // Create context provider based on provider type
  let contextProvider: ContextProvider
  let contextDir: string

  // Project directory is where the workflow was invoked from
  const projectDir = process.cwd()

  if (resolvedContext.provider === 'memory') {
    // Memory provider (for testing) - use temp directory for workspaces
    if (verbose) log('Using memory context provider')
    contextProvider = createMemoryContextProvider(agentNames)
    contextDir = join(tmpdir(), `agent-worker-${workflow.name}-${instance}`)
  } else {
    // File provider (default)
    const fileContext = resolvedContext as ResolvedFileContext
    contextDir = fileContext.dir

    // Create context directory
    if (!existsSync(contextDir)) {
      mkdirSync(contextDir, { recursive: true })
    }

    if (verbose) log(`Context directory: ${contextDir}`)

    contextProvider = createFileContextProvider(contextDir, agentNames)
  }

  // Create MCP server (HTTP)
  const createMCPServerInstance = () =>
    createContextMCPServer({
      provider: contextProvider,
      validAgents: agentNames,
      name: `${workflow.name}-context`,
      version: '1.0.0',
      onMention,
      debugLog,
    }).server

  const httpMcpServer = await runWithHttp({
    createServerInstance: createMCPServerInstance,
    port: 0,
    onConnect: (agentId, sessionId) => {
      if (verbose) log(`Agent connected: ${agentId} (${sessionId.slice(0, 8)})`)
    },
    onDisconnect: (agentId, sessionId) => {
      if (verbose) log(`Agent disconnected: ${agentId} (${sessionId.slice(0, 8)})`)
    },
  })

  if (verbose) log(`MCP server: ${httpMcpServer.url}`)

  // Run setup commands
  const setupResults: Record<string, string> = {}
  const context = createContext(workflow.name, instance, setupResults)

  if (workflow.setup && workflow.setup.length > 0) {
    if (verbose) log('\nRunning setup...')
    for (const task of workflow.setup) {
      try {
        const result = await runSetupTask(task, context, verbose, log)
        if (task.as) {
          setupResults[task.as] = result
          context[task.as] = result
        }
      } catch (error) {
        await httpMcpServer.close()
        throw new Error(
          `Setup failed: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
  }

  // Interpolate kickoff with setup results
  const interpolatedKickoff = workflow.kickoff
    ? interpolate(workflow.kickoff, context)
    : undefined

  // Build runtime
  const runtime: WorkflowRuntime = {
    name: workflow.name,
    instance,
    contextDir,
    projectDir,
    contextProvider,
    httpMcpServer,
    mcpUrl: httpMcpServer.url,
    agentNames,
    setupResults,

    async sendKickoff() {
      if (!interpolatedKickoff) {
        if (verbose) log('No kickoff message configured')
        return
      }

      if (verbose) log(`\nKickoff: ${interpolatedKickoff.slice(0, 100)}...`)

      // Send kickoff as 'system' to the channel
      await contextProvider.appendChannel('system', interpolatedKickoff)
    },

    async shutdown() {
      if (verbose) log('\nShutting down workflow...')
      await httpMcpServer.close()
    },
  }

  if (verbose) {
    log(`\nWorkflow initialized in ${Date.now() - startTime}ms`)
    log(`Agents: ${agentNames.join(', ')}`)
  }

  return runtime
}

/**
 * Run a setup task
 */
async function runSetupTask(
  task: SetupTask,
  context: VariableContext,
  verbose: boolean,
  log: (message: string) => void
): Promise<string> {
  const command = interpolate(task.shell, context)

  if (verbose) {
    const displayCmd = command.length > 60 ? command.slice(0, 60) + '...' : command
    log(`  $ ${displayCmd}`)
  }

  try {
    const { stdout } = await execAsync(command)
    const result = stdout.trim()

    if (verbose && task.as) {
      const displayResult = result.length > 60 ? result.slice(0, 60) + '...' : result
      log(`  ${task.as} = ${displayResult}`)
    }

    return result
  } catch (error) {
    throw new Error(`Command failed: ${command}\n${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Run a workflow (start mode)
 *
 * This initializes the runtime, starts agents, and sends kickoff.
 * Agents remain running until explicitly stopped.
 */
export async function runWorkflow(config: RunConfig): Promise<RunResult> {
  const { workflow, instance = 'default', verbose = false, log = console.log } = config
  const startTime = Date.now()

  try {
    // Initialize runtime
    const runtime = await initWorkflow(config)

    // Start all agents with MCP config
    if (verbose) log('\nStarting agents...')

    for (const agentName of runtime.agentNames) {
      const agentDef = workflow.agents[agentName]!
      try {
        await config.startAgent(agentName, agentDef, runtime.mcpUrl)
        if (verbose) log(`  Started: ${agentName}`)
      } catch (error) {
        await runtime.shutdown()
        return {
          success: false,
          error: `Failed to start agent ${agentName}: ${error instanceof Error ? error.message : String(error)}`,
          setupResults: runtime.setupResults,
          duration: Date.now() - startTime,
        }
      }
    }

    // Send kickoff
    await runtime.sendKickoff()

    return {
      success: true,
      setupResults: runtime.setupResults,
      duration: Date.now() - startTime,
      mcpUrl: runtime.mcpUrl,
      contextProvider: runtime.contextProvider,
      agentNames: runtime.agentNames,
      shutdown: () => runtime.shutdown(),
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      setupResults: {},
      duration: Date.now() - startTime,
    }
  }
}

// ==================== Controller-based Runner ====================

/**
 * Controller-based run configuration
 */
export interface ControllerRunConfig {
  /** Workflow to run */
  workflow: ParsedWorkflow
  /** Instance name */
  instance?: string
  /** Verbose output (show channel in real-time) */
  verbose?: boolean
  /** Debug mode (show detailed internal logs, no channel output) */
  debug?: boolean
  /** Log function */
  log?: (message: string) => void
  /** Run mode: 'run' exits when idle, 'start' runs until stopped */
  mode?: 'run' | 'start'
  /** Poll interval for controllers (ms) */
  pollInterval?: number
  /** Custom backend factory (optional, defaults to getBackendForModel) */
  createBackend?: (agentName: string, agent: ResolvedAgent) => Backend
}

/**
 * Controller-based run result
 */
export interface ControllerRunResult {
  /** Success flag */
  success: boolean
  /** Error if failed */
  error?: string
  /** Setup variable results */
  setupResults: Record<string, string>
  /** Execution time in ms */
  duration: number
  /** MCP HTTP URL */
  mcpUrl?: string
  /** Context provider */
  contextProvider?: ContextProvider
  /** Agent controllers */
  controllers?: Map<string, AgentController>
  /** Shutdown function */
  shutdown?: () => Promise<void>
}

/**
 * Run a workflow with agent controllers
 *
 * This is the controller-based alternative to runWorkflow().
 * Uses AgentController for lifecycle management and automatic retry.
 *
 * @param config Controller run configuration
 */
export async function runWorkflowWithControllers(config: ControllerRunConfig): Promise<ControllerRunResult> {
  const {
    workflow,
    instance = 'default',
    verbose = false,
    debug = false,
    log = console.log,
    mode = 'run',
    pollInterval = 5000,
    createBackend,
  } = config
  const startTime = Date.now()

  // Create logger
  const logger = createLogger({ debug, log, prefix: 'workflow' })

  logger.debug('Starting workflow with controllers', { mode, instance, pollInterval })

  try {
    // Create controllers map for wake() on mention
    const controllers = new Map<string, AgentController>()

    logger.debug('Initializing workflow runtime...')

    // Initialize runtime with onMention callback
    const runtime = await initWorkflow({
      workflow,
      instance,
      verbose: debug, // Use debug for internal verbose logging
      log,
      startAgent: async () => {}, // Not used; controllers start agents below
      onMention: (from, target, entry) => {
        const controller = controllers.get(target)
        if (controller) {
          const preview = entry.content.length > 80 ? entry.content.slice(0, 80) + '...' : entry.content
          logger.debug(`@mention: ${from} → @${target} (state=${controller.state}): ${preview}`)
          controller.wake()
        } else {
          logger.debug(`@mention: ${from} → @${target} (no controller found!)`)
        }
      },
      debugLog: debug ? (msg) => logger.debug(msg) : undefined,
    })

    logger.debug('Runtime initialized', {
      agentNames: runtime.agentNames,
      mcpUrl: runtime.mcpUrl,
    })

    // Create and start controllers for each agent
    logger.debug('Starting agent controllers...')
    if (!debug && verbose) log('Starting agents...')

    for (const agentName of runtime.agentNames) {
      const agentDef = workflow.agents[agentName]!

      logger.debug(`Creating controller for ${agentName}`, {
        backend: agentDef.backend,
        model: agentDef.model,
      })

      // Get backend for this agent
      // Priority: 1. Custom createBackend, 2. Explicit backend field, 3. Infer from model
      const backendDebugLog = debug ? (msg: string) => logger.debug(msg) : undefined
      let backend: Backend
      if (createBackend) {
        backend = createBackend(agentName, agentDef)
      } else if (agentDef.backend) {
        backend = getBackendByType(agentDef.backend, { model: agentDef.model, debugLog: backendDebugLog })
      } else if (agentDef.model) {
        backend = getBackendForModel(agentDef.model, { debugLog: backendDebugLog })
      } else {
        throw new Error(`Agent "${agentName}" requires either a backend or model field`)
      }

      logger.debug(`Using backend: ${backend.type} for ${agentName}`)

      // Each agent gets an isolated workspace directory
      const workspaceDir = join(runtime.contextDir, 'workspaces', agentName)
      if (!existsSync(workspaceDir)) {
        mkdirSync(workspaceDir, { recursive: true })
      }

      const controllerLogger = logger.child(agentName)
      const controller = createAgentController({
        name: agentName,
        agent: agentDef,
        contextProvider: runtime.contextProvider,
        mcpUrl: runtime.mcpUrl,
        workspaceDir,
        projectDir: runtime.projectDir,
        backend,
        pollInterval,
        log: debug ? (msg) => controllerLogger.debug(msg) : undefined,
      })

      controllers.set(agentName, controller)
      await controller.start()

      logger.debug(`Controller started: ${agentName}`)
    }

    // Send kickoff
    logger.debug('Sending kickoff message...')
    await runtime.sendKickoff()
    logger.debug('Kickoff sent')

    // Start channel watcher for real-time output
    // Always enabled - this is the primary way to see agent communication
    const channelWatcher = startChannelWatcher(
      runtime.contextProvider,
      runtime.agentNames,
      log,
      250 // Fast polling for responsive output
    )

    // Handle run mode vs start mode
    if (mode === 'run') {
      logger.debug('Running in "run" mode, waiting for completion...')

      let idleCheckCount = 0
      while (true) {
        const isIdle = await checkWorkflowIdle(controllers, runtime.contextProvider)
        idleCheckCount++

        if (idleCheckCount % 10 === 0) {
          // Log every 10 seconds with detailed state
          const states = [...controllers.entries()].map(([n, c]) => `${n}=${c.state}`).join(', ')
          logger.debug(`Idle check #${idleCheckCount}: ${states}`)

          // Also check inbox state for each agent
          for (const [agentName] of controllers) {
            const inbox = await runtime.contextProvider.getInbox(agentName)
            if (inbox.length > 0) {
              logger.debug(`  ${agentName} inbox: ${inbox.length} unread from [${inbox.map(m => m.entry.from).join(', ')}]`)
            }
          }
        }

        if (isIdle) {
          logger.debug('Workflow complete - all agents idle')
          if (verbose) log('\nWorkflow complete')
          break
        }
        // Check every second
        await sleep(1000)
      }

      // Stop channel watcher and shutdown
      channelWatcher?.stop()
      await shutdownControllers(controllers, debug, logger)
      await runtime.shutdown()

      logger.debug(`Workflow finished in ${Date.now() - startTime}ms`)

      return {
        success: true,
        setupResults: runtime.setupResults,
        duration: Date.now() - startTime,
        mcpUrl: runtime.mcpUrl,
        contextProvider: runtime.contextProvider,
      }
    }

    // Start mode: return immediately, caller manages lifecycle
    logger.debug('Running in "start" mode, returning control to caller')

    return {
      success: true,
      setupResults: runtime.setupResults,
      duration: Date.now() - startTime,
      mcpUrl: runtime.mcpUrl,
      contextProvider: runtime.contextProvider,
      controllers,
      shutdown: async () => {
        channelWatcher?.stop()
        await shutdownControllers(controllers, debug, logger)
        await runtime.shutdown()
      },
    }
  } catch (error) {
    logger.error('Workflow failed', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      setupResults: {},
      duration: Date.now() - startTime,
    }
  }
}

/**
 * Gracefully shutdown all controllers
 */
async function shutdownControllers(
  controllers: Map<string, AgentController>,
  debug: boolean,
  logger: Logger
): Promise<void> {
  logger.debug('Stopping controllers...')

  const stopPromises = [...controllers.values()].map(async (controller) => {
    await controller.stop()
    logger.debug(`Stopped controller: ${controller.name}`)
  })

  await Promise.all(stopPromises)
  logger.debug('All controllers stopped')
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
