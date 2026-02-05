#!/usr/bin/env node
import { Command, Option } from 'commander'
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import type { ToolDefinition } from '../types.ts'
import { FRONTIER_MODELS, getDefaultModel } from '../models.ts'
import type { BackendType } from '../backends/types.ts'
import { sendRequest, isSessionActive } from './client.ts'
import {
  startServer,
  isSessionRunning,
  listSessions,
  setDefaultSession,
  waitForReady,
} from './server.ts'
import { buildAgentId, parseAgentId, isValidInstanceName, DEFAULT_INSTANCE } from './instance.ts'

const program = new Command()

program
  .name('agent-worker')
  .description('CLI for creating and managing AI agents')
  .version('0.0.1')

// Helper to show deprecation warning
function deprecationWarning(oldCmd: string, newCmd: string) {
  console.error(`\x1b[33mWarning: '${oldCmd}' is deprecated. Use '${newCmd}' instead.\x1b[0m\n`)
}

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
    startServer({
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
    const args = [process.argv[1], 'new', '-m', model, '-b', backend, '-s', system, '--foreground']
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
    // Parse name to show agent@instance format
    if (s.name) {
      const parsed = parseAgentId(s.name)
      const instanceStr = parsed.instance !== DEFAULT_INSTANCE ? `@${parsed.instance}` : ''
      console.log(`  ${parsed.agent}${instanceStr} - ${s.model} [${status}]`)
    } else {
      console.log(`  ${s.id.slice(0, 8)} - ${s.model} [${status}]`)
    }
  }
}

// ============================================================================
// Agent commands (new)
// ============================================================================
const agentCmd = program.command('agent').description('Manage agents')

agentCmd
  .command('new [name]')
  .description('Create a new agent')
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
  .action(createAgentAction)

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
program
  .command('new [name]')
  .description('Create a new agent (shorthand for "agent new")')
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
  .action(createAgentAction)

// `ls` as alias for `agent list`
program
  .command('ls')
  .description('List all agents (alias for "agent list")')
  .action(listAgentsAction)

