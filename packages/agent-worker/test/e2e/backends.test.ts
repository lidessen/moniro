/**
 * E2E Backend Tests — Real API calls against actual CLI backends
 *
 * Prerequisites:
 *   - Run `scripts/e2e-setup.sh` to install CLIs
 *   - Set env vars:
 *     DEEPSEEK_API_KEY     — for Claude Code (via DeepSeek) and OpenCode
 *     AI_GATEWAY_API_KEY   — for Codex CLI via Vercel AI Gateway (Gemini 2.0 Flash)
 *     CURSOR_API_KEY       — for Cursor Agent (requires paid subscription)
 *     MINIMAX_API_KEY      — for MiniMax (SDK via Anthropic provider + custom endpoint)
 *     GLM_API_KEY          — for GLM/Zhipu (SDK via Anthropic provider + custom endpoint)
 *
 * Usage:
 *   # Run all E2E tests
 *   bun test test/e2e/
 *
 *   # Run specific backend
 *   bun test test/e2e/ -t "OpenCode"
 *
 * Notes:
 *   - Claude Code E2E may hang when run from within a claude session.
 *     Set SKIP_CLAUDE_E2E=1 to skip it.
 *   - Codex uses Vercel AI Gateway (Responses API) with google/gemini-2.0-flash.
 *     Config is written to ~/.codex/config.toml automatically.
 *   - Cursor uses composer-1 model. Requires paid subscription + API key.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { ClaudeCodeBackend } from "../../src/backends/claude-code.ts";
import { CodexBackend } from "../../src/backends/codex.ts";
import { CursorBackend } from "../../src/backends/cursor.ts";
import { OpenCodeBackend } from "../../src/backends/opencode.ts";
import { SdkBackend } from "../../src/backends/sdk.ts";

// Generous timeout for real API calls (2 minutes)
const E2E_TIMEOUT = 120_000;

// Simple math prompt that produces a deterministic short answer
const PROMPT = "What is 2+2? Reply with ONLY the number, nothing else.";

// ─── Helpers ─────────────────────────────────────────────────

function cliAvailable(cmd: string): boolean {
  try {
    Bun.spawnSync([cmd, "--version"], { stdin: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function makeTmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `e2e-${prefix}-`));
}

// ─── Claude Code (via DeepSeek) ──────────────────────────────

const hasClaudeCli = cliAvailable("claude");
const hasDeepSeekKey = !!process.env.DEEPSEEK_API_KEY;
// Skip when explicitly requested or when running inside a Claude session (nested invocation fails)
const skipClaudeE2E = !!process.env.SKIP_CLAUDE_E2E || !!process.env.CLAUDECODE;

describe.skipIf(!hasClaudeCli || !hasDeepSeekKey || skipClaudeE2E)(
  "E2E: Claude Code (DeepSeek)",
  () => {
    let savedEnv: Record<string, string | undefined>;
    let tmpDir: string;

    beforeAll(() => {
      // Save env and configure DeepSeek backend
      savedEnv = {
        ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
        ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:
          process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC,
        DISABLE_AUTOUPDATER: process.env.DISABLE_AUTOUPDATER,
      };

      process.env.ANTHROPIC_BASE_URL = "https://api.deepseek.com/anthropic";
      process.env.ANTHROPIC_AUTH_TOKEN = process.env.DEEPSEEK_API_KEY;
      process.env.ANTHROPIC_API_KEY = "";
      process.env.ANTHROPIC_MODEL = "deepseek-chat";
      process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
      process.env.DISABLE_AUTOUPDATER = "1";

      // Use temp dir as workspace to avoid CLAUDE.md triggering agent operations
      tmpDir = makeTmpDir("claude");
    });

    afterAll(() => {
      // Restore env
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch { /* ignore */ }
    });

    test(
      "sends prompt and receives response",
      async () => {
        const backend = new ClaudeCodeBackend({
          outputFormat: "text",
          cwd: tmpDir,
          appendSystemPrompt:
            "You are a simple calculator. Reply with ONLY the number. No explanation. No tools.",
          timeout: E2E_TIMEOUT,
        });

        const result = await backend.send(PROMPT);
        expect(result.content).toBeDefined();
        expect(result.content.length).toBeGreaterThan(0);
        // Response should contain "4" somewhere
        expect(result.content).toContain("4");
      },
      E2E_TIMEOUT,
    );
  },
);

