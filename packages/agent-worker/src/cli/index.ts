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

// `down` as alias for `stop` (deprecated)
program
  .command('down [target]')
  .description('Stop an agent (deprecated, use "stop")')
  .option('--all', 'Stop all agents')
  .action(async (target, options) => {
    deprecationWarning('down', 'stop')
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
  .description('Execute workflow and exit when complete')
  .option('--instance <name>', 'Instance name', 'default')
  .option('-v, --verbose', 'Show detailed progress')
  .option('-d, --debug', 'Show debug logs (internal details, no channel output)')
  .option('--json', 'Output results as JSON')
  .action(async (file, options) => {
    const { parseWorkflowFile, runWorkflowWithControllers } = await import('../workflow/index.ts')

    try {
      // Parse workflow
      const workflow = await parseWorkflowFile(file, { instance: options.instance })

      if (!options.debug) {
        console.log(`Running workflow: ${workflow.name}`)
        console.log(`Agents: ${Object.keys(workflow.agents).join(', ')}\n`)
      }

      const result = await runWorkflowWithControllers({
        workflow,
        instance: options.instance,
        verbose: options.verbose,
        debug: options.debug,
        log: console.log,
        mode: 'run', // Exit when all agents idle
      })

      if (!result.success) {
        console.error('Workflow failed:', result.error)
        process.exit(1)
      }

      if (options.verbose && !options.debug) {
        console.log(`\nWorkflow completed in ${result.duration}ms`)
      }

      // Read final document content as result
      if (result.contextProvider && !options.debug) {
        const finalDoc = await result.contextProvider.readDocument()
        if (options.json) {
          console.log(JSON.stringify({
            success: true,
            duration: result.duration,
            document: finalDoc,
          }, null, 2))
        } else if (finalDoc) {
          console.log('\n--- Document ---')
          console.log(finalDoc)
        }
      }

    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  })

// Start workflow and keep agents running
program
  .command('start <file>')
  .description('Start workflow and keep agents running')
  .option('--instance <name>', 'Instance name', 'default')
  .option('-v, --verbose', 'Show detailed progress')
  .option('-d, --debug', 'Show debug logs (internal details, no channel output)')
  .option('--background', 'Run in background (daemonize)')
  .action(async (file, options) => {
    const { parseWorkflowFile, runWorkflowWithControllers } = await import('../workflow/index.ts')

    // Background mode: spawn detached process
    if (options.background) {
      const scriptPath = process.argv[1] ?? ''
      const args = [scriptPath, 'start', file, '--instance', options.instance]
      if (options.verbose) args.push('--verbose')

      const child = spawn(process.execPath, args, {
        detached: true,
        stdio: 'ignore',
      })
      child.unref()

      console.log(`Workflow started in background (PID: ${child.pid})`)
      console.log(`Use \`agent-worker stop --instance ${options.instance}\` to stop.`)
      return
    }

    let shutdownFn: (() => Promise<void>) | undefined

    // Setup graceful shutdown
    const cleanup = async () => {
      console.log('\nShutting down...')
      if (shutdownFn) {
        await shutdownFn()
      }
      process.exit(0)
    }

    process.on('SIGINT', cleanup)
    process.on('SIGTERM', cleanup)

    try {
      // Parse workflow
      const workflow = await parseWorkflowFile(file, { instance: options.instance })

      if (!options.debug) {
        console.log(`Starting workflow: ${workflow.name}`)
        console.log(`Agents: ${Object.keys(workflow.agents).join(', ')}\n`)
      }

      const result = await runWorkflowWithControllers({
        workflow,
        instance: options.instance,
        verbose: options.verbose,
        debug: options.debug,
        log: console.log,
        mode: 'start', // Keep running until stopped
      })

      if (!result.success) {
        console.error('Workflow failed:', result.error)
        process.exit(1)
      }

      shutdownFn = result.shutdown

      if (!options.debug) {
        console.log('\nWorkflow started. Press Ctrl+C to stop.\n')
      }

      // Keep process alive
      await new Promise(() => {})

    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error))
      await cleanup()
      process.exit(1)
    }
  })

// Up workflow (deprecated alias for start)
program
  .command('up <file>')
  .description('Start workflow (deprecated, use "start")')
  .option('--instance <name>', 'Instance name', 'default')
  .option('--verbose', 'Show detailed progress')
  .action(async (file, options) => {
    deprecationWarning('up', 'start')
    console.log('Please use `agent-worker start` instead.')
    console.log(`Example: agent-worker start ${file} --instance ${options.instance}`)
  })

// Stop workflow/agents
program
  .command('stop [target]')
  .description('Stop workflow agents')
  .option('--all', 'Stop all agents')
  .option('--instance <name>', 'Instance name to stop')
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

    if (options.instance) {
      // Stop all agents for this instance
      const sessions = listSessions()
      for (const s of sessions) {
        if (s.name && s.name.includes(`@${options.instance}`) && isSessionRunning(s.id)) {
          await sendRequest({ action: 'shutdown' }, s.id)
          console.log(`Stopped: ${s.name}`)
        }
      }
      return
    }

    if (!target) {
      console.error('Specify target agent or use --all/--instance')
      process.exit(1)
    }

    if (!isSessionRunning(target)) {
      console.log(`Agent not found: ${target}`)
      return
    }

    const res = await sendRequest({ action: 'shutdown' }, target)
    if (res.success) {
      console.log('Agent stopped')
    } else {
      console.error('Error:', res.error)
    }
  })