// `down` as alias for `agent end`
program
  .command('down [target]')
  .description('Stop an agent (alias for "agent end")')
  .option('--all', 'Stop all agents')
  .action(async (target, options) => {
    if (options.all) {
      const sessions = listSessions()
      for (const s of sessions) {
        if (isSessionRunning(s.id)) {
          await sendRequest({ action: 'shutdown' }, s.id)
          console.log(`Stopped: ${s.name || s.id}`)
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
      console.log('Agent stopped')
    } else {
      console.error('Error:', res.error)
    }
  })

// ============================================================================
// Deprecated session commands (aliases with warnings)
// ============================================================================
const sessionCmd = program.command('session').description('Manage sessions (deprecated, use "agent")')

sessionCmd
  .command('new')
  .description('Create a new session (deprecated)')
  .option('-m, --model <model>', `Model identifier`)
  .addOption(
    new Option('-b, --backend <type>', 'Backend type')
      .choices(['sdk', 'claude', 'codex', 'cursor'])
      .default('sdk')
  )
  .option('-s, --system <prompt>', 'System prompt', 'You are a helpful assistant.')
  .option('-f, --system-file <file>', 'Read system prompt from file')
  .option('-n, --name <name>', 'Session name for easy reference')
  .option('--idle-timeout <ms>', 'Idle timeout in ms (0 = no timeout)', '1800000')
  .option('--skill <path...>', 'Add individual skill directories')
  .option('--skill-dir <path...>', 'Scan directories for skills')
  .option('--import-skill <spec...>', 'Import skills from Git (owner/repo:{skill1,skill2})')
  .option('--foreground', 'Run in foreground')
  .action(async (options) => {
    deprecationWarning('session new', 'new <name> or agent new')
    await createAgentAction(options.name, options)
  })

sessionCmd
  .command('list')
  .description('List all sessions (deprecated)')
  .action(() => {
    deprecationWarning('session list', 'ls or agent list')
    listAgentsAction()
  })

sessionCmd
  .command('status [target]')
  .description('Check session status (deprecated)')
  .action(async (target) => {
    deprecationWarning('session status', 'agent status')
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

sessionCmd
  .command('use <target>')
  .description('Set default session (deprecated)')
  .action((target) => {
    deprecationWarning('session use', 'agent use')
    if (setDefaultSession(target)) {
      console.log(`Default agent set to: ${target}`)
    } else {
      console.error(`Agent not found: ${target}`)
      process.exit(1)
    }
  })

sessionCmd
  .command('end [target]')
  .description('End a session (deprecated)')
  .option('--all', 'End all sessions')
  .action(async (target, options) => {
    deprecationWarning('session end', 'down or agent end')
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

// Send command
program
  .command('send <message>')
  .description('Send a message (async by default, use --wait to wait for response)')
  .option('--to <target>', 'Target agent (name or name@instance)')
  .option('--json', 'Output full JSON response')
  .option('--auto-approve', 'Auto-approve all tool calls (default)')
  .option('--no-auto-approve', 'Require manual approval')
  .option('--wait', 'Wait for response before returning (synchronous mode)')
  .option('--debug', 'Show debug information')
  .action(async (message, options) => {
    const target = options.to

    if (!isSessionActive(target)) {
      if (target) {
        console.error(`Agent not found: ${target}`)
      } else {
        console.error('No active agent. Create one with: agent-worker new <name> -m <model>')
      }
      process.exit(1)
    }

    const autoApprove = options.autoApprove !== false
    // Default is async (wait=false means async=true)
    const async = !options.wait

    const res = await sendRequest({
      action: 'send',
      payload: { message, options: { autoApprove }, async },
    }, target, { debug: options.debug })

    if (!res.success) {
      console.error('Error:', res.error)
      process.exit(1)
    }

    // Handle async response
    if (async) {
      const asyncData = res.data as { async: boolean; message: string }
      console.log(asyncData.message)
      return
    }

    const response = res.data as {
      content: string
      toolCalls: Array<{ name: string; arguments: unknown; result: unknown }>
      pendingApprovals: Array<{ id: string; toolName: string; arguments: unknown }>
    }

    if (options.json) {
      console.log(JSON.stringify(response, null, 2))
    } else {
      console.log(response.content)
      if (response.toolCalls?.length > 0) {
        console.log('\n--- Tool Calls ---')
        for (const tc of response.toolCalls) {
          console.log(`${tc.name}(${JSON.stringify(tc.arguments)}) => ${JSON.stringify(tc.result)}`)
        }
      }
      if (response.pendingApprovals?.length > 0) {
        console.log('\n--- Pending Approvals ---')
        for (const p of response.pendingApprovals) {
          console.log(`[${p.id.slice(0, 8)}] ${p.toolName}(${JSON.stringify(p.arguments)})`)
        }
      }
    }
  })

// Tool commands
const toolCmd = program.command('tool').description('Manage tools')

toolCmd
  .command('add <name>')
  .description('Add a tool')
  .option('--to <target>', 'Target agent')
  .requiredOption('-d, --desc <description>', 'Tool description')
  .option('-p, --param <params...>', 'Parameters (name:type:description)')
  .option('--needs-approval', 'Require approval')
  .action(async (name, options) => {
    const target = options.to

    if (!isSessionActive(target)) {
      console.error(target ? `Agent not found: ${target}` : 'No active agent')
      process.exit(1)
    }

    const properties: Record<string, unknown> = {}
    const required: string[] = []

    for (const param of options.param ?? []) {
      const [paramName, type, ...descParts] = param.split(':')
      properties[paramName] = {
        type: type ?? 'string',
        description: descParts.join(':') ?? '',
      }
      required.push(paramName)
    }

    const tool: ToolDefinition = {
      name,
      description: options.desc,
      parameters: { type: 'object', properties, required },
      needsApproval: options.needsApproval ?? false,
    }

    const res = await sendRequest({ action: 'tool_add', payload: tool }, target)
    if (res.success) {
      const approvalNote = options.needsApproval ? ' (needs approval)' : ''
      console.log(`Tool added: ${name}${approvalNote}`)
    } else {
      console.error('Error:', res.error)
      process.exit(1)
    }
  })

toolCmd
  .command('import <file>')
  .description('Import tools from JS/TS file')
  .option('--to <target>', 'Target agent')
  .action(async (file, options) => {
    const target = options.to

    if (!isSessionActive(target)) {
      console.error(target ? `Agent not found: ${target}` : 'No active agent')
      process.exit(1)
    }

    // Resolve to absolute path
    const filePath = file.startsWith('/') ? file : join(process.cwd(), file)

    const res = await sendRequest({
      action: 'tool_import',
      payload: { filePath },
    }, target)

    if (res.success) {
      const data = res.data as { imported: string[]; skipped?: string[] }
      console.log(`Imported ${data.imported.length} tool(s):`)
      for (const name of data.imported) {
        console.log(`  ${name}`)
      }
      if (data.skipped && data.skipped.length > 0) {
        console.log(`Skipped ${data.skipped.length} invalid tool(s):`)
        for (const name of data.skipped) {
          console.log(`  ${name}`)
        }
      }
    } else {
      console.error('Error:', res.error)
      process.exit(1)
    }
  })

toolCmd
  .command('mock <name> <response>')
  .description('Set mock response')
  .option('--to <target>', 'Target agent')
  .action(async (name, response, options) => {
    const target = options.to

    if (!isSessionActive(target)) {
      console.error(target ? `Agent not found: ${target}` : 'No active agent')
      process.exit(1)
    }

    try {
      const parsed = JSON.parse(response)
      const res = await sendRequest({
        action: 'tool_mock',
        payload: { name, response: parsed },
      }, target)

      if (res.success) {
        console.log(`Mock set for: ${name}`)
      } else {
        console.error('Error:', res.error)
        process.exit(1)
      }
    } catch {
      console.error('Invalid JSON response')
      process.exit(1)
    }
  })

toolCmd
  .command('list')
  .description('List tools')
  .option('--to <target>', 'Target agent')
  .action(async (options) => {
    const target = options.to

    if (!isSessionActive(target)) {
      console.error(target ? `Agent not found: ${target}` : 'No active agent')
      process.exit(1)
    }

    const res = await sendRequest({ action: 'tool_list' }, target)
    if (!res.success) {
      console.error('Error:', res.error)
      process.exit(1)
    }

    const tools = res.data as ToolDefinition[]
    if (tools.length === 0) {
      console.log('No tools')
    } else {
      for (const t of tools) {
        const approval = t.needsApproval ? ' [needs approval]' : ''
        const mock = t.mockResponse !== undefined ? ' [mocked]' : ''
        console.log(`  ${t.name}${approval}${mock} - ${t.description}`)
      }
    }
  })

// Peek command - view recent messages
program
  .command('peek')
  .description('View conversation messages (default: last 10)')
  .option('--to <target>', 'Target agent')
  .option('--json', 'Output as JSON')
  .option('--all', 'Show all messages')
  .option('-n, --last <count>', 'Show last N messages', parseInt)
  .option('--find <text>', 'Filter messages containing text (case-insensitive)')
  .action(async (options) => {
    const target = options.to

    if (!isSessionActive(target)) {
      console.error(target ? `Agent not found: ${target}` : 'No active agent')
      process.exit(1)
    }

    const res = await sendRequest({ action: 'history' }, target)
    if (!res.success) {
      console.error('Error:', res.error)
      process.exit(1)
    }

    let messages = res.data as Array<{ role: string; content: string; status?: string }>

    // Apply filter if --find is specified
    if (options.find) {
      const searchText = options.find.toLowerCase()
      messages = messages.filter((msg) => msg.content.toLowerCase().includes(searchText))
    }

    // Default to last 10 messages unless --all or --last is specified
    if (!options.all) {
      const count = options.last ?? 10
      messages = messages.slice(-count)
    }

    if (options.json) {
      console.log(JSON.stringify(messages, null, 2))
    } else {
      if (messages.length === 0) {
        console.log(options.find ? 'No messages found matching your search' : 'No messages')
        return
      }
      for (const msg of messages) {
        const role = msg.role === 'user' ? 'YOU' : msg.role.toUpperCase()
        const status = msg.status === 'responding' ? ' (responding...)' : ''
        console.log(`[${role}${status}] ${msg.content}`)
      }
    }
  })

// Stats command
program
  .command('stats')
  .description('Show agent statistics')
  .option('--to <target>', 'Target agent')
  .action(async (options) => {
    const target = options.to

    if (!isSessionActive(target)) {
      console.error(target ? `Agent not found: ${target}` : 'No active agent')
      process.exit(1)
    }

    const res = await sendRequest({ action: 'stats' }, target)
    if (!res.success) {
      console.error('Error:', res.error)
      process.exit(1)
    }

    const stats = res.data as { messageCount: number; usage: { input: number; output: number; total: number } }
    console.log(`Messages: ${stats.messageCount}`)
    console.log(`Tokens: ${stats.usage.total} (in: ${stats.usage.input}, out: ${stats.usage.output})`)
  })

// Export command
program
  .command('export')
  .description('Export agent transcript')
  .option('--to <target>', 'Target agent')
  .action(async (options) => {
    const target = options.to

    if (!isSessionActive(target)) {
      console.error(target ? `Agent not found: ${target}` : 'No active agent')
      process.exit(1)
    }

    const res = await sendRequest({ action: 'export' }, target)
    if (!res.success) {
      console.error('Error:', res.error)
      process.exit(1)
    }

    console.log(JSON.stringify(res.data, null, 2))
  })

// Clear command
program
  .command('clear')
  .description('Clear conversation history')
  .option('--to <target>', 'Target agent')
  .action(async (options) => {
    const target = options.to

    if (!isSessionActive(target)) {
      console.error(target ? `Agent not found: ${target}` : 'No active agent')
      process.exit(1)
    }

    const res = await sendRequest({ action: 'clear' }, target)
    if (res.success) {
      console.log('History cleared')
    } else {
      console.error('Error:', res.error)
    }
  })

// Pending approvals command
program
  .command('pending')
  .description('List pending tool approvals')
  .option('--to <target>', 'Target agent')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const target = options.to

    if (!isSessionActive(target)) {
      console.error(target ? `Agent not found: ${target}` : 'No active agent')
      process.exit(1)
    }

    const res = await sendRequest({ action: 'pending' }, target)
    if (!res.success) {
      console.error('Error:', res.error)
      process.exit(1)
    }

    const pending = res.data as Array<{
      id: string
      toolName: string
      arguments: unknown
      requestedAt: string
    }>

    if (options.json) {
      console.log(JSON.stringify(pending, null, 2))
      return
    }

    if (pending.length === 0) {
      console.log('No pending approvals')
      return
    }

    for (const p of pending) {
      console.log(`[${p.id.slice(0, 8)}] ${p.toolName}`)
      console.log(`  Arguments: ${JSON.stringify(p.arguments)}`)
    }
  })

// Approve command
program
  .command('approve <id>')
  .description('Approve a pending tool call')
  .option('--to <target>', 'Target agent')
  .option('--json', 'Output as JSON')
  .action(async (id, options) => {
    const target = options.to

    if (!isSessionActive(target)) {
      console.error(target ? `Agent not found: ${target}` : 'No active agent')
      process.exit(1)
    }

    const res = await sendRequest({ action: 'approve', payload: { id } }, target)
    if (!res.success) {
      console.error('Error:', res.error)
      process.exit(1)
    }

    if (options.json) {
      console.log(JSON.stringify({ approved: true, result: res.data }, null, 2))
    } else {
      console.log('Approved')
      console.log(`Result: ${JSON.stringify(res.data, null, 2)}`)
    }
  })

// Deny command
program
  .command('deny <id>')
  .description('Deny a pending tool call')
  .option('--to <target>', 'Target agent')
  .option('-r, --reason <reason>', 'Reason for denial')
  .action(async (id, options) => {
    const target = options.to

    if (!isSessionActive(target)) {
      console.error(target ? `Agent not found: ${target}` : 'No active agent')
      process.exit(1)
    }

    const res = await sendRequest({
      action: 'deny',
      payload: { id, reason: options.reason },
    }, target)

    if (res.success) {
      console.log('Denied')
    } else {
      console.error('Error:', res.error)
      process.exit(1)
    }
  })

// Provider API key configuration
const PROVIDER_API_KEYS: Record<string, { envVar: string; description: string }> = {
  gateway: { envVar: 'AI_GATEWAY_API_KEY', description: 'Vercel AI Gateway (all providers)' },
  anthropic: { envVar: 'ANTHROPIC_API_KEY', description: 'Anthropic Claude' },
  openai: { envVar: 'OPENAI_API_KEY', description: 'OpenAI GPT' },
  deepseek: { envVar: 'DEEPSEEK_API_KEY', description: 'DeepSeek' },
  google: { envVar: 'GOOGLE_GENERATIVE_AI_API_KEY', description: 'Google Gemini' },
  groq: { envVar: 'GROQ_API_KEY', description: 'Groq' },
  mistral: { envVar: 'MISTRAL_API_KEY', description: 'Mistral' },
  xai: { envVar: 'XAI_API_KEY', description: 'xAI Grok' },
  minimax: { envVar: 'MINIMAX_API_KEY', description: 'MiniMax' },
}

// Providers command
program
  .command('providers')
  .description('Check provider availability')
  .action(() => {
    console.log('Provider Status:\n')

    for (const [name, config] of Object.entries(PROVIDER_API_KEYS)) {
      const isConfigured = !!process.env[config.envVar]
      const status = isConfigured ? '✓' : '✗'
      const statusText = isConfigured ? '' : ' (not configured)'
      const envHint = isConfigured ? '' : ` [${config.envVar}]`
      // Show default model for each provider
      const defaultModel = name === 'gateway'
        ? ''
        : ` → ${name}/${FRONTIER_MODELS[name as keyof typeof FRONTIER_MODELS]?.[0] || '?'}`
      console.log(`  ${status} ${name.padEnd(10)} - ${config.description}${statusText}${envHint}${defaultModel}`)
    }

    // Get example models from FRONTIER_MODELS
    const defaultModel = getDefaultModel()
    const gatewayExample = `openai/${FRONTIER_MODELS.openai[0]}`
    const directExample = `deepseek:${FRONTIER_MODELS.deepseek[0]}`

    console.log('\nUsage:')
    console.log(`  Provider only:   provider         (e.g., openai → ${gatewayExample})`)
    console.log(`  Gateway format:  provider/model   (e.g., ${gatewayExample})`)
    console.log(`  Direct format:   provider:model   (e.g., ${directExample})`)
    console.log(`\nDefault: ${defaultModel} (when no model specified)`)
  })

// Backends command
program
  .command('backends')
  .description('Check available backends (SDK, CLI tools)')
  .action(async () => {
    const { listBackends } = await import('../backends/index.ts')
    const backends = await listBackends()

    console.log('Backend Status:\n')

    for (const backend of backends) {
      const status = backend.available ? '✓' : '✗'
      const statusText = backend.available ? '' : ' (not installed)'
      console.log(`  ${status} ${backend.type.padEnd(8)} - ${backend.name}${statusText}`)
    }

    console.log('\nUsage:')
    console.log('  SDK backend:    agent-worker new myagent -m openai/gpt-5.2')
    console.log('  SDK backend:    agent-worker new myagent -m anthropic/claude-sonnet-4-5')
    console.log('  Claude CLI:     agent-worker new myagent -b claude')
    console.log('  Codex CLI:      agent-worker new myagent -b codex')
    console.log('  Cursor CLI:     agent-worker new myagent -b cursor')
    console.log('')
    console.log('Note: CLI backends use their own model selection. The -m flag is optional.')
    console.log('Tool management (add, mock, import) is only supported with SDK backend.')
  })

// ============================================================================
// Workflow commands
// ============================================================================

// Run workflow
program
  .command('run <file>')
  .description('Execute workflow tasks and exit')
  .option('--instance <name>', 'Instance name', 'default')
  .option('--lazy', 'Lazy agent startup')
  .option('--verbose', 'Show detailed progress')
  .option('--json', 'Output results as JSON')
  .action(async (file, options) => {
    const { parseWorkflowFile, runWorkflow } = await import('../workflow/index.ts')
    type ResolvedAgent = Awaited<ReturnType<typeof parseWorkflowFile>>['agents'][string]

    const startedAgents: string[] = []

    try {
      // Parse workflow
      const workflow = await parseWorkflowFile(file)

      if (options.verbose) {
        console.log(`Running workflow: ${workflow.name}`)
        console.log(`Agents: ${Object.keys(workflow.agents).join(', ')}`)
        console.log(`Tasks: ${workflow.tasks.length}`)
        console.log('')
      }

      // Helper to start an agent
      const startAgent = async (agentName: string, config: ResolvedAgent) => {
        const fullName = buildAgentId(agentName, options.instance)

        if (options.verbose) {
          console.log(`Starting agent: ${fullName}`)
        }

        // Start agent in foreground mode (we'll manage lifecycle)
        await createAgentAction(fullName, {
          model: config.model,
          system: config.resolvedSystemPrompt,
          backend: 'sdk',
        })

        startedAgents.push(fullName)
      }

      // Helper to send message to agent
      const sendToAgent = async (agentName: string, message: string, outputPrompt?: string): Promise<string> => {
        const fullName = buildAgentId(agentName, options.instance)

        // Send message and wait for response
        const res = await sendRequest({
          action: 'send',
          payload: { message, options: { autoApprove: true }, async: false },
        }, fullName)

        if (!res.success) {
          throw new Error(`Failed to send to ${agentName}: ${res.error}`)
        }

        const response = res.data as { content: string }
        let result = response.content

        // If output prompt specified, send follow-up
        if (outputPrompt) {
          const summaryRes = await sendRequest({
            action: 'send',
            payload: {
              message: `[Output Request] ${outputPrompt}`,
              options: { autoApprove: true },
              async: false,
            },
          }, fullName)

          if (summaryRes.success) {
            result = (summaryRes.data as { content: string }).content
          }
        }

        return result
      }

      // Run workflow
      const result = await runWorkflow({
        workflow,
        instance: options.instance,
        lazy: options.lazy,
        verbose: options.verbose,
        startAgent,
        sendToAgent,
        log: options.verbose ? console.log : () => {},
      })

      // Output results
      if (options.json) {
        console.log(JSON.stringify(result, null, 2))
      } else {
        if (result.success) {
          console.log('\n--- Result ---')
          console.log(result.output)
          console.log(`\nCompleted in ${result.duration}ms`)
        } else {
          console.error('\n--- Error ---')
          console.error(result.error)
          process.exit(1)
        }
      }

    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error))
      process.exit(1)
    } finally {
      // Cleanup: stop all started agents
      for (const agentName of startedAgents) {
        try {
          await sendRequest({ action: 'shutdown' }, agentName)
          if (options.verbose) {
            console.log(`Stopped agent: ${agentName}`)
          }
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  })

// Up workflow (run and keep agents alive)
program
  .command('up <file>')
  .description('Execute workflow tasks and keep agents alive')
  .option('--instance <name>', 'Instance name', 'default')
  .option('--lazy', 'Lazy agent startup')
  .option('--verbose', 'Show detailed progress')
  .action(async (file, options) => {
    const { parseWorkflowFile, runWorkflow } = await import('../workflow/index.ts')
    type ResolvedAgent = Awaited<ReturnType<typeof parseWorkflowFile>>['agents'][string]

    const startedAgents: string[] = []

    try {
      // Parse workflow
      const workflow = await parseWorkflowFile(file)

      console.log(`Starting workflow: ${workflow.name}`)
      console.log(`Instance: ${options.instance}`)

      // Helper to start an agent
      const startAgent = async (agentName: string, config: ResolvedAgent) => {
        const fullName = buildAgentId(agentName, options.instance)

        if (options.verbose) {
          console.log(`Starting agent: ${fullName}`)
        }

        await createAgentAction(fullName, {
          model: config.model,
          system: config.resolvedSystemPrompt,
          backend: 'sdk',
        })

        startedAgents.push(fullName)
      }

      // Helper to send message to agent
      const sendToAgent = async (agentName: string, message: string, outputPrompt?: string): Promise<string> => {
        const fullName = buildAgentId(agentName, options.instance)

        const res = await sendRequest({
          action: 'send',
          payload: { message, options: { autoApprove: true }, async: false },
        }, fullName)

        if (!res.success) {
          throw new Error(`Failed to send to ${agentName}: ${res.error}`)
        }

        const response = res.data as { content: string }
        let result = response.content

        if (outputPrompt) {
          const summaryRes = await sendRequest({
            action: 'send',
            payload: {
              message: `[Output Request] ${outputPrompt}`,
              options: { autoApprove: true },
              async: false,
            },
          }, fullName)

          if (summaryRes.success) {
            result = (summaryRes.data as { content: string }).content
          }
        }

        return result
      }

      // Run workflow tasks (if any)
      if (workflow.tasks.length > 0) {
        const result = await runWorkflow({
          workflow,
          instance: options.instance,
          lazy: options.lazy,
          verbose: options.verbose,
          startAgent,
          sendToAgent,
          log: options.verbose ? console.log : () => {},
        })

        if (!result.success) {
          console.error('Workflow execution failed:', result.error)
          // Still keep agents running
        } else if (options.verbose) {
          console.log('\nWorkflow tasks completed.')
        }
      }

      // Print running agents
      console.log('\nAgents running:')
      for (const agent of startedAgents) {
        console.log(`  ${agent}`)
      }
      console.log('\nUse `agent-worker send --to <agent>` to interact.')
      console.log('Use `agent-worker down --all` to stop all agents.')

    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error))
      // Cleanup on error
      for (const agentName of startedAgents) {
        try {
          await sendRequest({ action: 'shutdown' }, agentName)
        } catch {
          // Ignore
        }
      }
      process.exit(1)
    }
    // Note: agents are NOT cleaned up - they stay running
  })

// List running workflows/agents (ps)
program
  .command('ps')
  .description('List running agents from workflows')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const sessions = listSessions()

    if (sessions.length === 0) {
      console.log('No running agents')
      return
    }

    if (options.json) {
      console.log(JSON.stringify(sessions.map(s => ({
        name: s.name,
        model: s.model,
        backend: s.backend,
        running: isSessionRunning(s.id),
      })), null, 2))
      return
    }

    // Table header
    console.log('NAME'.padEnd(25) + 'MODEL'.padEnd(35) + 'STATUS')
    console.log('-'.repeat(70))

    for (const s of sessions) {
      const running = isSessionRunning(s.id)
      const status = running ? 'running' : 'stopped'
      const name = s.name || s.id.slice(0, 8)
      console.log(name.padEnd(25) + s.model.padEnd(35) + status)
    }
  })

program.parse()
