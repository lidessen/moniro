import type { Command } from "commander";
import { sendRequest, isSessionActive } from "../client.ts";

export function registerMockCommands(program: Command) {
  const mockCmd = program.command("mock").description("Mock responses for testing");

  mockCmd
    .command("tool <name> <response>")
    .description("Set mock response for a tool")
    .option("--to <target>", "Target agent")
    .addHelpText('after', `
Examples:
  $ agent-worker mock tool get_weather '{"temp": 72, "condition": "sunny"}'
  $ agent-worker mock tool read_file '{"content": "Hello World"}' --to alice
    `)
    .action(async (name, response, options) => {
      const target = options.to;

      if (!isSessionActive(target)) {
        console.error(target ? `Agent not found: ${target}` : "No active agent");
        process.exit(1);
      }

      try {
        const parsed = JSON.parse(response);
        const res = await sendRequest(
          {
            action: "tool_mock",
            payload: { name, response: parsed },
          },
          target,
        );

        if (res.success) {
          console.log(`Mock set for: ${name}`);
        } else {
          console.error("Error:", res.error);
          process.exit(1);
        }
      } catch {
        console.error("Invalid JSON response. The response parameter must be valid JSON.");
        console.error('Example: agent-worker mock tool my-tool \'{"result": "success"}\'');
        process.exit(1);
      }
    });
}
