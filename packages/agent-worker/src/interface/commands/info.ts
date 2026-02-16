/**
 * Info commands: providers, backends
 */
import type { Command } from "commander";

export function registerInfoCommands(program: Command) {
  // ── providers ──────────────────────────────────────────────────
  program
    .command("providers")
    .description("Check provider availability")
    .action(() => {
      const providers: Record<string, { envVar: string; description: string }> = {
        anthropic: { envVar: "ANTHROPIC_API_KEY", description: "Anthropic Claude" },
        openai: { envVar: "OPENAI_API_KEY", description: "OpenAI GPT" },
        deepseek: { envVar: "DEEPSEEK_API_KEY", description: "DeepSeek" },
        google: { envVar: "GOOGLE_GENERATIVE_AI_API_KEY", description: "Google Gemini" },
        groq: { envVar: "GROQ_API_KEY", description: "Groq" },
        mistral: { envVar: "MISTRAL_API_KEY", description: "Mistral" },
        xai: { envVar: "XAI_API_KEY", description: "xAI Grok" },
      };

      console.log("Provider Status:\n");

      for (const [name, config] of Object.entries(providers)) {
        const configured = !!process.env[config.envVar];
        const status = configured ? "[ok]" : "[  ]";
        const hint = configured ? "" : ` [${config.envVar}]`;
        console.log(`  ${status} ${name.padEnd(10)} - ${config.description}${hint}`);
      }
    });

  // ── backends ───────────────────────────────────────────────────
  program
    .command("backends")
    .description("Check available backends")
    .action(() => {
      const backends = [
        { type: "sdk", name: "Vercel AI SDK", check: true },
        { type: "mock", name: "Mock (testing)", check: true },
        { type: "claude", name: "Claude CLI", check: false },
        { type: "codex", name: "Codex CLI", check: false },
        { type: "cursor", name: "Cursor CLI", check: false },
      ];

      console.log("Backend Status:\n");

      for (const b of backends) {
        const status = b.check ? "[ok]" : "[  ]";
        console.log(`  ${status} ${b.type.padEnd(8)} - ${b.name}`);
      }

      console.log("\nUsage:");
      console.log("  SDK backend:    agent-worker new myagent -m openai/gpt-5.2");
      console.log("  Mock backend:   agent-worker new myagent -b mock");
      console.log("  Claude CLI:     agent-worker new myagent -b claude");
    });
}
