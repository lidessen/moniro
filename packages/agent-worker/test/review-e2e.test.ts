/**
 * E2E test: full review workflow with mock DeepSeek API.
 *
 * Simulates the actual CI flow:
 *   daemon → scheduler → worker subprocess → SDK backend (deepseek)
 *   → generateText with tools → bash/writeFile → /tmp/review-result.json
 *
 * Uses a local HTTP server that speaks the OpenAI chat completions API
 * (DeepSeek is OpenAI-compatible) to avoid needing real API keys.
 */
import { describe, test, expect, afterEach } from "bun:test";
import { startDaemon, type DaemonHandle } from "../src/daemon/index.ts";
import { channelRead, inboxQuery } from "../src/daemon/context.ts";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { createServer, type Server } from "node:http";

/**
 * Create a mock OpenAI-compatible chat completions server.
 * Returns tool calls on first request, final text on second.
 */
function createMockDeepSeekServer(resultPath: string): Promise<{ server: Server; port: number; callLog: string[] }> {
  const callLog: string[] = [];
  let callCount = 0;

  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        callCount++;
        callLog.push(`call-${callCount}`);

        const parsed = JSON.parse(body);
        const messages = parsed.messages ?? [];

        // Check if there are tool results in the messages (means tools were executed)
        const hasToolResults = messages.some(
          (m: any) => m.role === "tool",
        );

        if (!hasToolResults) {
          // First call: return a writeFile tool call
          const reviewJson = JSON.stringify({
            summary: "Clean implementation",
            issues: [],
            highlights: ["Well structured code"],
          });

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            id: "mock-1",
            object: "chat.completion",
            choices: [{
              index: 0,
              message: {
                role: "assistant",
                content: null,
                tool_calls: [{
                  id: "tc_write",
                  type: "function",
                  function: {
                    name: "writeFile",
                    arguments: JSON.stringify({
                      path: resultPath,
                      content: reviewJson,
                    }),
                  },
                }],
              },
              finish_reason: "tool_calls",
            }],
            usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
          }));
        } else {
          // Second call: tools executed, return final text
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            id: "mock-2",
            object: "chat.completion",
            choices: [{
              index: 0,
              message: {
                role: "assistant",
                content: "Review complete. Results written to " + resultPath,
              },
              finish_reason: "stop",
            }],
            usage: { prompt_tokens: 200, completion_tokens: 30, total_tokens: 230 },
          }));
        }
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port, callLog });
    });
  });
}

describe("E2E: review workflow with mock API", () => {
  let daemon: DaemonHandle | null = null;
  let mockServer: Server | null = null;
  const tmpFiles: string[] = [];

  afterEach(async () => {
    if (daemon) {
      await daemon.shutdown();
      daemon = null;
    }
    if (mockServer) {
      mockServer.close();
      mockServer = null;
    }
    for (const f of tmpFiles) {
      try { unlinkSync(f); } catch {}
    }
    tmpFiles.length = 0;
  });

  test("full daemon → worker → SDK → tool call → file written", async () => {
    const resultPath = `/tmp/test-e2e-review-${Date.now()}.json`;
    tmpFiles.push(resultPath);

    // 1. Start mock DeepSeek API server
    const mock = await createMockDeepSeekServer(resultPath);
    mockServer = mock.server;
    const mockBaseUrl = `http://127.0.0.1:${mock.port}/v1`;

    // 2. Start daemon
    daemon = await startDaemon({ inMemory: true, port: 0 });
    const base = `http://${daemon.host}:${daemon.port}`;

    // 3. Create workflow — uses "sdk" backend with deepseek model
    //    Provider config includes our mock server URL
    const kickoff = `@reviewer Review this PR.

## Instructions
1. Write your review to ${resultPath}`;

    const res = await fetch(`${base}/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow: {
          name: "e2e-review",
          agents: {
            reviewer: {
              model: "deepseek:deepseek-chat",
              system_prompt: "You are a code reviewer. Use tools to write results.",
              resolvedSystemPrompt: "You are a code reviewer. Use tools to write results.",
              provider: {
                name: "deepseek",
                api_key: "test-key-not-real",
                base_url: mockBaseUrl,
              },
            },
          },
          kickoff,
        },
        tag: "main",
      }),
    });

    const data = await res.json();
    expect(data.ok).toBe(true);

    // 4. Wait for worker to process (max 30s)
    let completed = false;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));

      const inbox = inboxQuery(daemon.db, "reviewer", "e2e-review", "main");
      const messages = channelRead(daemon.db, "e2e-review", "main", { limit: 10 });

      // Agent completed when inbox is empty and there are > 1 channel messages
      if (inbox.length === 0 && messages.length > 1) {
        completed = true;
        console.log(`[e2e] completed after ${i * 500}ms, channel messages: ${messages.length}`);
        console.log(`[e2e] last message: ${messages[messages.length - 1]!.content.slice(0, 100)}`);
        break;
      }

      // Check for scheduler errors (worker crashed)
      if (i > 0 && i % 10 === 0) {
        console.log(`[e2e] tick ${i}: inbox=${inbox.length}, channel=${messages.length}, mock_calls=${mock.callLog.length}`);
      }
    }

    // 5. Verify results
    console.log(`[e2e] mock API calls: ${mock.callLog.length} (${mock.callLog.join(", ")})`);

    // The mock server should have been called (at least once)
    expect(mock.callLog.length).toBeGreaterThan(0);

    if (completed) {
      // If the worker completed, check if the file was written
      if (existsSync(resultPath)) {
        const review = JSON.parse(readFileSync(resultPath, "utf-8"));
        expect(review.summary).toBe("Clean implementation");
        console.log("[e2e] ✅ review-result.json written successfully");
      } else {
        // File not written — check channel for error info
        const messages = channelRead(daemon.db, "e2e-review", "main", { limit: 10 });
        console.log("[e2e] ❌ review-result.json NOT found. Channel messages:");
        for (const m of messages) {
          console.log(`  [${m.sender}] ${m.content.slice(0, 200)}`);
        }
        expect(existsSync(resultPath)).toBe(true); // Will fail with useful context
      }
    } else {
      // Worker didn't complete — dump diagnostic info
      const messages = channelRead(daemon.db, "e2e-review", "main", { limit: 10 });
      console.log("[e2e] ❌ worker did not complete. Channel messages:");
      for (const m of messages) {
        console.log(`  [${m.sender}] ${m.content.slice(0, 200)}`);
      }
      expect(completed).toBe(true); // Will fail with useful context
    }
  }, 35_000);
});
