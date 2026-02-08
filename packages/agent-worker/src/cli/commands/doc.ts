import type { Command } from "commander";
import { readFileSync } from "node:fs";

export function registerDocCommands(program: Command) {
  const docCmd = program.command("doc").description("Read/write workflow documents");

  docCmd
    .command("read")
    .description("Read the workflow document")
    .requiredOption("-w, --workflow <name>", "Workflow name")
    .action(async (options) => {
      const dir = await resolveDir(options.workflow);
      const { createFileContextProvider } = await import("@/workflow/context/index.ts");
      const provider = createFileContextProvider(dir, []);
      const content = await provider.readDocument();
      console.log(content || "(empty document)");
    });

  docCmd
    .command("write")
    .description("Write content to the workflow document")
    .requiredOption("-w, --workflow <name>", "Workflow name")
    .option("--content <text>", "Content to write")
    .option("--file <path>", "Read content from file")
    .action(async (options) => {
      let content = options.content;
      if (options.file) {
        content = readFileSync(options.file, "utf-8");
      }
      if (!content) {
        console.error("Provide --content or --file");
        console.error("Example: agent-worker doc write -w my-workflow --content 'Document content'");
        console.error("Or:      agent-worker doc write -w my-workflow --file content.txt");
        process.exit(1);
      }

      const dir = await resolveDir(options.workflow);
      const { createFileContextProvider } = await import("@/workflow/context/index.ts");
      const provider = createFileContextProvider(dir, []);
      await provider.writeDocument(content);
      console.log("Document written");
    });

  docCmd
    .command("append")
    .description("Append content to the workflow document")
    .requiredOption("-w, --workflow <name>", "Workflow name")
    .option("--content <text>", "Content to append (use $'...' for newlines in bash)")
    .option("--file <path>", "Read content from file")
    .action(async (options) => {
      let content = options.content;
      if (options.file) {
        content = readFileSync(options.file, "utf-8");
      }
      if (!content) {
        console.error("Provide --content or --file");
        console.error("Example: agent-worker doc append -w my-workflow --content $'\\nNew line'");
        console.error("Or:      agent-worker doc append -w my-workflow --file content.txt");
        process.exit(1);
      }

      const dir = await resolveDir(options.workflow);
      const { createFileContextProvider } = await import("@/workflow/context/index.ts");
      const provider = createFileContextProvider(dir, []);
      await provider.appendDocument(content);
      console.log("Content appended");
    });
}

async function resolveDir(workflowInput: string): Promise<string> {
  const { getDefaultContextDir } = await import("@/workflow/context/file-provider.ts");
  const { DEFAULT_TAG } = await import("../target.ts");

  // Parse workflow:tag format
  const colonIndex = workflowInput.indexOf(":");
  const workflow = colonIndex === -1 ? workflowInput : workflowInput.slice(0, colonIndex);
  const tag = colonIndex === -1 ? DEFAULT_TAG : workflowInput.slice(colonIndex + 1);

  return getDefaultContextDir(workflow, tag);
}
