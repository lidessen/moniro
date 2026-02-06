import type { Command } from 'commander'
import { readFileSync } from 'node:fs'

export function registerContextCommands(program: Command) {
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
      const { createFileContextProvider } = await import('../../context/index.ts')

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
      const { createFileContextProvider } = await import('../../context/index.ts')

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
      const { createFileContextProvider } = await import('../../context/index.ts')

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
      const { createFileContextProvider } = await import('../../context/index.ts')

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
      const { createFileContextProvider } = await import('../../context/index.ts')

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
      const { createFileContextProvider } = await import('../../context/index.ts')

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
      const { createFileContextProvider } = await import('../../context/index.ts')

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
}
