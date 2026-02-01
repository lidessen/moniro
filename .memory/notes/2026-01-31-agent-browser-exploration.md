---
type: note
created: 2026-01-31
tags: [tools, browser, e2e, verification, agent-browser]
---

# Agent Browser Exploration

## Context

Explored browser automation tools for AI agents, specifically for e2e testing and verification.

## Tools Evaluated

### agent-browser

**Status**: ✅ Works

**Installation**:
```bash
npm install -g agent-browser
```

**Configuration** (when Playwright browser version mismatch):
```bash
export AGENT_BROWSER_EXECUTABLE_PATH=/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome
```

**Key Commands**:
```bash
# Open page
agent-browser open http://localhost:5555

# Get accessibility tree (AI-friendly)
agent-browser snapshot

# Get JSON output (for programmatic use)
agent-browser snapshot --json

# Click element by ref
agent-browser click @e2

# Take screenshot
agent-browser screenshot /path/to/file.png

# Close browser
agent-browser close
```

**JSON Output Example**:
```json
{
  "refs": {
    "e1": {"name": "Hello", "role": "heading"},
    "e2": {"name": "Click me", "role": "button"}
  },
  "snapshot": "- document:\n  - heading [ref=e1]\n  - button [ref=e2]"
}
```

### Playwright (via Vitest)

**Status**: ⚠️ Version mismatch

**Issue**: semajsx uses Playwright 1.58.0 which requires chromium v1208, but cached version is v1194. Downloading new version blocked by network (`storage.googleapis.com` unreachable).

## Environment Limitations

| Capability | Status |
|------------|--------|
| Local servers (localhost) | ✅ Works |
| External websites | ❌ ERR_TUNNEL_CONNECTION_FAILED |
| Playwright browser download | ❌ Network blocked |

## Implications for Verification

**What agents CAN do**:
1. Start local dev servers
2. Open pages in headless browser
3. Get accessibility tree (structured, with refs)
4. Interact with elements (click, type, fill)
5. Take screenshots for evidence
6. Verify DOM state changes

**What agents CANNOT do** (in this environment):
1. Access external websites
2. Download new browser versions
3. Run Playwright tests that need newer browser

## Recommendations

For validation skill:
1. **Use agent-browser for local e2e testing** when servers can be started
2. **Use --json flag** for programmatic verification
3. **Set EXECUTABLE_PATH** to use existing Chromium when version mismatch occurs
4. **Screenshot as evidence** when visual verification needed

## Integration Opportunity

agent-browser has a dedicated Claude Code skill. Consider:
1. Adding browser automation to validation skill
2. Creating a dedicated "e2e" skill for browser-based testing
3. Documenting workarounds for common issues (version mismatch, network limits)

---

*践, 2026-01-31*
