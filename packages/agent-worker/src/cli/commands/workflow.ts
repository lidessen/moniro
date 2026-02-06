import type { Command } from 'commander'
import { spawn } from 'node:child_process'
import { sendRequest } from '../client.ts'
import { isSessionRunning, listSessions } from '../../daemon/index.ts'

export function registerWorkflowCommands(program: Command) {
  // Run workflow
  program
    .command('run <file>')
    .description('Execute workflow and exit when complete')
    .option('--instance <name>', 'Instance name', 'default')
    .option('-v, --verbose', 'Show detailed progress')
    .option('-d, --debug', 'Show debug logs (internal details, no channel output)')
    .option('--json', 'Output results as JSON')
    .action(async (file, options) => {
      const { parseWorkflowFile, runWorkflowWithControllers } = await import('../../workflow/index.ts')

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
      const { parseWorkflowFile, runWorkflowWithControllers } = await import('../../workflow/index.ts')

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
}