// List running workflows/agents
program
  .command('list')
  .description('List running agents')
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

// ps (deprecated alias for list)
program
  .command('ps')
  .description('List running agents (deprecated, use "list")')
  .option('--json', 'Output as JSON')
  .action((options) => {
    deprecationWarning('ps', 'list')
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

// ============================================================================
// Context commands (CLI fallback for MCP)
// ============================================================================
const contextCmd = program.command('context').description('Interact with shared workflow context (CLI fallback for MCP)')

// Context channel subcommands
const channelCmd = contextCmd.command('channel').description('Channel operations')

channelCmd
  .command('send <message>')
  .description('Send a message to the channel')
  .requiredOption('--from <agent>', 'Agent name sending the message')
  .requiredOption('--dir <path>', 'Context directory path')
  .option('--agents <list>', 'Comma-separated list of valid agent names')
  .action(async (message, options) => {
    const { createFileContextProvider } = await import('../workflow/context/index.ts')

    const validAgents = options.agents ? options.agents.split(',') : [options.from]
    const provider = createFileContextProvider(options.dir, validAgents)

    const entry = await provider.appendChannel(options.from, message)
    console.log(`[${entry.timestamp}] Message sent`)
    if (entry.mentions.length > 0) {
      console.log(`Mentions: ${entry.mentions.join(', ')}`)
    }
  })

channelCmd
  .command('read')
  .description('Read channel entries')
  .requiredOption('--dir <path>', 'Context directory path')
  .option('--since <timestamp>', 'Read entries after this timestamp')
  .option('--limit <count>', 'Maximum entries to return', parseInt)
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { createFileContextProvider } = await import('../workflow/context/index.ts')

    const provider = createFileContextProvider(options.dir, [])
    const entries = await provider.readChannel({ since: options.since, limit: options.limit })

    if (options.json) {
      console.log(JSON.stringify(entries, null, 2))
      return
    }

    if (entries.length === 0) {
      console.log('No messages')
      return
    }

    for (const entry of entries) {
      const mentions = entry.mentions.length > 0 ? ` → @${entry.mentions.join(' @')}` : ''
      console.log(`[${entry.timestamp}] ${entry.from}${mentions}`)
      console.log(`  ${entry.content.split('\n').join('\n  ')}`)
    }
  })

channelCmd
  .command('peek')
  .description('Peek at recent channel messages')
  .requiredOption('--dir <path>', 'Context directory path')
  .option('-n, --count <count>', 'Number of messages', '5')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { createFileContextProvider } = await import('../workflow/context/index.ts')

    const provider = createFileContextProvider(options.dir, [])
    const count = parseInt(options.count, 10)
    const entries = await provider.readChannel({ limit: count })

    if (options.json) {
      console.log(JSON.stringify(entries, null, 2))
      return
    }

    if (entries.length === 0) {
      console.log('No messages')
      return
    }

    for (const entry of entries) {
      const mentions = entry.mentions.length > 0 ? ` → @${entry.mentions.join(' @')}` : ''
      console.log(`[${entry.from}]${mentions} ${entry.content.length > 80 ? entry.content.slice(0, 80) + '...' : entry.content}`)
    }
  })

