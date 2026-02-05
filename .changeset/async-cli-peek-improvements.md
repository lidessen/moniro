---
"agent-worker": minor
---

Improve CLI messaging system with async-by-default behavior and better UX

**Breaking Changes:**
- CLI now sends messages asynchronously by default (non-blocking). Use `--wait` flag for synchronous mode
- Renamed `history` command to `peek` for more intuitive message viewing

**New Features:**
- Added `peek` command with smart defaults (shows last 10 messages by default)
- Added `peek --all` to show all messages
- Added `peek --find <text>` to search/filter messages (case-insensitive)
- Added `--wait` flag to send command for synchronous mode when needed
- Added `--debug` flag for detailed troubleshooting information

**Improvements:**
- Added 60-second timeout for async message processing to prevent indefinite hangs
- Improved async response message: "Processing in background. Use `peek` to check the response."
- Fixed stdin handling in Claude CLI backend to prevent blocking issues
- Added comprehensive backend limitations documentation

**Bug Fixes:**
- Fixed issue where async messages could hang indefinitely in certain environments
- Improved error messaging for timeout scenarios
