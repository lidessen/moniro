/**
 * Channel Adapters — external platform integrations.
 */

import type { ChannelConfig } from "../../types.ts";
import type { ChannelAdapter } from "../bridge.ts";
import { TelegramAdapter } from "./telegram.ts";

export { TelegramAdapter, type TelegramAdapterConfig } from "./telegram.ts";

/**
 * Resolve env var interpolation in channel config values.
 * Supports both `${{ env.VAR }}` (workflow YAML) and `$VAR` (simple) syntax.
 */
function resolveEnvValue(value: string | undefined): string | undefined {
  if (!value) return value;
  // ${{ env.VAR }} syntax (from workflow YAML interpolation — already handled by interpolate.ts)
  // $VAR syntax (simple env ref)
  if (value.startsWith("$") && !value.startsWith("${{")) {
    return process.env[value.slice(1)] ?? value;
  }
  return value;
}

/**
 * Create channel adapters from channel configuration.
 *
 * Each ChannelConfig entry maps to one ChannelAdapter instance.
 * Unknown adapter types are silently skipped.
 */
export function createChannelAdapters(channels: ChannelConfig[]): ChannelAdapter[] {
  const adapters: ChannelAdapter[] = [];

  for (const channel of channels) {
    switch (channel.adapter) {
      case "telegram": {
        const botToken = resolveEnvValue(channel.bot_token);
        const chatId = resolveEnvValue(channel.chat_id);
        if (!botToken || !chatId) break;
        adapters.push(new TelegramAdapter({ botToken, chatId }));
        break;
      }
      // Future adapters: "slack", "discord", etc.
    }
  }

  return adapters;
}
