# Store Decomposition — Context Provider Refactoring

**Date**: 2026-02-25
**Scope**: `packages/agent-worker/src/workflow/context/`

## What Changed

Decomposed the monolithic `ContextProviderImpl` (487 lines, all domain logic bound to a single `StorageBackend`) into five domain-specific stores:

```
context/stores/
├── channel.ts    — ChannelStore: JSONL append, incremental sync, visibility filtering
├── inbox.ts      — InboxStore: filtered channel view, per-agent cursors, run epochs
├── document.ts   — DocumentStore: raw text CRUD under documents/ prefix
├── resource.ts   — ResourceStore: content-addressed blobs under resources/ prefix
└── status.ts     — StatusStore: agent status JSON with state transitions
```

`ContextProviderImpl` is now a thin composite (~100 lines) that delegates to stores. `smartSend` is the only cross-store orchestration (channel + resource).

## Why

The previous `StorageBackend` abstraction (read/write/append key-value) was at the wrong level. You couldn't say "channel uses JSONL files, inbox uses SQLite, status uses memory" because everything went through one backend.

Moving the abstraction to business-method level means each store implementation can freely choose its own persistence. The store interface IS the contract.

## What Didn't Change

- `ContextProvider` interface — unchanged. Zero consumer changes.
- `FileContextProvider` / `MemoryContextProvider` — still extend `ContextProviderImpl`, but now create stores in their constructors instead of passing a single backend.
- All 787 tests pass without modification.
- File layout on disk unchanged (channel.jsonl, documents/, resources/, _state/).

## Design Decision: Inbox Depends on Channel

InboxStore takes `ChannelStore` as a constructor dependency because inbox is a filtered view of the channel. This is explicit dependency injection, not a hidden coupling. When channel appends, inbox can sync from it.

## What's Next

This unlocks per-concern storage strategies. Concrete next steps could be:
- `SqliteInboxStore` — indexed cursor lookups instead of O(n) channel scans
- `MemoryStatusStore` — high-frequency updates without file I/O, periodic flush
- Agent-level context (`.agents/<name>/`) when Agent-as-Top-Level lands

## For Those Who Come After

The stores/ directory is the new home for domain logic. If you need to change how channel messages are stored, look at `stores/channel.ts`. If you need a new storage backend for inbox, implement `InboxStore` with your backend — don't modify `DefaultInboxStore`.

`ContextProviderImpl` should stay thin. It's a compositor, not a place for business logic. The only exception is `smartSend` which genuinely spans two concerns (channel + resource).
