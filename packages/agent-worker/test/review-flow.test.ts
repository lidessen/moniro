/**
 * Integration test: verify the review workflow's critical path works.
 *
 * Tests:
 * 1. Long kickoff messages are NOT auto-resourced (truncated)
 * 2. Local tools (bash, readFile, writeFile) actually execute
 * 3. generateText() with local tools → tool calls execute and produce files
 */
import { describe, test, expect, afterEach } from "bun:test";
import { startDaemon, type DaemonHandle } from "../src/daemon/index.ts";
import { channelRead } from "../src/daemon/context.ts";
import { createLocalTools } from "../src/worker/local-tools.ts";
import { generateText, stepCountIs } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { existsSync, unlinkSync, readFileSync, writeFileSync } from "node:fs";

/** Shorthand for tool execute context */
const ctx = { toolCallId: "test", messages: [] as never[], abortSignal: new AbortController().signal };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helpers for V3 mock results
function toolCallResult(toolCallId: string, toolName: string, input: object): any {
  return {
    content: [{ type: "tool-call", toolCallId, toolName, input: JSON.stringify(input) }],
    usage: { inputTokens: 100, outputTokens: 50 },
    finishReason: "tool-calls",
    providerMetadata: {},
    warnings: [],
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helpers for V3 mock results
function textResult(text: string): any {
  return {
    content: [{ type: "text", text }],
    usage: { inputTokens: 200, outputTokens: 30 },
    finishReason: "stop",
    providerMetadata: {},
    warnings: [],
  };
}

describe("review workflow critical path", () => {
  let daemon: DaemonHandle | null = null;
  const tmpFiles: string[] = [];

  afterEach(async () => {
    if (daemon) {
      await daemon.shutdown();
      daemon = null;
    }
    for (const f of tmpFiles) {
      try { unlinkSync(f); } catch {}
    }
    tmpFiles.length = 0;
  });

  // ── 1. Kickoff delivery ──────────────────────────────────────

  test("long kickoff (>1200 chars) is delivered in full, not auto-resourced", async () => {
    daemon = await startDaemon({ inMemory: true, port: 0 });
    const base = `http://${daemon.host}:${daemon.port}`;

    // Build a kickoff > 1200 chars (mimics the real review workflow)
    const longKickoff = [
      "@reviewer Review PR #42 in test/repo.",
      "",
      "## Review Type: initial",
      "",
      "## Changed Files",
      "```",
      ...Array.from({ length: 20 }, (_, i) => `src/components/Component${i}.tsx`),
      "```",
      "",
      "## Instructions",
      "",
      "1. Read the PR metadata:",
      "   ```bash",
      "   cat /tmp/pr-info.json | jq .",
      "   ```",
      "",
      "2. Read the diff to review:",
      "   ```bash",
      "   cat /tmp/review-diff.txt",
      "   ```",
      "",
      "3. Write your analysis as JSON to `/tmp/review-result.json`:",
      "   ```bash",
      '   cat > /tmp/review-result.json << \'REVIEW_EOF\'',
      "   {",
      '     "summary": "Brief overview",',
      '     "issues": [],',
      '     "highlights": ["Good stuff"]',
      "   }",
      "   REVIEW_EOF",
      "   ```",
      "",
      "Severity guide:",
      "- **error**: bugs, security issues, broken logic",
      "- **warning**: potential problems, bad patterns",
      "- **suggestion**: style improvements, readability",
      "",
      "Rules:",
      "- If no issues found, use `\"issues\": []`",
      "- Always include file paths and line numbers",
      "- Be specific and actionable",
      "- The JSON must be valid",
    ].join("\n");

    expect(longKickoff.length).toBeGreaterThan(1200);

    const res = await fetch(`${base}/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow: {
          name: "review-test",
          agents: {
            reviewer: { model: "mock", backend: "mock" },
          },
          kickoff: longKickoff,
        },
        tag: "main",
      }),
    });

    const data = await res.json();
    expect(data.ok).toBe(true);

    // Give scheduler a moment to run
    await new Promise((r) => setTimeout(r, 200));

    // Read channel — kickoff should be the first message
    const messages = channelRead(daemon.db, "review-test", "main", { limit: 10 });
    const kickoffMsg = messages.find((m) => m.sender === "system");
    expect(kickoffMsg).toBeDefined();

    // CRITICAL: must NOT be truncated to a resource reference
    expect(kickoffMsg!.content).not.toContain("[Resource ");
    expect(kickoffMsg!.content).toContain("cat /tmp/review-diff.txt");
    expect(kickoffMsg!.content).toContain("/tmp/review-result.json");
    expect(kickoffMsg!.content.length).toBeGreaterThan(1200);
  }, 10_000);

  test("short kickoff still works normally", async () => {
    daemon = await startDaemon({ inMemory: true, port: 0 });
    const base = `http://${daemon.host}:${daemon.port}`;

    const res = await fetch(`${base}/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow: {
          name: "short-test",
          agents: {
            bot: { model: "mock", backend: "mock" },
          },
          kickoff: "@bot do something simple",
        },
        tag: "main",
      }),
    });

    expect((await res.json()).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 200));

    const messages = channelRead(daemon.db, "short-test", "main", { limit: 10 });
    const kickoffMsg = messages.find((m) => m.sender === "system");
    expect(kickoffMsg!.content).toBe("@bot do something simple");
  }, 10_000);

  // ── 2. Local tools ──────────────────────────────────────────

  test("bash tool executes commands", async () => {
    const tools = createLocalTools();
    const result = await tools.bash.execute!({ command: "echo hello-world" }, ctx) as { stdout: string; stderr: string; exitCode: number };
    expect(result).toEqual({ stdout: "hello-world\n", stderr: "", exitCode: 0 });
  });

  test("bash tool returns error for failing commands", async () => {
    const tools = createLocalTools();
    const result = await tools.bash.execute!({ command: "exit 42" }, ctx) as { stdout: string; stderr: string; exitCode: number };
    expect(result.exitCode).toBe(42);
  });

  test("readFile tool reads files", async () => {
    const tools = createLocalTools();
    const tmpPath = `/tmp/test-local-tools-read-${Date.now()}.txt`;
    tmpFiles.push(tmpPath);
    writeFileSync(tmpPath, "test content here", "utf-8");

    const result = await tools.readFile.execute!({ path: tmpPath }, ctx) as { content: string; error: null };
    expect(result).toEqual({ content: "test content here", error: null });
  });

  test("readFile tool returns error for missing files", async () => {
    const tools = createLocalTools();
    const result = await tools.readFile.execute!({ path: "/tmp/nonexistent-file-xyz-123" }, ctx) as { content: null; error: string };
    expect(result.content).toBeNull();
    expect(result.error).toBeDefined();
  });

  test("writeFile tool creates files with parent dirs", async () => {
    const tools = createLocalTools();
    const tmpPath = `/tmp/test-local-tools-write-${Date.now()}/nested/result.json`;
    tmpFiles.push(tmpPath);

    const result = await tools.writeFile.execute!(
      { path: tmpPath, content: '{"summary":"test"}' },
      ctx,
    ) as { written: boolean; path: string; bytes: number };
    expect(result.written).toBe(true);
    expect(existsSync(tmpPath)).toBe(true);
  });

  // ── 3. generateText + tools integration ──────────────────────
  // This is the REAL test: does generateText() with local tools
  // actually execute tool calls and produce files?

  test("generateText with mock LLM calls writeFile tool → file appears on disk", async () => {
    const resultPath = `/tmp/test-generatetext-review-${Date.now()}.json`;
    tmpFiles.push(resultPath);

    const reviewJson = JSON.stringify({
      summary: "All good",
      issues: [],
      highlights: ["Clean code"],
    });

    const tools = createLocalTools();

    // Mock LLM: first call returns a writeFile tool call, second returns text
    let callCount = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        callCount++;
        if (callCount === 1) {
          return toolCallResult("tc_1", "writeFile", { path: resultPath, content: reviewJson });
        }
        return textResult("Review complete. Written to " + resultPath);
      },
    });

    const result = await generateText({
      model,
      prompt: "Review this PR and write results to a file",
      tools,
      stopWhen: stepCountIs(5),
    });

    // The tool should have been executed, creating the file
    expect(existsSync(resultPath)).toBe(true);
    const written = readFileSync(resultPath, "utf-8");
    expect(JSON.parse(written)).toEqual({
      summary: "All good",
      issues: [],
      highlights: ["Clean code"],
    });

    // Result should contain the final text
    expect(result.text).toContain("Review complete");

    // Tool calls should be tracked in steps
    const allToolCalls = result.steps.flatMap(
      (s) => (s.toolCalls ?? []).map((tc) => tc.toolName),
    );
    expect(allToolCalls).toContain("writeFile");
  });

  test("generateText with mock LLM calls bash tool → command executes", async () => {
    const resultPath = `/tmp/test-generatetext-bash-${Date.now()}.txt`;
    tmpFiles.push(resultPath);

    const tools = createLocalTools();

    let callCount = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        callCount++;
        if (callCount === 1) {
          return toolCallResult("tc_1", "bash", { command: `echo "hello from bash" > ${resultPath}` });
        }
        return textResult("Done.");
      },
    });

    const result = await generateText({
      model,
      prompt: "Write hello to a file using bash",
      tools,
      stopWhen: stepCountIs(5),
    });

    expect(existsSync(resultPath)).toBe(true);
    expect(readFileSync(resultPath, "utf-8").trim()).toBe("hello from bash");
    expect(result.text).toBe("Done.");
  });

  test("generateText with multi-step tool flow (read → process → write)", async () => {
    const infoPath = `/tmp/test-gt-prinfo-${Date.now()}.json`;
    const resultPath = `/tmp/test-gt-result-${Date.now()}.json`;
    tmpFiles.push(infoPath, resultPath);

    writeFileSync(infoPath, JSON.stringify({ title: "Add auth", additions: 50 }));

    const tools = createLocalTools();

    let callCount = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        callCount++;
        if (callCount === 1) {
          return toolCallResult("tc_read", "readFile", { path: infoPath });
        }
        if (callCount === 2) {
          return toolCallResult("tc_write", "writeFile", {
            path: resultPath,
            content: JSON.stringify({
              summary: "Auth feature looks good",
              issues: [{ severity: "warning", file: "auth.ts", line: 10, message: "Missing rate limiting" }],
              highlights: ["Good test coverage"],
            }),
          });
        }
        return textResult("Review written to " + resultPath);
      },
    });

    const result = await generateText({
      model,
      prompt: "Review this PR",
      tools,
      stopWhen: stepCountIs(10),
    });

    // Verify file was written with correct content
    expect(existsSync(resultPath)).toBe(true);
    const review = JSON.parse(readFileSync(resultPath, "utf-8"));
    expect(review.summary).toBe("Auth feature looks good");
    expect(review.issues).toHaveLength(1);
    expect(review.issues[0].severity).toBe("warning");

    // Verify multi-step execution
    expect(result.steps.length).toBe(3);
    const toolNames = result.steps.flatMap(
      (s) => (s.toolCalls ?? []).map((tc) => tc.toolName),
    );
    expect(toolNames).toEqual(["readFile", "writeFile"]);
  });
});
