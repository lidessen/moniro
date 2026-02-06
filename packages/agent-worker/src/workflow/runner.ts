/**
 * Workflow Runner
 * Supports setup + kickoff model with shared context
 */

import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdirSync, existsSync } from 'node:fs'
import type { ParsedWorkflow, SetupTask, ResolvedAgent, ResolvedContext, ResolvedFileContext } from './types.ts'
import { interpolate, createContext, type VariableContext } from './interpolate.ts'
import { createFileContextProvider } from './context/file-provider.ts'
import { createMemoryContextProvider } from './context/memory-provider.ts'
import { createContextMCPServer } from './context/mcp-server.ts'
import { runWithUnixSocket, getSocketPath, type UnixSocketServer } from './context/transport.ts'
import type { ContextProvider } from './context/provider.ts'
import {
  createAgentController,
  checkWorkflowIdle,
  getBackendForModel,
  getBackendByType,
  type AgentController,
  type AgentBackend,
} from './controller/index.ts'
import type { ChannelEntry } from './context/types.ts'
import { createLogger, createSilentLogger, type Logger } from './logger.ts'

const execAsync = promisify(exec)

// ==================== Channel Output Formatting ====================

/** ANSI color codes for terminal output */
const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  // Agent colors (cycle through these)
  agents: [
    '\x1b[36m', // cyan
    '\x1b[33m', // yellow
    '\x1b[35m', // magenta
    '\x1b[32m', // green
    '\x1b[34m', // blue
    '\x1b[91m', // bright red
  ],
  system: '\x1b[90m', // gray for system messages
}

/** Get consistent color for an agent name */
function getAgentColor(agentName: string, agentNames: string[]): string {
  if (agentName === 'system' || agentName === 'user') {
    return colors.system
  }
  const index = agentNames.indexOf(agentName)
  return colors.agents[index % colors.agents.length] ?? colors.agents[0]!
}

/** Format timestamp as HH:MM:SS */
function formatTime(timestamp: string): string {
  const date = new Date(timestamp)
  return date.toTimeString().slice(0, 8)
}

/** Format a channel entry for display */
function formatChannelEntry(entry: ChannelEntry, agentNames: string[]): string {
  const time = formatTime(entry.timestamp)
  const color = getAgentColor(entry.from, agentNames)
  const name = entry.from.padEnd(12)

  // Truncate very long messages, show first part
  const maxLen = 500
  let message = entry.message
  if (message.length > maxLen) {
    message = message.slice(0, maxLen) + '...'
  }

  // Handle multi-line messages: indent continuation lines
  const lines = message.split('\n')
  if (lines.length === 1) {
    return `${colors.dim}${time}${colors.reset} ${color}${name}${colors.reset} │ ${message}`
  }

  const firstLine = `${colors.dim}${time}${colors.reset} ${color}${name}${colors.reset} │ ${lines[0]}`
  const indent = ' '.repeat(22) + '│ '
  const rest = lines.slice(1).map(l => indent + l).join('\n')
  return firstLine + '\n' + rest
}

/** Channel watcher state */
interface ChannelWatcher {
  stop: () => void
}

/** Start watching channel and logging new entries */
function startChannelWatcher(
  contextProvider: ContextProvider,
  agentNames: string[],
  log: (msg: string) => void,
  pollInterval = 500
): ChannelWatcher {
  let lastTimestamp: string | undefined
  let running = true

  const poll = async () => {
    while (running) {
      try {
        const entries = await contextProvider.readChannel(lastTimestamp)
        for (const entry of entries) {
          // Skip if we've already seen this (readChannel is "since", not "after")
          if (lastTimestamp && entry.timestamp <= lastTimestamp) continue

          log(formatChannelEntry(entry, agentNames))
          lastTimestamp = entry.timestamp
        }
      } catch {
        // Ignore errors during polling
      }
      await sleep(pollInterval)
    }
  }

  // Start polling
  poll()

  return {
    stop: () => { running = false }
  }
}

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
  startAgent: (agentName: string, config: ResolvedAgent, mcpSocketPath: string) => Promise<void>
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
  /** MCP socket path (for external agents) */
  mcpSocketPath?: string
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
  /** Context provider */
  contextProvider: ContextProvider
  /** MCP server (if running with Unix socket) */
  mcpServer?: UnixSocketServer
  /** MCP socket path */
  mcpSocketPath: string
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
 * 3. MCP server (Unix socket)
 * 4. Runs setup commands
 */
