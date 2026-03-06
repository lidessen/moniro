/**
 * Telegram Channel Adapter
 *
 * Bridges a Telegram chat ↔ workspace channel using grammy.
 *
 * Inbound:  Telegram messages → channel (as "telegram:<display_name>")
 * Outbound: Channel messages → Telegram chat (excluding messages from Telegram itself)
 */

import { Bot } from "grammy";
import type { ChannelAdapter, ChannelBridge } from "../bridge.ts";
import type { Message } from "../types.ts";

// ==================== Config ====================

export interface TelegramAdapterConfig {
  /** Telegram Bot API token */
  botToken: string;
  /** Telegram chat ID to bridge */
  chatId: string | number;
}

// ==================== Adapter ====================

export class TelegramAdapter implements ChannelAdapter {
  readonly platform = "telegram";

  private bot: Bot;
  private chatId: string | number;
  private unsubscribe?: () => void;
  private started = false;

  constructor(private config: TelegramAdapterConfig) {
    this.bot = new Bot(config.botToken);
    this.chatId = config.chatId;
  }

  async start(bridge: ChannelBridge): Promise<void> {
    if (this.started) return;
    this.started = true;

    // Outbound: channel → Telegram
    // Exclude messages from Telegram itself (anti-loop via excludeFrom wildcard)
    // Only send if: broadcast (no `to`) or targeted to this platform (`to: "telegram"`)
    this.unsubscribe = bridge.subscribe(
      { kinds: ["message"], excludeFrom: ["telegram:*"] },
      (msg) => {
        if (!msg.to || msg.to === this.platform) {
          this.sendToTelegram(msg);
        }
      },
    );

    // Inbound: Telegram → channel
    this.bot.on("message:text", (ctx) => {
      const from = ctx.from;
      if (!from) return;

      const displayName = from.first_name + (from.last_name ? ` ${from.last_name}` : "");
      const sender = `telegram:${displayName}`;

      bridge.send(sender, ctx.message.text, { source: "telegram" });
    });

    // Start polling (non-blocking)
    this.bot.start({
      onStart: () => {
        // Bot is ready
      },
    });
  }

  async shutdown(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.unsubscribe?.();
    await this.bot.stop();
  }

  // ==================== Internal ====================

  private sendToTelegram(msg: Message): void {
    const text = `${msg.from}: ${msg.content}`;
    // Telegram message limit is 4096 chars
    const truncated = text.length > 4096 ? text.slice(0, 4093) + "..." : text;
    this.bot.api.sendMessage(this.chatId, truncated).catch(() => {
      // Swallow send errors (rate limit, chat not found, etc.)
      // TODO: structured logging when Logger is available
    });
  }
}