channelCmd
  .command('mentions')
  .description('Get unread mentions for an agent')
  .requiredOption('--agent <name>', 'Agent to check mentions for')
  .requiredOption('--dir <path>', 'Context directory path')
  .option('--agents <list>', 'Comma-separated list of valid agent names')
  .option('--ack <timestamp>', 'Acknowledge mentions up to this timestamp')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { createFileContextProvider } = await import('../workflow/context/index.ts')

    const validAgents = options.agents ? options.agents.split(',') : [options.agent]
    const provider = createFileContextProvider(options.dir, validAgents)

    if (options.ack) {
      await provider.ackInbox(options.agent, options.ack)
      console.log(`Acknowledged inbox up to: ${options.ack}`)
      return
    }

    const mentions = await provider.getInbox(options.agent)

    if (options.json) {
      console.log(JSON.stringify(mentions, null, 2))
      return
    }

    if (mentions.length === 0) {
      console.log('No unread mentions')
      return
    }

    console.log(`${mentions.length} unread message(s):`)
    for (const m of mentions) {
      const priority = m.priority === 'high' ? ' [HIGH]' : ''
      console.log(`  [${m.entry.timestamp}]${priority} from ${m.entry.from}: ${m.entry.content.slice(0, 60)}...`)
    }
  })

// Context document subcommands
const documentCmd = contextCmd.command('document').description('Document operations')

documentCmd
  .command('read')
  .description('Read the shared document')
  .requiredOption('--dir <path>', 'Context directory path')
  .action(async (options) => {
    const { createFileContextProvider } = await import('../workflow/context/index.ts')

    const provider = createFileContextProvider(options.dir, [])
    const content = await provider.readDocument()

    if (content) {
      console.log(content)
    } else {
      console.log('(empty document)')
    }
  })

documentCmd
  .command('write')
  .description('Write content to the shared document')
  .requiredOption('--dir <path>', 'Context directory path')
  .option('--content <text>', 'Content to write')
  .option('--file <path>', 'Read content from file')
  .action(async (options) => {
    const { createFileContextProvider } = await import('../workflow/context/index.ts')

    let content = options.content
    if (options.file) {
      content = readFileSync(options.file, 'utf-8')
    }

    if (!content) {
      console.error('Provide --content or --file')
      process.exit(1)
    }

    const provider = createFileContextProvider(options.dir, [])
    await provider.writeDocument(content)
    console.log('Document written')
  })

documentCmd
  .command('append')
  .description('Append content to the shared document')
  .requiredOption('--dir <path>', 'Context directory path')
  .option('--content <text>', 'Content to append')
  .option('--file <path>', 'Read content from file')
  .action(async (options) => {
    const { createFileContextProvider } = await import('../workflow/context/index.ts')

    let content = options.content
    if (options.file) {
      content = readFileSync(options.file, 'utf-8')
    }

    if (!content) {
      console.error('Provide --content or --file')
      process.exit(1)
    }

    const provider = createFileContextProvider(options.dir, [])
    await provider.appendDocument(content)
    console.log('Content appended')
  })

// MCP stdio bridge (for external CLI tools)
contextCmd
  .command('mcp-stdio')
  .description('Bridge MCP over stdio (for external CLI tools)')
  .requiredOption('--socket <path>', 'Unix socket path to connect to')
  .requiredOption('--agent <name>', 'Agent identity for the connection')
  .action(async (options) => {
    const { createConnection } = await import('node:net')

    // Connect to the Unix socket
    const socket = createConnection(options.socket)

    // Wait for connection before sending header and piping
    socket.on('connect', () => {
      // Send agent ID header first, then start piping
      socket.write(`X-Agent-Id: ${options.agent}\n\n`, () => {
        // Header sent — now bridge stdio to socket
        process.stdin.pipe(socket)
        socket.pipe(process.stdout)
      })
    })

    socket.on('error', (err) => {
      process.stderr.write(`mcp-stdio [${options.agent}]: socket error: ${err.message}\n`)
      process.exit(1)
    })

    socket.on('close', () => {
      process.exit(0)
    })

    // Handle stdin close (parent process finished)
    process.stdin.on('end', () => {
      socket.end()
    })
  })

program.parse()
