/**
 * Tests for the /mcp JSON-RPC tool dispatch endpoint.
 *
 * Verifies agent identity flows correctly from query param
 * through tool dispatch to context operations.
 */
import { describe, test, expect, afterEach } from "bun:test";
import { startDaemon, type DaemonHandle } from "../src/daemon/index.ts";
import { TOOLS } from "../src/shared/constants.ts";

describe("tool dispatch via /mcp", () => {
  let daemon: DaemonHandle | null = null;

  afterEach(async () => {
    if (daemon) {
      await daemon.shutdown();
      daemon = null;
    }
  });

  async function setup() {
    daemon = await startDaemon({ inMemory: true, port: 0 });
    const base = `http://${daemon.host}:${daemon.port}`;

    // Create workflow with agents
    await fetch(`${base}/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow: {
          name: "test",
          agents: {
            alice: { model: "mock", backend: "mock" },
            bob: { model: "mock", backend: "mock" },
          },
          kickoff: "@alice @bob start working",
        },
        tag: "main",
      }),
    });

    return base;
  }

  /** Send a JSON-RPC tool call as a specific agent */
  async function mcpCall(
    base: string,
    agent: string,
    tool: string,
    args: Record<string, unknown> = {},
  ) {
    const res = await fetch(`${base}/mcp?agent=${agent}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: tool, arguments: args },
      }),
    });
    return res.json();
  }

  test("rejects missing agent param", async () => {
    const base = await setup();

    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: TOOLS.MY_INBOX },
      }),
    });

    expect(res.status).toBe(400);
  });

  test("channel_send and channel_read", async () => {
    const base = await setup();

    // Alice sends a message
    const sendRes = await mcpCall(base, "alice", TOOLS.CHANNEL_SEND, {
      message: "Hello @bob, please help",
    });
    expect(sendRes.result.content[0].text).toContain('"sent":true');

    const parsed = JSON.parse(sendRes.result.content[0].text);
    expect(parsed.recipients).toContain("bob");

    // Bob reads channel
    const readRes = await mcpCall(base, "bob", TOOLS.CHANNEL_READ, {});
    const messages = JSON.parse(readRes.result.content[0].text);
    // Should include at least the kickoff + alice's message
    expect(messages.length).toBeGreaterThanOrEqual(2);
  });

  test("my_inbox returns unread mentions", async () => {
    const base = await setup();

    // Alice sends a message mentioning bob
    await mcpCall(base, "alice", TOOLS.CHANNEL_SEND, {
      message: "@bob please review",
    });

    // Bob checks inbox
    const inboxRes = await mcpCall(base, "bob", TOOLS.MY_INBOX, {});
    const inbox = JSON.parse(inboxRes.result.content[0].text);
    // Should include kickoff + alice's message
    expect(inbox.length).toBeGreaterThanOrEqual(1);
    expect(inbox.some((m: { sender: string }) => m.sender === "alice")).toBe(true);
  });

  test("my_inbox_ack clears inbox", async () => {
    const base = await setup();

    // Send a message mentioning bob
    await mcpCall(base, "alice", TOOLS.CHANNEL_SEND, { message: "@bob task" });

    // Bob acks all
    await mcpCall(base, "bob", TOOLS.MY_INBOX_ACK, {});

    // Bob's inbox should be empty
    const inboxRes = await mcpCall(base, "bob", TOOLS.MY_INBOX, {});
    const inbox = JSON.parse(inboxRes.result.content[0].text);
    expect(inbox).toHaveLength(0);
  });

  test("team_members lists agents", async () => {
    const base = await setup();

    const res = await mcpCall(base, "alice", TOOLS.TEAM_MEMBERS, {});
    const members = JSON.parse(res.result.content[0].text);
    expect(members).toHaveLength(2);
    expect(members.map((m: { name: string }) => m.name).sort()).toEqual(["alice", "bob"]);
  });

  test("resource_create and resource_read", async () => {
    const base = await setup();

    // Create resource
    const createRes = await mcpCall(base, "alice", TOOLS.RESOURCE_CREATE, {
      content: "Large content goes here",
      type: "text",
    });
    const { id } = JSON.parse(createRes.result.content[0].text);
    expect(id).toMatch(/^res_/);

    // Read resource
    const readRes = await mcpCall(base, "bob", TOOLS.RESOURCE_READ, { id });
    const resource = JSON.parse(readRes.result.content[0].text);
    expect(resource.content).toBe("Large content goes here");
    expect(resource.createdBy).toBe("alice");
  });

  test("unknown tool returns error", async () => {
    const base = await setup();

    const res = await mcpCall(base, "alice", "nonexistent_tool", {});
    const result = JSON.parse(res.result.content[0].text);
    expect(result.error).toContain("Unknown tool");
  });

  test("unsupported method returns error", async () => {
    const base = await setup();

    const res = await fetch(`${base}/mcp?agent=alice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/list",
      }),
    });

    const body = await res.json();
    expect(body.error.message).toContain("not supported");
  });
});
