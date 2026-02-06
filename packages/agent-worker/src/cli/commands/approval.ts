import type { Command } from 'commander'
import { sendRequest, isSessionActive } from '../client.ts'

export function registerApprovalCommands(program: Command) {
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
}
