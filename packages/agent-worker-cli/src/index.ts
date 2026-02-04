#!/usr/bin/env node
import { Command } from 'commander'
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import type { ToolDefinition } from 'agent-worker'
import { sendRequest, isSessionActive } from './client.ts'
import { startServer, isServerRunning, getPidFile, getSocketPath } from './server.ts'

const program = new Command()

program
  .name('agent-worker')
  .description('CLI for creating and testing agent workers')
  .version('0.0.1')

// Session commands
const sessionCmd = program.command('session').description('Manage test sessions')

sessionCmd
  .command('start')
  .description('Start a new session (runs as background service)')
  .requiredOption('-m, --model <model>', 'Model identifier (e.g., openai/gpt-5.2, anthropic/claude-sonnet-4-5)')
  .option('-s, --system <prompt>', 'System prompt', 'You are a helpful assistant.')
  .option('-f, --system-file <file>', 'Read system prompt from file')
  .option('--foreground', 'Run in foreground (don\'t daemonize)')
  .action((options) => {
    if (isServerRunning()) {
      console.error('Session already running. Use `agent-worker session end` first.')
      process.exit(1)
    }

    let system = options.system
    if (options.systemFile) {
      system = readFileSync(options.systemFile, 'utf-8')
    }

    if (options.foreground) {
      // Run in foreground
      startServer({ model: options.model, system })
    } else {
      // Spawn as background process
      const child = spawn(
        process.execPath,
        [process.argv[1], 'session', 'start', '-m', options.model, '-s', system, '--foreground'],
        {
          detached: true,
          stdio: 'ignore',
        }
      )
      child.unref()

      // Wait a bit for server to start
      setTimeout(async () => {
        if (isServerRunning()) {
          const res = await sendRequest({ action: 'ping' })
          if (res.success && res.data) {
            const { id, model } = res.data as { id: string; model: string }
            console.log(`Session started: ${id}`)
            console.log(`Model: ${model}`)
          }
        } else {
          console.error('Failed to start session')
          process.exit(1)
        }
      }, 500)
    }
  })

sessionCmd
  .command('status')
  .description('Check session status')
  .action(async () => {
    if (!isServerRunning()) {
      console.log('No active session')
      return
    }

    const res = await sendRequest({ action: 'ping' })
    if (res.success && res.data) {
      const { id, model } = res.data as { id: string; model: string }
      console.log(`Session active: ${id}`)
      console.log(`Model: ${model}`)
    } else {
      console.log('Session not responding')
    }
  })

sessionCmd
  .command('end')
  .description('End the current session')
  .action(async () => {
    if (!isServerRunning()) {
      console.log('No active session')
      return
    }

    const res = await sendRequest({ action: 'shutdown' })
    if (res.success) {
      console.log('Session ended')
    } else {
      console.error('Error:', res.error)
    }
  })

// Send command
program
  .command('send <message>')
  .description('Send a message to the current session')
  .option('--json', 'Output full JSON response')
  .option('--auto-approve', 'Auto-approve all tool calls (default)')
  .option('--no-auto-approve', 'Require manual approval for tools with needsApproval')
  .action(async (message, options) => {
    if (!isSessionActive()) {
      console.error('No active session. Start one with: agent-worker session start -m <model>')
      process.exit(1)
    }

    const autoApprove = options.autoApprove !== false
    const res = await sendRequest({
      action: 'send',
      payload: { message, options: { autoApprove } },
    })

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
        console.log('\nUse: agent-worker approve <id> or agent-worker deny <id>')
      }
    }
  })

// Tool commands
const toolCmd = program.command('tool').description('Manage tools')