export async function initWorkflow(config: RunConfig): Promise<WorkflowRuntime> {
  const { workflow, instance = 'default', verbose = false, log = console.log } = config
  const startTime = Date.now()

  const agentNames = Object.keys(workflow.agents)

  // Ensure context is enabled (only false if explicitly disabled with `context: false`)
  if (!workflow.context) {
    throw new Error('Workflow context is disabled. Remove "context: false" to enable agent collaboration.')
  }

  const resolvedContext = workflow.context as ResolvedContext

  // Create context provider based on provider type
  let contextProvider: ContextProvider

  if (resolvedContext.provider === 'memory') {
    // Memory provider (for testing)
    if (verbose) log('Using memory context provider')
    contextProvider = createMemoryContextProvider(agentNames)
  } else {
    // File provider (default)
    const fileContext = resolvedContext as ResolvedFileContext

    // Create context directory
    if (!existsSync(fileContext.dir)) {
      mkdirSync(fileContext.dir, { recursive: true })
    }

    if (verbose) log(`Context directory: ${fileContext.dir}`)

    contextProvider = createFileContextProvider(fileContext.dir, agentNames, {
      channelFile: fileContext.channel,
      documentDir: fileContext.documentDir,
    })
  }

  // Create MCP server
  const mcpSocketPath = getSocketPath(workflow.name, instance)
  if (verbose) log(`MCP socket: ${mcpSocketPath}`)

  const mcpServer = await runWithUnixSocket(
    () =>
      createContextMCPServer({
        provider: contextProvider,
        validAgents: agentNames,
        name: `${workflow.name}-context`,
        version: '1.0.0',
      }).server,
    mcpSocketPath,
    {
      onConnect: (agentId, connId) => {
        if (verbose) log(`Agent connected: ${agentId} (${connId.slice(0, 8)})`)
      },
      onDisconnect: (agentId, connId) => {
        if (verbose) log(`Agent disconnected: ${agentId} (${connId.slice(0, 8)})`)
      },
    }
  )

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
        await mcpServer.close()
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
    contextProvider,
    mcpServer,
    mcpSocketPath,
    agentNames,
    setupResults,

    async sendKickoff() {
      if (!interpolatedKickoff) {
        if (verbose) log('No kickoff message configured')
        return
      }

      if (verbose) log(`\nKickoff: ${interpolatedKickoff.slice(0, 100)}...`)

      // Send kickoff as 'orchestrator' to the channel
      await contextProvider.appendChannel('orchestrator', interpolatedKickoff)
    },

    async shutdown() {
      if (verbose) log('\nShutting down workflow...')
      await mcpServer.close()
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
        await config.startAgent(agentName, agentDef, runtime.mcpSocketPath)
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
      mcpSocketPath: runtime.mcpSocketPath,
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
  createBackend?: (agentName: string, agent: ResolvedAgent) => AgentBackend
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
  /** MCP socket path */
  mcpSocketPath?: string
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
    const runtime = await initWorkflowWithMentions({
      workflow,
      instance,
      verbose: debug, // Use debug for internal verbose logging
      log,
      onMention: (from, target, _entry) => {
        const controller = controllers.get(target)
        if (controller) {
          logger.debug(`Mention detected: ${from} → @${target}, waking controller`)
          controller.wake()
        }
      },
      debugLog: debug ? (msg) => logger.debug(msg) : undefined,
    })

    logger.debug('Runtime initialized', {
      agentNames: runtime.agentNames,
      mcpSocketPath: runtime.mcpSocketPath,
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
      let backend: AgentBackend
      if (createBackend) {
        backend = createBackend(agentName, agentDef)
      } else if (agentDef.backend) {
        backend = getBackendByType(agentDef.backend, { model: agentDef.model })
      } else if (agentDef.model) {
        backend = getBackendForModel(agentDef.model)
      } else {
        throw new Error(`Agent "${agentName}" requires either a backend or model field`)
      }

      logger.debug(`Using backend: ${backend.name} for ${agentName}`)

      const controllerLogger = logger.child(agentName)
      const controller = createAgentController({
        name: agentName,
        agent: agentDef,
        contextProvider: runtime.contextProvider,
        mcpSocketPath: runtime.mcpSocketPath,
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

    // Start channel watcher for real-time output (only if not debug mode)
    let channelWatcher: ChannelWatcher | null = null
    if (!debug) {
      channelWatcher = startChannelWatcher(
        runtime.contextProvider,
        runtime.agentNames,
        log,
        250 // Fast polling for responsive output
      )
    }

    // Handle run mode vs start mode
    if (mode === 'run') {
      logger.debug('Running in "run" mode, waiting for completion...')

      let idleCheckCount = 0
      while (true) {
        const isIdle = await checkWorkflowIdle(controllers, runtime.contextProvider)
        idleCheckCount++

        if (idleCheckCount % 10 === 0) {
          // Log every 10 seconds
          const states = [...controllers.entries()].map(([n, c]) => `${n}=${c.state}`).join(', ')
          logger.debug(`Idle check #${idleCheckCount}: ${states}`)
        }

        if (isIdle) {
          logger.debug('Workflow complete - all agents idle')
          if (!debug && verbose) log('\nWorkflow complete')
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
        mcpSocketPath: runtime.mcpSocketPath,
        contextProvider: runtime.contextProvider,
      }
    }

    // Start mode: return immediately, caller manages lifecycle
    logger.debug('Running in "start" mode, returning control to caller')

    return {
      success: true,
      setupResults: runtime.setupResults,
      duration: Date.now() - startTime,
      mcpSocketPath: runtime.mcpSocketPath,
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
 * Initialize workflow with onMention callback
 */
interface InitWithMentionsConfig {
  workflow: ParsedWorkflow
  instance: string
  verbose: boolean
  log: (message: string) => void
  onMention: (from: string, target: string, entry: import('./context/types.ts').ChannelEntry) => void
  /** Debug log function for MCP tool calls */
  debugLog?: (message: string) => void
}

async function initWorkflowWithMentions(config: InitWithMentionsConfig): Promise<WorkflowRuntime> {
  const { workflow, instance, verbose, log, onMention, debugLog } = config
  const startTime = Date.now()

  const agentNames = Object.keys(workflow.agents)

  if (!workflow.context) {
    throw new Error('Workflow context is disabled. Remove "context: false" to enable agent collaboration.')
  }

  const resolvedContext = workflow.context as ResolvedContext

  // Create context provider
  let contextProvider: ContextProvider

  if (resolvedContext.provider === 'memory') {
    if (verbose) log('Using memory context provider')
    contextProvider = createMemoryContextProvider(agentNames)
  } else {
    const fileContext = resolvedContext as ResolvedFileContext

    if (!existsSync(fileContext.dir)) {
      mkdirSync(fileContext.dir, { recursive: true })
    }

    if (verbose) log(`Context directory: ${fileContext.dir}`)

    contextProvider = createFileContextProvider(fileContext.dir, agentNames, {
      channelFile: fileContext.channel,
      documentDir: fileContext.documentDir,
    })
  }

  // Create MCP server with onMention callback
  const mcpSocketPath = getSocketPath(workflow.name, instance)
  if (verbose) log(`MCP socket: ${mcpSocketPath}`)

  const mcpServer = await runWithUnixSocket(
    () =>
      createContextMCPServer({
        provider: contextProvider,
        validAgents: agentNames,
        name: `${workflow.name}-context`,
        version: '1.0.0',
        onMention, // Wire up the callback
        debugLog, // Pass debug log function for tool call logging
      }).server,
    mcpSocketPath,
    {
      onConnect: (agentId, connId) => {
        if (verbose) log(`Agent connected: ${agentId} (${connId.slice(0, 8)})`)
      },
      onDisconnect: (agentId, connId) => {
        if (verbose) log(`Agent disconnected: ${agentId} (${connId.slice(0, 8)})`)
      },
    }
  )

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
        await mcpServer.close()
        throw new Error(
          `Setup failed: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
  }

  // Interpolate kickoff
  const interpolatedKickoff = workflow.kickoff
    ? interpolate(workflow.kickoff, context)
    : undefined

  const runtime: WorkflowRuntime = {
    name: workflow.name,
    instance,
    contextProvider,
    mcpServer,
    mcpSocketPath,
    agentNames,
    setupResults,

    async sendKickoff() {
      if (!interpolatedKickoff) {
        if (verbose) log('No kickoff message configured')
        return
      }

      if (verbose) log(`\nKickoff: ${interpolatedKickoff.slice(0, 100)}...`)
      await contextProvider.appendChannel('orchestrator', interpolatedKickoff)
    },

    async shutdown() {
      if (verbose) log('\nShutting down workflow...')
      await mcpServer.close()
    },
  }

  if (verbose) {
    log(`\nWorkflow initialized in ${Date.now() - startTime}ms`)
    log(`Agents: ${agentNames.join(', ')}`)
  }

  return runtime
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
