import type { Command } from "commander";
import { readFileSync } from "node:fs";

export function registerDocCommands(program: Command) {
  const docCmd = program.command("doc").description("Read/write workflow documents");

  docCmd
    .command("read <target>")
    .description("Read the workflow document")
    .addHelpText(
      "after",
      `
Examples:
  $ agent-worker doc read @review            # Read @review:main document
  $ agent-worker doc read @review:pr-123     # Read specific workflow:tag document
    `,
    )
    .action(async (targetInput: string) => {
      const dir = await resolveDir(targetInput);
      const { createFileContextProvider } = await import("@/workflow/context/index.ts");
      const provider = createFileContextProvider(dir, []);
      const content = await provider.readDocument();
      console.log(content || "(empty document)");
    });

  docCmd
    .command("write <target>")
    .description("Write content to the workflow document")
    .option("--content <text>", "Content to write")
    .option("--file <path>", "Read content from file")
    .addHelpText(
      "after",
      `
Examples:
  $ agent-worker doc write @review --content "Document content"
  $ agent-worker doc write @review:pr-123 --file content.txt
    `,
    )
    .action(async (targetInput: string, options) => {
      let content = options.content;
      if (options.file) {
        content = readFileSync(options.file, "utf-8");
      }
      if (!content) {
        console.error("Provide --content or --file");
        console.error("Example: agent-worker doc write @review --content 'Document content'");
        console.error("Or:      agent-worker doc write @review --file content.txt");
        process.exit(1);
      }

      const dir = await resolveDir(targetInput);
      const { createFileContextProvider } = await import("@/workflow/context/index.ts");
      const provider = createFileContextProvider(dir, []);
      await provider.writeDocument(content);
      console.log("Document written");
    });

  docCmd
    .command("append <target>")
    .description("Append content to the workflow document")
    .option("--content <text>", "Content to append (use $'...' for newlines in bash)")
    .option("--file <path>", "Read content from file")
    .addHelpText(
      "after",
      `
Examples:
  $ agent-worker doc append @review --content $'\\nNew line'
  $ agent-worker doc append @review:pr-123 --file content.txt
    `,
    )
    .action(async (targetInput: string, options) => {
      let content = options.content;
      if (options.file) {
        content = readFileSync(options.file, "utf-8");
      }
      if (!content) {
        console.error("Provide --content or --file");
        console.error("Example: agent-worker doc append @review --content $'\\nNew line'");
        console.error("Or:      agent-worker doc append @review --file content.txt");
        process.exit(1);
      }

      const dir = await resolveDir(targetInput);
      const { createFileContextProvider } = await import("@/workflow/context/index.ts");
      const provider = createFileContextProvider(dir, []);
      await provider.appendDocument(content);
      console.log("Content appended");
    });
}

async function resolveDir(targetInput: string): Promise<string> {
  const { getDefaultContextDir } = await import("@/workflow/context/file-provider.ts");
  const { parseTarget } = await import("../target.ts");

  // Parse target identifier (should be @workflow:tag format)
  const target = parseTarget(targetInput);

  return getDefaultContextDir(target.workflow, target.tag);
}
