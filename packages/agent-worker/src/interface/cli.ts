#!/usr/bin/env node
/**
 * CLI entry point — Commander-based CLI for agent-worker.
 */

import { Command } from "commander";
import { registerAgentCommands } from "./commands/agent.ts";
import { registerWorkflowCommands } from "./commands/workflow.ts";
import { registerSendCommands } from "./commands/send.ts";
import { registerInfoCommands } from "./commands/info.ts";

const program = new Command();

program
  .name("agent-worker")
  .description("CLI for creating and managing AI agent workers")
  .version("0.13.0");

registerAgentCommands(program);
registerWorkflowCommands(program);
registerSendCommands(program);
registerInfoCommands(program);

program.parse();