toolCmd
  .command('add <name>')
  .description('Add a tool to current session')
  .requiredOption('-d, --desc <description>', 'Tool description')
  .option('-p, --param <params...>', 'Parameters in format name:type:description')
  .option('--needs-approval', 'Require user approval before execution')
  .action(async (name, options) => {
    if (!isSessionActive()) {
      console.error('No active session')
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
      parameters: {
        type: 'object',
        properties,
        required,
      },
      needsApproval: options.needsApproval ?? false,
    }

    const res = await sendRequest({ action: 'tool_add', payload: tool })
    if (res.success) {
      const approvalNote = options.needsApproval ? ' (needs approval)' : ''
      console.log(`Tool added: ${name}${approvalNote}`)
    } else {
      console.error('Error:', res.error)
      process.exit(1)
    }
  })

toolCmd
  .command('mock <name> <response>')
  .description('Set mock response for a tool')
  .action(async (name, response) => {
    if (!isSessionActive()) {
      console.error('No active session')
      process.exit(1)
    }

    try {
      const parsed = JSON.parse(response)
      const res = await sendRequest({
        action: 'tool_mock',
        payload: { name, response: parsed },
      })

      if (res.success) {
        console.log(`Mock set for: ${name}`)
      } else {
        console.error('Error:', res.error)
        process.exit(1)
      }
    } catch (e) {
      console.error('Invalid JSON response')
      process.exit(1)
    }
  })

toolCmd
  .command('list')
  .description('List tools in current session')
  .action(async () => {
    if (!isSessionActive()) {
      console.error('No active session')
      process.exit(1)
    }

    const res = await sendRequest({ action: 'tool_list' })
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
  .option('--json', 'Output as JSON')
  .option('-n, --last <count>', 'Show last N messages', parseInt)
  .action(async (options) => {
    if (!isSessionActive()) {
      console.error('No active session')
      process.exit(1)
    }

    const res = await sendRequest({ action: 'history' })
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
        const role = msg.role.toUpperCase()
        const status = msg.status === 'responding' ? ' (responding...)' : ''
        console.log(`[${role}${status}] ${msg.content}\n`)
      }
    }
  })

// Stats command
program
  .command('stats')
  .description('Show session statistics')
  .action(async () => {
    if (!isSessionActive()) {
      console.error('No active session')
      process.exit(1)
    }

    const res = await sendRequest({ action: 'stats' })
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
  .action(async () => {
    if (!isSessionActive()) {
      console.error('No active session')
      process.exit(1)
    }

    const res = await sendRequest({ action: 'export' })
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
  .action(async () => {
    if (!isSessionActive()) {
      console.error('No active session')
      process.exit(1)
    }

    const res = await sendRequest({ action: 'clear' })
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
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    if (!isSessionActive()) {
      console.error('No active session')
      process.exit(1)
    }

    const res = await sendRequest({ action: 'pending' })
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
      console.log(`  Requested: ${p.requestedAt}`)
      console.log()
    }
  })

// Approve command
program
  .command('approve <id>')
  .description('Approve a pending tool call')
  .option('--json', 'Output result as JSON')
  .action(async (id, options) => {
    if (!isSessionActive()) {
      console.error('No active session')
      process.exit(1)
    }

    const res = await sendRequest({ action: 'approve', payload: { id } })
    if (!res.success) {
      console.error('Error:', res.error)
      process.exit(1)
    }

    if (options.json) {
      console.log(JSON.stringify({ approved: true, result: res.data }, null, 2))
    } else {
      console.log(`Approved`)
      console.log(`Result: ${JSON.stringify(res.data, null, 2)}`)
    }
  })

// Deny command
program
  .command('deny <id>')
  .description('Deny a pending tool call')
  .option('-r, --reason <reason>', 'Reason for denial')
  .action(async (id, options) => {
    if (!isSessionActive()) {
      console.error('No active session')
      process.exit(1)
    }

    const res = await sendRequest({
      action: 'deny',
      payload: { id, reason: options.reason },
    })

    if (res.success) {
      console.log('Denied')
      if (options.reason) {
        console.log(`Reason: ${options.reason}`)
      }
    } else {
      console.error('Error:', res.error)
      process.exit(1)
    }
  })

program.parse()
