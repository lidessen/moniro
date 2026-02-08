import type { Command } from "commander";
import { join } from "node:path";
import type { ToolInfo } from "@/agent/types.ts";
import type { FeedbackEntry } from "@/agent/tools/feedback.ts";
import { sendRequest, isSessionActive } from "../client.ts";
import { outputJson } from "../output.ts";

export function registerToolCommands(program: Command) {
  const toolCmd = program.command("tool").description("Manage tools");

  toolCmd
    .command("add <name>")
    .description("Add a tool")
    .option("--to <target>", "Target agent")
    .requiredOption("-d, --desc <description>", "Tool description")
    .option("-p, --param <params...>", "Parameters (name:type:description)")
    .option("--needs-approval", "Require approval")
    .action(async (name, options) => {
      const target = options.to;

      if (!isSessionActive(target)) {
        console.error(target ? `Agent not found: ${target}` : "No active agent");
        process.exit(1);
      }

      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const param of options.param ?? []) {
        const [paramName, type, ...descParts] = param.split(":");
        properties[paramName] = {
          type: type ?? "string",
          description: descParts.join(":") ?? "",
        };
        required.push(paramName);
      }

      const payload = {
        name,
        description: options.desc,
        parameters: { type: "object", properties, required },
        needsApproval: options.needsApproval ?? false,
      };

      const res = await sendRequest({ action: "tool_add", payload }, target);
      if (res.success) {
        const approvalNote = options.needsApproval ? " (needs approval)" : "";
        console.log(`Tool added: ${name}${approvalNote}`);
      } else {
        console.error("Error:", res.error);
        process.exit(1);
      }
    });

  toolCmd
    .command("import <file>")
    .description("Import tools from JS/TS file")
    .option("--to <target>", "Target agent")
    .action(async (file, options) => {
      const target = options.to;

      if (!isSessionActive(target)) {
        console.error(target ? `Agent not found: ${target}` : "No active agent");
        process.exit(1);
      }

      // Resolve to absolute path
      const filePath = file.startsWith("/") ? file : join(process.cwd(), file);

      const res = await sendRequest(
        {
          action: "tool_import",
          payload: { filePath },
        },
        target,
      );

      if (res.success) {
        const data = res.data as { imported: string[] };
        console.log(`Imported ${data.imported.length} tool(s):`);
        for (const name of data.imported) {
          console.log(`  ${name}`);
        }
      } else {
        console.error("Error:", res.error);
        process.exit(1);
      }
    });

  toolCmd
    .command("mock <name> <response>")
    .description("Set mock response")
    .option("--to <target>", "Target agent")
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
        console.error('Example: agent-worker tool mock my-tool \'{"result": "success"}\'');
        process.exit(1);
      }
    });

  toolCmd
    .command("list")
    .description("List tools")
    .option("--to <target>", "Target agent")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const target = options.to;

      if (!isSessionActive(target)) {
        console.error(target ? `Agent not found: ${target}` : "No active agent");
        process.exit(1);
      }

      const res = await sendRequest({ action: "tool_list" }, target);
      if (!res.success) {
        console.error("Error:", res.error);
        process.exit(1);
      }

      const tools = res.data as ToolInfo[];

      if (options.json) {
        outputJson(tools);
        return;
      }

      if (tools.length === 0) {
        console.log("No tools");
      } else {
        for (const t of tools) {
          const approval = t.needsApproval ? " [needs approval]" : "";
          console.log(`  ${t.name}${approval} - ${t.description ?? "(no description)"}`);
        }
      }
    });

  // ── Feedback subcommand ────────────────────────────────────────────

  toolCmd
    .command("feedback")
    .description("List feedback collected from agent (requires --feedback on agent)")
    .option("--to <target>", "Target agent")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const target = options.to;

      if (!isSessionActive(target)) {
        console.error(target ? `Agent not found: ${target}` : "No active agent");
        process.exit(1);
      }

      const res = await sendRequest({ action: "feedback_list" }, target);
      if (!res.success) {
        console.error("Error:", res.error);
        process.exit(1);
      }

      const entries = res.data as FeedbackEntry[];

      if (options.json) {
        outputJson(entries);
        return;
      }

      if (entries.length === 0) {
        console.log("No feedback yet");
      } else {
        for (const entry of entries) {
          const icon =
            entry.type === "missing"
              ? "[missing]"
              : entry.type === "friction"
                ? "[friction]"
                : "[suggestion]";
          console.log(`  ${icon} ${entry.target}: ${entry.description}`);
          if (entry.context) {
            console.log(`         context: ${entry.context}`);
          }
        }
      }
    });
}
