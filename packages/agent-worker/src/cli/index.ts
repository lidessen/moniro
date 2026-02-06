#!/usr/bin/env node
import { Command } from 'commander'
import { registerAgentCommands } from './commands/agent.ts'
import { registerSendCommands } from './commands/send.ts'
import { registerToolCommands } from './commands/tool.ts'
import { registerWorkflowCommands } from './commands/workflow.ts'
import { registerApprovalCommands } from './commands/approval.ts'
import { registerInfoCommands } from './commands/info.ts'
import { registerContextCommands } from './commands/context.ts'

const program = new Command()

program
  .name('agent-worker')
  .description('CLI for creating and managing AI agents')
  .version('0.0.1')

registerAgentCommands(program)
registerSendCommands(program)
registerToolCommands(program)
registerWorkflowCommands(program)
registerApprovalCommands(program)
registerInfoCommands(program)
registerContextCommands(program)

program.parse()
