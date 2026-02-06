import { Command, Option } from 'commander'
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { getDefaultModel } from '../../core/models.ts'
import type { BackendType } from '../../backends/types.ts'
import { sendRequest } from '../client.ts'
import {
  startDaemon,
  isSessionRunning,
  listSessions,
  setDefaultSession,
  waitForReady,
} from '../../daemon/index.ts'
import { buildAgentId, parseAgentId, isValidInstanceName, DEFAULT_INSTANCE } from '../instance.ts'

// Common action for creating new agent
async function createAgentAction(name: string | undefined, options: {
  model?: string
  backend?: string
  system?: string
  systemFile?: string
  idleTimeout?: string
  skill?: string[]
  skillDir?: string[]
  importSkill?: string[]
  foreground?: boolean
  instance?: string
}) {
  let system = options.system ?? 'You are a helpful assistant.'
  if (options.systemFile) {
    system = readFileSync(options.systemFile, 'utf-8')
  }

  const backend = (options.backend ?? 'sdk') as BackendType
  const model = options.model || getDefaultModel()
  const idleTimeout = parseInt(options.idleTimeout ?? '1800000', 10)

  // Build agent name with instance
  let agentName = name
  if (name && options.instance) {
    if (!isValidInstanceName(options.instance)) {
      console.error(`Invalid instance name: ${options.instance}`)
      console.error('Instance names must be alphanumeric, hyphen, or underscore')
      process.exit(1)
    }
    agentName = buildAgentId(name, options.instance)
  } else if (name && !name.includes('@')) {
    // Add default instance if not already specified
    agentName = buildAgentId(name, DEFAULT_INSTANCE)
  }

  if (options.foreground) {
    startDaemon({
      model,
      system,
      name: agentName,
      idleTimeout,
      backend,
      skills: options.skill,
      skillDirs: options.skillDir,
      importSkills: options.importSkill,
    })
  } else {
    const scriptPath = process.argv[1] ?? ''
    const args = [scriptPath, 'new', '-m', model, '-b', backend, '-s', system, '--foreground']
    if (agentName) {
      args.splice(2, 0, agentName)
    }
    args.push('--idle-timeout', String(idleTimeout))
    if (options.skill) {
      for (const skillPath of options.skill) {
        args.push('--skill', skillPath)
      }
    }
    if (options.skillDir) {
      for (const dir of options.skillDir) {
        args.push('--skill-dir', dir)
      }
    }
    if (options.importSkill) {
      for (const spec of options.importSkill) {
        args.push('--import-skill', spec)
      }
    }

    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: 'ignore',
    })
    child.unref()

    // Wait for ready signal instead of blind timeout
    const info = await waitForReady(agentName, 5000)
    if (info) {
      const displayName = name || info.id.slice(0, 8)
      const instanceStr = options.instance ? `@${options.instance}` : ''
      console.log(`Agent started: ${displayName}${instanceStr}`)
      console.log(`Model: ${info.model}`)
      console.log(`Backend: ${backend}`)
    } else {
      console.error('Failed to start agent')
      process.exit(1)
    }
  }
}

// Common action for listing agents
function listAgentsAction() {
  const sessions = listSessions()
  if (sessions.length === 0) {
    console.log('No active agents')
    return
  }

  for (const s of sessions) {
    const running = isSessionRunning(s.id)
    const status = running ? 'running' : 'stopped'
    const shortId = s.id.slice(0, 8)

    // Show: shortId (name) - model [status] or shortId - model [status]
    if (s.name) {
      const parsed = parseAgentId(s.name)
      const instanceStr = parsed.instance !== DEFAULT_INSTANCE ? `@${parsed.instance}` : ''
      console.log(`  ${shortId} (${parsed.agent}${instanceStr}) - ${s.model} [${status}]`)
    } else {
      console.log(`  ${shortId} - ${s.model} [${status}]`)
    }
  }
}

function addNewCommandOptions(cmd: Command): Command {
  return cmd
    .option('-m, --model <model>', `Model identifier (default: ${getDefaultModel()})`)
    .addOption(
      new Option('-b, --backend <type>', 'Backend type')
        .choices(['sdk', 'claude', 'codex', 'cursor'])
        .default('sdk')
    )
    .option('-s, --system <prompt>', 'System prompt', 'You are a helpful assistant.')
    .option('-f, --system-file <file>', 'Read system prompt from file')
    .option('--idle-timeout <ms>', 'Idle timeout in ms (0 = no timeout)', '1800000')
    .option('--skill <path...>', 'Add individual skill directories')
    .option('--skill-dir <path...>', 'Scan directories for skills')
    .option('--import-skill <spec...>', 'Import skills from Git (owner/repo:{skill1,skill2})')
    .option('--instance <name>', 'Instance name')
    .option('--foreground', 'Run in foreground')
}

export function registerAgentCommands(program: Command) {
  // ============================================================================
  // Agent commands
  // ============================================================================
  const agentCmd = program.command('agent').description('Manage agents')

  addNewCommandOptions(
    agentCmd
      .command('new [name]')
      .description('Create a new agent')
  ).action(createAgentAction)

  agentCmd
    .command('list')
    .description('List all agents')
    .action(listAgentsAction)

  agentCmd
    .command('status [target]')
    .description('Check agent status')
    .action(async (target) => {
      if (!isSessionRunning(target)) {
        console.log(target ? `Agent not found: ${target}` : 'No active agent')
        return
      }

      const res = await sendRequest({ action: 'ping' }, target)
      if (res.success && res.data) {
        const { id, model, name } = res.data as { id: string; model: string; name?: string }
        const nameStr = name ? ` (${name})` : ''
        console.log(`Agent: ${id}${nameStr}`)
        console.log(`Model: ${model}`)
      }
    })

  agentCmd
    .command('use <target>')
    .description('Set default agent')
    .action((target) => {
      if (setDefaultSession(target)) {
        console.log(`Default agent set to: ${target}`)
      } else {
        console.error(`Agent not found: ${target}`)
        process.exit(1)
      }
    })

  agentCmd
    .command('end [target]')
    .description('End an agent (or all with --all)')
    .option('--all', 'End all agents')
    .action(async (target, options) => {
      if (options.all) {
        const sessions = listSessions()
        for (const s of sessions) {
          if (isSessionRunning(s.id)) {
            await sendRequest({ action: 'shutdown' }, s.id)
            console.log(`Ended: ${s.name || s.id}`)
          }
        }
        return
      }

      if (!isSessionRunning(target)) {
        console.log(target ? `Agent not found: ${target}` : 'No active agent')
        return
      }

      const res = await sendRequest({ action: 'shutdown' }, target)
      if (res.success) {
        console.log('Agent ended')
      } else {
        console.error('Error:', res.error)
      }
    })

  // ============================================================================
  // Top-level shortcuts
  // ============================================================================

  // `new` as shorthand for `agent new`
  addNewCommandOptions(
    program
      .command('new [name]')
      .description('Create a new agent (shorthand for "agent new")')
  ).action(createAgentAction)

  // `ls` as alias for `agent list`
  program
    .command('ls')
    .description('List all agents (alias for "agent list")')
    .action(listAgentsAction)
}
