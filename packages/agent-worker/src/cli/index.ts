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

const program = new Command()

program
  .name('agent-worker')
  .description('CLI for creating and testing agent workers')
  .version('0.0.1')

// Session commands
const sessionCmd = program.command('session').description('Manage sessions')

sessionCmd
  .command('new')
  .description('Create a new session')
  .option('-m, --model <model>', `Model identifier (default: ${getDefaultModel()})`)
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
  .option('--foreground', 'Run in foreground')
  .action(async (options) => {
    let system = options.system
    if (options.systemFile) {
      system = readFileSync(options.systemFile, 'utf-8')
    }

    const backend = options.backend as BackendType

    // Use default model if not specified
    const model = options.model || getDefaultModel()

    const idleTimeout = parseInt(options.idleTimeout, 10)

    if (options.foreground) {
      startServer({
        model,
        system,
        name: options.name,
        idleTimeout,
        backend,
        skills: options.skill,
        skillDirs: options.skillDir,
      })
    } else {
      const args = [process.argv[1], 'session', 'new', '-m', model, '-b', backend, '-s', system, '--foreground']
      if (options.name) {
        args.push('-n', options.name)
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

      const child = spawn(process.execPath, args, {
        detached: true,
        stdio: 'ignore',
      })
      child.unref()

      // Wait for ready signal instead of blind timeout
      const info = await waitForReady(options.name, 5000)
      if (info) {
        const nameStr = options.name ? ` (${options.name})` : ''
        console.log(`Session started: ${info.id}${nameStr}`)
        console.log(`Model: ${info.model}`)
        console.log(`Backend: ${backend}`)
      } else {
        console.error('Failed to start session')
        process.exit(1)
      }
    }
  })

sessionCmd
  .command('list')
  .description('List all sessions')
  .action(() => {
    const sessions = listSessions()
    if (sessions.length === 0) {
      console.log('No active sessions')
      return
    }

    for (const s of sessions) {
      const running = isSessionRunning(s.id)
      const status = running ? 'running' : 'stopped'
      const nameStr = s.name ? ` (${s.name})` : ''
      console.log(`  ${s.id.slice(0, 8)}${nameStr} - ${s.model} [${status}]`)
    }
  })

sessionCmd
  .command('status [target]')
  .description('Check session status')
  .action(async (target) => {
    if (!isSessionRunning(target)) {
      console.log(target ? `Session not found: ${target}` : 'No active session')
      return
    }

    const res = await sendRequest({ action: 'ping' }, target)
    if (res.success && res.data) {
      const { id, model, name } = res.data as { id: string; model: string; name?: string }
      const nameStr = name ? ` (${name})` : ''
      console.log(`Session: ${id}${nameStr}`)
      console.log(`Model: ${model}`)
    }
  })

sessionCmd
  .command('use <target>')
  .description('Set default session')
  .action((target) => {
    if (setDefaultSession(target)) {
      console.log(`Default session set to: ${target}`)
    } else {
      console.error(`Session not found: ${target}`)
      process.exit(1)
    }
  })

sessionCmd
  .command('end [target]')
  .description('End a session (or all with --all)')
  .option('--all', 'End all sessions')
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
      console.log(target ? `Session not found: ${target}` : 'No active session')
      return
    }

    const res = await sendRequest({ action: 'shutdown' }, target)
    if (res.success) {
      console.log('Session ended')
    } else {
      console.error('Error:', res.error)
    }
  })

