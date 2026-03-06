import { describe, test, expect, beforeEach } from "bun:test";

import {
  MemoryContextProvider,
  extractMentions,
} from "@moniro/workspace";
import { ChannelBridge } from "../src/context/bridge.ts";
import type { Message } from "@moniro/workspace";
import { DefaultChannelStore } from "../src/context/stores/channel.ts";
import { MemoryStorage } from "../src/context/storage.ts";

// ==================== Helper ====================

function createTestStore(validAgents: string[] = ["alice", "bob"]): DefaultChannelStore {
  const storage = new MemoryStorage();
  return new DefaultChannelStore(storage, validAgents);
}

// ==================== EventEmitter on ChannelStore ====================

describe("DefaultChannelStore EventEmitter", () => {
  test("emits message on append", async () => {
    const store = createTestStore();
    const received: Message[] = [];
    store.on("message", (msg) => received.push(msg));

    await store.append("alice", "hello");

    expect(received).toHaveLength(1);
    expect(received[0].from).toBe("alice");
    expect(received[0].content).toBe("hello");
  });

  test("emits with correct metadata", async () => {
    const store = createTestStore();
    const received: Message[] = [];
    store.on("message", (msg) => received.push(msg));

    await store.append("alice", "DM to bob", { to: "bob" });

    expect(received[0].to).toBe("bob");
  });

  test("off removes listener", async () => {
    const store = createTestStore();
    const received: Message[] = [];
    const handler = (msg: Message) => received.push(msg);
    store.on("message", handler);
    store.off("message", handler);

    await store.append("alice", "hello");
    expect(received).toHaveLength(0);
  });
});

// ==================== ChannelBridge ====================

describe("ChannelBridge", () => {
  let store: DefaultChannelStore;
  let bridge: ChannelBridge;

  beforeEach(() => {
    store = createTestStore();
    bridge = new ChannelBridge(store);
  });

  test("subscribe receives messages from channel", async () => {
    const received: Message[] = [];
    bridge.subscribe({}, (msg) => received.push(msg));

    await store.append("alice", "hello from channel");

    expect(received).toHaveLength(1);
    expect(received[0].content).toBe("hello from channel");
  });

  test("unsubscribe stops delivery", async () => {
    const received: Message[] = [];
    const unsub = bridge.subscribe({}, (msg) => received.push(msg));

    await store.append("alice", "first");
    unsub();
    await store.append("alice", "second");

    expect(received).toHaveLength(1);
    expect(received[0].content).toBe("first");
  });

  test("send injects message into channel", async () => {
    const msg = await bridge.send("telegram:User", "hello from telegram", { source: "telegram" });

    expect(msg.from).toBe("telegram:User");
    expect(msg.content).toBe("hello from telegram");

    // Message should be in channel
    const entries = await store.read();
    expect(entries).toHaveLength(1);
    expect(entries[0].from).toBe("telegram:User");
  });

  test("kind filter works", async () => {
    const received: Message[] = [];
    bridge.subscribe({ kinds: ["message"] }, (msg) => received.push(msg));

    await store.append("system", "log entry", { kind: "system" });
    await store.append("alice", "hello");

    expect(received).toHaveLength(1);
    expect(received[0].content).toBe("hello");
  });

  test("from filter works", async () => {
    const received: Message[] = [];
    bridge.subscribe({ from: ["alice"] }, (msg) => received.push(msg));

    await store.append("bob", "from bob");
    await store.append("alice", "from alice");

    expect(received).toHaveLength(1);
    expect(received[0].from).toBe("alice");
  });

  test("excludeFrom filter works", async () => {
    const received: Message[] = [];
    bridge.subscribe({ excludeFrom: ["bob"] }, (msg) => received.push(msg));

    await store.append("bob", "from bob");
    await store.append("alice", "from alice");

    expect(received).toHaveLength(1);
    expect(received[0].from).toBe("alice");
  });

  test("excludeFrom wildcard matches platform prefix", async () => {
    const received: Message[] = [];
    bridge.subscribe({ excludeFrom: ["telegram:*"] }, (msg) => received.push(msg));

    await store.append("telegram:User", "from telegram");
    await store.append("alice", "from alice");
    await store.append("slack:User", "from slack");

    expect(received).toHaveLength(2);
    expect(received[0].from).toBe("alice");
    expect(received[1].from).toBe("slack:User");
  });

  test("anti-loop: telegram messages don't echo back to telegram subscriber", async () => {
    const telegramReceived: Message[] = [];
    const internalReceived: Message[] = [];

    // Telegram adapter subscribes excluding its own messages
    bridge.subscribe(
      { kinds: ["message"], excludeFrom: ["telegram:*"] },
      (msg) => telegramReceived.push(msg),
    );

    // Internal subscriber sees everything
    bridge.subscribe({ kinds: ["message"] }, (msg) => internalReceived.push(msg));

    // Telegram user sends (via bridge.send)
    await bridge.send("telegram:Alice", "hello from telegram", { source: "telegram" });

    // Internal agent sends
    await store.append("bob", "hello from bob");

    // Telegram subscriber should NOT see telegram messages (anti-loop)
    expect(telegramReceived).toHaveLength(1);
    expect(telegramReceived[0].from).toBe("bob");

    // Internal subscriber sees all
    expect(internalReceived).toHaveLength(2);
  });

  test("to filter works", async () => {
    const received: Message[] = [];
    bridge.subscribe({ to: ["alice"] }, (msg) => received.push(msg));

    await store.append("bob", "hello alice", { to: "alice" });
    await store.append("bob", "hello everyone");

    expect(received).toHaveLength(1);
    expect(received[0].to).toBe("alice");
  });

  test("multiple filters combine", async () => {
    const received: Message[] = [];
    bridge.subscribe(
      { kinds: ["message"], excludeFrom: ["system"] },
      (msg) => received.push(msg),
    );

    await store.append("system", "system log", { kind: "system" });
    await store.append("system", "system message"); // kind defaults to "message"
    await store.append("alice", "hello");

    // system log filtered by kind, system message filtered by excludeFrom
    expect(received).toHaveLength(1);
    expect(received[0].from).toBe("alice");
  });

  test("subscriber error doesn't break dispatch", async () => {
    const received: Message[] = [];

    bridge.subscribe({}, () => {
      throw new Error("subscriber error");
    });
    bridge.subscribe({}, (msg) => received.push(msg));

    await store.append("alice", "hello");

    expect(received).toHaveLength(1);
  });

  test("shutdown cleans up", async () => {
    const received: Message[] = [];
    bridge.subscribe({}, (msg) => received.push(msg));

    await bridge.shutdown();

    await store.append("alice", "after shutdown");
    expect(received).toHaveLength(0);
    expect(bridge.subscriptionCount).toBe(0);
  });

  test("subscriptionCount and adapterCount", () => {
    expect(bridge.subscriptionCount).toBe(0);
    expect(bridge.adapterCount).toBe(0);

    bridge.subscribe({}, () => {});
    expect(bridge.subscriptionCount).toBe(1);
  });
});

