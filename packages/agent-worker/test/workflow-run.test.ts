/**
 * Integration test: workflow run with mock backend.
 * Tests the full path: daemon → scheduler → worker → completion.
 */
import { describe, test, expect, afterEach } from "bun:test";
import { startDaemon, type DaemonHandle } from "../src/daemon/index.ts";
import { channelRead, inboxQuery } from "../src/daemon/context.ts";

describe("workflow run integration", () => {
  let daemon: DaemonHandle | null = null;

  afterEach(async () => {
    if (daemon) {
      await daemon.shutdown();
      daemon = null;
    }
  });

  test("scheduler processes inbox after kickoff", async () => {
    daemon = await startDaemon({ inMemory: true, port: 0 });
    const base = `http://${daemon.host}:${daemon.port}`;

    // Create workflow
    const res = await fetch(`${base}/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow: {
          name: "test-run",
          agents: {
            bot: { model: "mock", backend: "mock" },
          },
          kickoff: "@bot do something",
        },
        tag: "main",
      }),
    });

    const data = await res.json();
    expect(data.ok).toBe(true);
    console.log("[test] workflow created:", data);

    // Check inbox exists
    const inbox = inboxQuery(daemon.db, "bot", "test-run", "main");
    console.log("[test] inbox for bot:", inbox.length, "messages");

    // Wait for scheduler to process (max 15s)
    let processed = false;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500));

      const currentInbox = inboxQuery(daemon.db, "bot", "test-run", "main");
      const messages = channelRead(daemon.db, "test-run", "main", { limit: 10 });
      console.log(`[test] tick ${i}: inbox=${currentInbox.length}, channel=${messages.length}`);

      // Worker success = inbox cleared + bot's response in channel
      if (currentInbox.length === 0 && messages.length > 1) {
        processed = true;
        console.log("[test] bot responded:", messages[messages.length - 1]!.content.slice(0, 100));
        break;
      }
    }

    expect(processed).toBe(true);
  }, 20_000);
});