// Send command
program
  .command('send <message>')
  .description('Send a message')
  .option('--to <target>', 'Target session (name or ID)')
  .option('--json', 'Output full JSON response')
  .option('--auto-approve', 'Auto-approve all tool calls (default)')
  .option('--no-auto-approve', 'Require manual approval')
  .action(async (message, options) => {
    const target = options.to

    if (!isSessionActive(target)) {
      if (target) {
        console.error(`Session not found: ${target}`)
      } else {
        console.error('No active session. Create one with: agent-worker session new -m <model>')
      }
      process.exit(1)
    }

    const autoApprove = options.autoApprove !== false
    const res = await sendRequest({
      action: 'send',
      payload: { message, options: { autoApprove } },
    }, target)

    if (!res.success) {
      console.error('Error:', res.error)
      process.exit(1)
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
  .option('--to <target>', 'Target session')
  .requiredOption('-d, --desc <description>', 'Tool description')
  .option('-p, --param <params...>', 'Parameters (name:type:description)')
  .option('--needs-approval', 'Require approval')
  .action(async (name, options) => {
    const target = options.to

    if (!isSessionActive(target)) {
      console.error(target ? `Session not found: ${target}` : 'No active session')
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
  .option('--to <target>', 'Target session')
  .action(async (file, options) => {
    const target = options.to

    if (!isSessionActive(target)) {
      console.error(target ? `Session not found: ${target}` : 'No active session')
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
  .option('--to <target>', 'Target session')
  .action(async (name, response, options) => {
    const target = options.to

    if (!isSessionActive(target)) {
      console.error(target ? `Session not found: ${target}` : 'No active session')
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
  .option('--to <target>', 'Target session')
  .action(async (options) => {
    const target = options.to

    if (!isSessionActive(target)) {
      console.error(target ? `Session not found: ${target}` : 'No active session')
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

// History command
program
  .command('history')
  .description('Show conversation history')
  .option('--to <target>', 'Target session')
  .option('--json', 'Output as JSON')
  .option('-n, --last <count>', 'Show last N messages', parseInt)
  .action(async (options) => {
    const target = options.to

    if (!isSessionActive(target)) {
      console.error(target ? `Session not found: ${target}` : 'No active session')
      process.exit(1)
    }

    const res = await sendRequest({ action: 'history' }, target)
    if (!res.success) {
      console.error('Error:', res.error)
      process.exit(1)
    }

    let history = res.data as Array<{ role: string; content: string; status?: string }>

    if (options.last && options.last > 0) {
      history = history.slice(-options.last)
    }

    if (options.json) {
      console.log(JSON.stringify(history, null, 2))
    } else {
      if (history.length === 0) {
        console.log('No messages')
        return
      }
      for (const msg of history) {
        const role = msg.role === 'user' ? 'YOU' : msg.role.toUpperCase()
        const status = msg.status === 'responding' ? ' (responding...)' : ''
        console.log(`[${role}${status}] ${msg.content}`)
      }
    }
  })

// Stats command
program
  .command('stats')
  .description('Show session statistics')
  .option('--to <target>', 'Target session')
  .action(async (options) => {
    const target = options.to

    if (!isSessionActive(target)) {
      console.error(target ? `Session not found: ${target}` : 'No active session')
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
  .description('Export session transcript')
  .option('--to <target>', 'Target session')
  .action(async (options) => {
    const target = options.to

    if (!isSessionActive(target)) {
      console.error(target ? `Session not found: ${target}` : 'No active session')
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
  .option('--to <target>', 'Target session')
  .action(async (options) => {
    const target = options.to

    if (!isSessionActive(target)) {
      console.error(target ? `Session not found: ${target}` : 'No active session')
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
  .option('--to <target>', 'Target session')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const target = options.to

    if (!isSessionActive(target)) {
      console.error(target ? `Session not found: ${target}` : 'No active session')
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
  .option('--to <target>', 'Target session')
  .option('--json', 'Output as JSON')
  .action(async (id, options) => {
    const target = options.to

    if (!isSessionActive(target)) {
      console.error(target ? `Session not found: ${target}` : 'No active session')
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
  .option('--to <target>', 'Target session')
  .option('-r, --reason <reason>', 'Reason for denial')
  .action(async (id, options) => {
    const target = options.to

    if (!isSessionActive(target)) {
      console.error(target ? `Session not found: ${target}` : 'No active session')
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
    console.log('  SDK backend:    agent-worker session new -m openai/gpt-5.2')
    console.log('  SDK backend:    agent-worker session new -m anthropic/claude-sonnet-4-5')
    console.log('  Claude CLI:     agent-worker session new -b claude')
    console.log('  Codex CLI:      agent-worker session new -b codex')
    console.log('  Cursor CLI:     agent-worker session new -b cursor')
    console.log('')
    console.log('Note: CLI backends use their own model selection. The -m flag is optional.')
    console.log('Tool management (add, mock, import) is only supported with SDK backend.')
  })

program.parse()