// ─── OpenCode (via DeepSeek) ─────────────────────────────────

const hasOpenCode = cliAvailable("opencode");

describe.skipIf(!hasOpenCode || !hasDeepSeekKey)(
  "E2E: OpenCode (DeepSeek)",
  () => {
    let tmpDir: string;

    beforeAll(() => {
      tmpDir = makeTmpDir("opencode");
    });

    afterAll(() => {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch { /* ignore */ }
    });

    test(
      "sends prompt and receives response",
      async () => {
        const backend = new OpenCodeBackend({
          model: "deepseek/deepseek-chat",
          cwd: tmpDir,
          timeout: E2E_TIMEOUT,
        });

        const result = await backend.send(PROMPT);
        expect(result.content).toBeDefined();
        expect(result.content.length).toBeGreaterThan(0);
        expect(result.content).toContain("4");
      },
      E2E_TIMEOUT,
    );
  },
);

// ─── Codex CLI (Vercel AI Gateway + Gemini 2.0 Flash) ───────

const hasCodex = cliAvailable("codex");
const hasGatewayKey = !!process.env.AI_GATEWAY_API_KEY;
const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
// Codex v0.98.0 always hits api.openai.com for model listing and /responses,
// even when a custom model_provider is configured. OPENAI_API_KEY is required.
const hasCodexAuth = hasOpenAIKey;

// Codex model: Vercel Gateway uses google/gemini-2.0-flash, OpenAI uses default
const CODEX_MODEL = hasGatewayKey ? "google/gemini-2.0-flash" : undefined;

describe.skipIf(!hasCodex || !hasCodexAuth)(
  "E2E: Codex CLI",
  () => {
    let tmpDir: string;
    let savedConfig: string | null = null;
    const codexConfigPath = join(homedir(), ".codex", "config.toml");

    beforeAll(() => {
      tmpDir = makeTmpDir("codex");

      // If using Vercel AI Gateway, write codex config with vercel provider
      if (hasGatewayKey) {
        // Back up existing config
        if (existsSync(codexConfigPath)) {
          savedConfig = readFileSync(codexConfigPath, "utf-8");
        }

        const codexDir = join(homedir(), ".codex");
        if (!existsSync(codexDir)) mkdirSync(codexDir, { recursive: true });

        writeFileSync(
          codexConfigPath,
          [
            'model = "google/gemini-2.0-flash"',
            'model_provider = "vercel"',
            "",
            "[model_providers.vercel]",
            'name = "Vercel AI Gateway"',
            'base_url = "https://ai-gateway.vercel.sh/v1"',
            'env_key = "AI_GATEWAY_API_KEY"',
            'wire_api = "responses"',
            "",
          ].join("\n"),
        );
      }
    });

    afterAll(() => {
      // Restore original codex config
      if (savedConfig !== null) {
        writeFileSync(codexConfigPath, savedConfig);
      } else if (hasGatewayKey) {
        // Remove config we created if there was no original
        try { rmSync(codexConfigPath); } catch { /* ignore */ }
      }
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch { /* ignore */ }
    });

    test(
      "sends prompt and receives response",
      async () => {
        const backend = new CodexBackend({
          model: CODEX_MODEL,
          cwd: tmpDir,
          timeout: E2E_TIMEOUT,
        });

        const result = await backend.send(PROMPT);
        expect(result.content).toBeDefined();
        expect(result.content.length).toBeGreaterThan(0);
        expect(result.content).toContain("4");
      },
      E2E_TIMEOUT,
    );
  },
);

// ─── Cursor Agent ────────────────────────────────────────────

const hasCursor = cliAvailable("cursor") || cliAvailable("agent");
const hasCursorKey = !!process.env.CURSOR_API_KEY;

describe.skipIf(!hasCursor || !hasCursorKey)(
  "E2E: Cursor Agent",
  () => {
    let tmpDir: string;

    beforeAll(() => {
      tmpDir = makeTmpDir("cursor");
    });

    afterAll(() => {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch { /* ignore */ }
    });

    test(
      "sends prompt and receives response (composer-1)",
      async () => {
        const backend = new CursorBackend({
          model: "composer-1",
          cwd: tmpDir,
          timeout: E2E_TIMEOUT,
        });

        const result = await backend.send(PROMPT);
        expect(result.content).toBeDefined();
        expect(result.content.length).toBeGreaterThan(0);
        expect(result.content).toContain("4");
      },
      E2E_TIMEOUT,
    );
  },
);

