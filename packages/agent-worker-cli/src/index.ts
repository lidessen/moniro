#!/usr/bin/env node
import { Command } from 'commander'
import { readFileSync } from 'node:fs'
import { AgentSession, type ToolDefinition } from 'agent-worker'
import {
  createSession,
  getCurrentSession,
  listSessions,
  useSession,
  closeSession,
  getCurrentSessionId,
  saveCurrentSession,
} from './session-store.ts'

const program = new Command()

program
  .name('agent-worker')
  .description('CLI for creating and testing agent workers')
  .version('0.0.1')

// Session commands
const sessionCmd = program.command('session').description('Manage test sessions')

sessionCmd
  .command('new')
  .description('Create a new test session')
  .requiredOption('-m, --model <model>', 'Model identifier (e.g., openai/gpt-5.2, anthropic/claude-sonnet-4-5)')
  .option('-s, --system <prompt>', 'System prompt')
  .option('-f, --system-file <file>', 'Read system prompt from file')
  .action((options) => {
    let system = options.system ?? ''
    if (options.systemFile) {
      system = readFileSync(options.systemFile, 'utf-8')
    }

    const session = createSession({
      model: options.model,
      system,
    })

    console.log(`Session created: ${session.id}`)
    console.log(`Model: ${session.model}`)
  })

sessionCmd
  .command('list')
  .description('List all sessions')
  .action(() => {
    const sessions = listSessions()
    const currentId = getCurrentSessionId()

    if (sessions.length === 0) {
      console.log('No sessions')
      return
    }

    for (const s of sessions) {
      const marker = s.id === currentId ? '* ' : '  '
      console.log(`${marker}${s.id} (${s.model})`)
    }
  })

sessionCmd
  .command('use <id>')
  .description('Switch to a session')
  .action((id) => {
    if (useSession(id)) {
      console.log(`Switched to session: ${id}`)
    } else {
      console.error(`Session not found: ${id}`)
      process.exit(1)
    }
  })

sessionCmd
  .command('close [id]')
  .description('Close a session')
  .action((id) => {
    if (closeSession(id)) {
      console.log('Session closed')
    } else {
      console.error('No session to close')
      process.exit(1)
    }
  })

// Send command
program
  .command('send <message>')
  .description('Send a message to the current session')
  .option('--json', 'Output full JSON response')
  .action(async (message, options) => {
    const session = getCurrentSession()
    if (!session) {
      console.error('No active session. Create one with: agent-worker session new')
      process.exit(1)
    }

    try {
      const response = await session.send(message)

      // Persist conversation state after send
      saveCurrentSession()

      if (options.json) {
        console.log(JSON.stringify(response, null, 2))
      } else {
        console.log(response.content)
        if (response.toolCalls.length > 0) {
          console.log('\n--- Tool Calls ---')
          for (const tc of response.toolCalls) {
            console.log(`${tc.name}(${JSON.stringify(tc.arguments)})`)
          }
        }
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error)
      process.exit(1)
    }
  })

// Tool commands
const toolCmd = program.command('tool').description('Manage tools')

toolCmd
  .command('add <name>')
  .description('Add a tool to current session')
  .requiredOption('-d, --desc <description>', 'Tool description')
  .option('-p, --param <params...>', 'Parameters in format name:type:description')
  .action((name, options) => {
    const session = getCurrentSession()
    if (!session) {
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
    }

    session.addTool(tool)
    console.log(`Tool added: ${name}`)
  })

toolCmd
  .command('mock <name> <response>')
  .description('Set mock response for a tool')
  .action((name, response) => {
    const session = getCurrentSession()
    if (!session) {
      console.error('No active session')
      process.exit(1)
    }

    try {
      const parsed = JSON.parse(response)
      session.mockTool(name, () => parsed)
      console.log(`Mock set for: ${name}`)
    } catch {
      console.error('Invalid JSON response')
      process.exit(1)
    }
  })

// History command
program
  .command('history')
  .description('Show conversation history')
  .option('--json', 'Output as JSON')
  .option('-n, --last <count>', 'Show last N messages', parseInt)
  .option('-r, --role <role>', 'Filter by role (user, assistant, system, tool)')
  .option('--search <text>', 'Filter messages containing text')
  .action((options) => {
    const session = getCurrentSession()
    if (!session) {
      console.error('No active session')
      process.exit(1)
    }

    let history = session.history()

    // Filter by role
    if (options.role) {
      history = history.filter((msg) => msg.role === options.role)
    }

    // Filter by search text
    if (options.search) {
      const searchLower = options.search.toLowerCase()
      history = history.filter((msg) => {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
        return content.toLowerCase().includes(searchLower)
      })
    }

    // Take last N messages
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
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
        console.log(`[${role}] ${content}\n`)
      }
    }
  })

// Stats command
program
  .command('stats')
  .description('Show session statistics')
  .action(() => {
    const session = getCurrentSession()
    if (!session) {
      console.error('No active session')
      process.exit(1)
    }

    const stats = session.stats()
    console.log(`Messages: ${stats.messageCount}`)
    console.log(`Tokens: ${stats.usage.total} (in: ${stats.usage.input}, out: ${stats.usage.output})`)
  })

// Export command
program
  .command('export')
  .description('Export session transcript')
  .action(() => {
    const session = getCurrentSession()
    if (!session) {
      console.error('No active session')
      process.exit(1)
    }

    console.log(JSON.stringify(session.export(), null, 2))
  })

program.parse()