// ==================== Targeted Delivery ====================

describe("Targeted delivery via to field", () => {
  let store: DefaultChannelStore;
  let bridge: ChannelBridge;

  beforeEach(() => {
    store = createTestStore();
    bridge = new ChannelBridge(store);
  });

  test("broadcast: subscriber without to filter receives all messages", async () => {
    const received: Message[] = [];
    bridge.subscribe({ kinds: ["message"] }, (msg) => received.push(msg));

    await store.append("alice", "broadcast");
    await store.append("alice", "to bob", { to: "bob" });
    await store.append("alice", "to telegram", { to: "telegram" });

    expect(received).toHaveLength(3);
  });

  test("adapter-style subscriber can filter by to matching platform", async () => {
    const telegramReceived: Message[] = [];
    const platform = "telegram";

    // Simulate adapter subscription: only receive broadcasts or targeted messages
    bridge.subscribe(
      { kinds: ["message"], excludeFrom: ["telegram:*"] },
      (msg) => {
        if (!msg.to || msg.to === platform) {
          telegramReceived.push(msg);
        }
      },
    );

    await store.append("alice", "broadcast"); // received (no to)
    await store.append("alice", "DM to bob", { to: "bob" }); // skipped (to=bob)
    await store.append("alice", "to telegram", { to: "telegram" }); // received (to=telegram)

    expect(telegramReceived).toHaveLength(2);
    expect(telegramReceived[0].content).toBe("broadcast");
    expect(telegramReceived[1].content).toBe("to telegram");
  });
});

// ==================== createBridgeAdapters ====================

describe("createBridgeAdapters", () => {
  test("creates telegram adapter from config", () => {
    const { createBridgeAdapters } = require("../src/context/adapters/index.ts");
    const adapters = createBridgeAdapters([
      { adapter: "telegram", bot_token: "test-token", chat_id: "123" },
    ]);
    expect(adapters).toHaveLength(1);
    expect(adapters[0].platform).toBe("telegram");
  });

  test("skips unknown adapter types", () => {
    const { createBridgeAdapters } = require("../src/context/adapters/index.ts");
    const adapters = createBridgeAdapters([
      { adapter: "unknown_platform" },
    ]);
    expect(adapters).toHaveLength(0);
  });

  test("skips telegram adapter with missing token", () => {
    const { createBridgeAdapters } = require("../src/context/adapters/index.ts");
    const adapters = createBridgeAdapters([
      { adapter: "telegram", chat_id: "123" },
    ]);
    expect(adapters).toHaveLength(0);
  });
});

// ==================== Extended Mention Pattern ====================

describe("extractMentions (extended)", () => {
  const validAgents = ["alice", "bob"];

  test("extracts internal @mentions (backward compatible)", () => {
    const mentions = extractMentions("@alice please check", validAgents);
    expect(mentions).toEqual(["alice"]);
  });

  test("extracts external identity with colon", () => {
    const mentions = extractMentions("@telegram:user hello", validAgents);
    expect(mentions).toEqual(["telegram:user"]);
  });

  test("extracts quoted external identity with spaces", () => {
    const mentions = extractMentions('@"telegram:TIANYANG Zhou" hello', validAgents);
    expect(mentions).toEqual(["telegram:TIANYANG Zhou"]);
  });

  test("mixes internal and external mentions", () => {
    const mentions = extractMentions("@alice and @telegram:user", validAgents);
    expect(mentions).toEqual(["alice", "telegram:user"]);
  });

  test("deduplicates external mentions", () => {
    const mentions = extractMentions("@telegram:user @telegram:user", validAgents);
    expect(mentions).toEqual(["telegram:user"]);
  });

  test("still ignores unknown internal agents", () => {
    const mentions = extractMentions("@unknown @alice", validAgents);
    expect(mentions).toEqual(["alice"]);
  });

  test("external identity always included regardless of validAgents", () => {
    const mentions = extractMentions("@slack:someone", []);
    expect(mentions).toEqual(["slack:someone"]);
  });
});
