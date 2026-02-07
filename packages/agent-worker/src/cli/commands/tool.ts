import type { Command } from 'commander'
import { join } from 'node:path'
import type { ToolDefinition } from '../../agent/types.ts'
import { sendRequest, isSessionActive } from '../client.ts'

export function registerToolCommands(program: Command) {
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
}
