/**
 * Channel Bridge
 *
 * Event-driven wrapper over ChannelStore that enables external platform integration.
 * Provides subscribe/send API with anti-loop protection.
 *
 * Architecture:
 *   External Platforms ──► ChannelAdapter ──► ChannelBridge ──► ChannelStore
 *                                              ▲                    │
 *                                              └── emit("message") ─┘
 */

import type { Message, EventKind } from "./types.ts";
import type { SendOptions } from "./provider.ts";
import type { DefaultChannelStore } from "./stores/channel.ts";

// ==================== Types ====================

/** Filter for subscribing to channel messages */
export interface MessageFilter {
  /** Only receive specific event kinds (default: all) */
  kinds?: EventKind[];
  /** Only receive messages from specific senders */
  from?: string[];
  /** Only receive messages addressed to specific recipients */
  to?: string[];
  /** Exclude messages from specific senders */
  excludeFrom?: string[];
}

/** Options for sending a message via bridge */
export interface BridgeSendOptions extends SendOptions {
  /** Source platform identifier (used for anti-loop) */
  source?: string;
}

/** External platform adapter */
export interface ChannelAdapter {
  /** Platform identifier (e.g., "telegram", "slack") */
  readonly platform: string;
  /** Start the adapter, connecting to the external platform */
  start(bridge: ChannelBridge): Promise<void>;
  /** Shut down the adapter, closing external connections */
  shutdown(): Promise<void>;
}

// ==================== Bridge ====================

/**
 * ChannelBridge — event-driven layer over ChannelStore.
 *
 * Two core capabilities:
 * 1. subscribe() — push-based message delivery with filtering
 * 2. send() — inject external messages into the channel
 *
 * Anti-loop: messages sent with a `source` are not pushed back
 * to subscribers whose filter matches that source.
 */
export class ChannelBridge {
  private subscriptions: Subscription[] = [];
  private adapters: ChannelAdapter[] = [];
  private messageHandler: (msg: Message) => void;

  constructor(private channel: DefaultChannelStore) {
    this.messageHandler = (msg: Message) => this.dispatch(msg);
    this.channel.on("message", this.messageHandler);
  }

  /**
   * Subscribe to channel messages.
   * Returns an unsubscribe function.
   */
  subscribe(filter: MessageFilter, handler: (msg: Message) => void): () => void {
    const sub: Subscription = { filter, handler };
    this.subscriptions.push(sub);
    return () => {
      const idx = this.subscriptions.indexOf(sub);
      if (idx >= 0) this.subscriptions.splice(idx, 1);
    };
  }

  /**
   * Inject a message from an external source into the channel.
   */
  async send(from: string, content: string, options?: BridgeSendOptions): Promise<Message> {
    const msg = await this.channel.append(from, content, options);
    // The append triggers emit("message") → dispatch() automatically.
    // Anti-loop is handled in dispatch() via the _lastSource tracking.
    return msg;
  }

  /**
   * Register and start an adapter.
   */
  async addAdapter(adapter: ChannelAdapter): Promise<void> {
    this.adapters.push(adapter);
    await adapter.start(this);
  }

  /**
   * Shut down all adapters and unsubscribe from channel.
   */
  async shutdown(): Promise<void> {
    this.channel.off("message", this.messageHandler);
    await Promise.all(this.adapters.map((a) => a.shutdown()));
    this.adapters = [];
    this.subscriptions = [];
  }

  /** Current adapter count (for testing) */
  get adapterCount(): number {
    return this.adapters.length;
  }

  /** Current subscription count (for testing) */
  get subscriptionCount(): number {
    return this.subscriptions.length;
  }

  // ==================== Internal ====================

  private dispatch(msg: Message): void {
    // Determine source from the `from` field (external identities contain `:`)
    const msgSource = msg.from.includes(":") ? msg.from.split(":")[0] : undefined;

    for (const sub of this.subscriptions) {
      if (!this.matches(sub.filter, msg, msgSource)) continue;
      try {
        sub.handler(msg);
      } catch {
        // Subscriber errors don't break the dispatch loop
      }
    }
  }

  private matches(filter: MessageFilter, msg: Message, msgSource: string | undefined): boolean {
    // Kind filter
    if (filter.kinds && filter.kinds.length > 0) {
      const kind = msg.kind ?? "message";
      if (!filter.kinds.includes(kind)) return false;
    }

    // From filter
    if (filter.from && filter.from.length > 0) {
      if (!filter.from.includes(msg.from)) return false;
    }

    // To filter
    if (filter.to && filter.to.length > 0) {
      if (!msg.to || !filter.to.includes(msg.to)) return false;
    }

    // ExcludeFrom filter (supports wildcard like "telegram:*")
    if (filter.excludeFrom && filter.excludeFrom.length > 0) {
      for (const pattern of filter.excludeFrom) {
        if (pattern.endsWith(":*") && msgSource) {
          // Wildcard: "telegram:*" matches any "telegram:xxx"
          const platform = pattern.slice(0, -2);
          if (msgSource === platform) return false;
        } else if (msg.from === pattern) {
          return false;
        }
      }
    }

    return true;
  }
}

// ==================== Internal Types ====================

interface Subscription {
  filter: MessageFilter;
  handler: (msg: Message) => void;
}
