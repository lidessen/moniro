/**
 * Store interfaces and default implementations.
 *
 * Each store owns one domain concern and its persistence strategy.
 * The ContextProvider composes these stores to satisfy the full interface.
 */

export type { ChannelStore } from "./channel.ts";
export { DefaultChannelStore } from "./channel.ts";

export type { InboxStore } from "./inbox.ts";
export { DefaultInboxStore } from "./inbox.ts";

export type { DocumentStore } from "./document.ts";
export { DefaultDocumentStore } from "./document.ts";

export type { ResourceStore } from "./resource.ts";
export { DefaultResourceStore } from "./resource.ts";

export type { StatusStore } from "./status.ts";
export { DefaultStatusStore } from "./status.ts";
