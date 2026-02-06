import type { Command } from 'commander'
import { sendRequest, isSessionActive } from '../client.ts'

export function registerSendCommands(program: Command) {
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
}