// ─── MiniMax (SDK via Anthropic provider + custom endpoint) ──

const hasMiniMaxKey = !!process.env.MINIMAX_API_KEY;

describe.skipIf(!hasMiniMaxKey)(
  "E2E: MiniMax (SDK, provider config)",
  () => {
    test(
      "sends prompt and receives response (MiniMax-M2.5)",
      async () => {
        const backend = new SdkBackend({
          model: "MiniMax-M2.5",
          provider: {
            name: "anthropic",
            base_url: "https://api.minimax.io/anthropic/v1",
            api_key: "$MINIMAX_API_KEY",
          },
        });

        try {
          const result = await backend.send(PROMPT);
          expect(result.content).toBeDefined();
          expect(result.content.length).toBeGreaterThan(0);
          expect(result.content).toContain("4");
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("authentication") || msg.includes("invalid api key") || msg.includes("401")) {
            console.warn("MiniMax API key is set but invalid/expired — skipping");
            return; // treat as skip, not failure
          }
          throw e;
        }
      },
      E2E_TIMEOUT,
    );
  },
);

// ─── GLM / Zhipu (SDK via Anthropic provider + custom endpoint)

const hasGlmKey = !!process.env.GLM_API_KEY;

describe.skipIf(!hasGlmKey)(
  "E2E: GLM (SDK, provider config)",
  () => {
    test(
      "sends prompt and receives response (glm-4.7)",
      async () => {
        const backend = new SdkBackend({
          model: "glm-4.7",
          provider: {
            name: "anthropic",
            base_url: "https://open.bigmodel.cn/api/anthropic/v1",
            api_key: "$GLM_API_KEY",
          },
        });

        try {
          const result = await backend.send(PROMPT);
          expect(result.content).toBeDefined();
          expect(result.content.length).toBeGreaterThan(0);
          expect(result.content).toContain("4");
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("authentication") || msg.includes("invalid api key") || msg.includes("401")) {
            console.warn("GLM API key is set but invalid/expired — skipping");
            return;
          }
          throw e;
        }
      },
      E2E_TIMEOUT,
    );
  },
);

// ─── Availability Summary ────────────────────────────────────

describe("E2E: Backend Availability", () => {
  test("reports which backends are testable", () => {
    const status = {
      "Claude Code CLI": hasClaudeCli ? "installed" : "missing",
      "Codex CLI": hasCodex ? "installed" : "missing",
      "Cursor Agent": hasCursor ? "installed" : "missing",
      "OpenCode CLI": hasOpenCode ? "installed" : "missing",
      DEEPSEEK_API_KEY: hasDeepSeekKey ? "set" : "not set",
      AI_GATEWAY_API_KEY: hasGatewayKey ? "set" : "not set",
      OPENAI_API_KEY: hasOpenAIKey ? "set" : "not set",
      CURSOR_API_KEY: hasCursorKey ? "set" : "not set",
      MINIMAX_API_KEY: hasMiniMaxKey ? "set" : "not set",
      GLM_API_KEY: hasGlmKey ? "set" : "not set",
      CLAUDECODE: !!process.env.CLAUDECODE ? "yes (nested session)" : "no",
      SKIP_CLAUDE_E2E: skipClaudeE2E ? "yes (skipped)" : "no",
      "Codex model": CODEX_MODEL ?? "(OpenAI default)",
      "Codex auth": hasCodexAuth ? "OPENAI_API_KEY set" : "missing OPENAI_API_KEY",
      "Cursor model": "composer-1",
      "MiniMax model": "MiniMax-M2.5",
      "GLM model": "glm-4.7",
    };

    console.log("\n=== E2E Backend Availability ===");
    for (const [name, value] of Object.entries(status)) {
      const icon = value === "installed" || value === "set" ? "+" : "-";
      console.log(`  [${icon}] ${name}: ${value}`);
    }
    console.log("");

    // This test always passes — it's just informational
    expect(true).toBe(true);
  });
});
