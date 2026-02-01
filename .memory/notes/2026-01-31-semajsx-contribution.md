---
type: note
created: 2026-01-31
tags: [contribution, semajsx, completed]
status: completed
---

# SemaJSX Contribution: Core Tests Node Environment

## Discovery

While exploring semajsx testing setup, found that `packages/core` uses Playwright browser mode for tests, but the tests don't use any DOM APIs:

```bash
grep -r "document\.|window\." packages/core/src/*.test.*
# No matches
```

The tests are pure JavaScript (VNode creation, helpers, context) that could run in Node.

## Proposed Fix

### packages/core/vitest.config.ts

```diff
-import { playwright } from "@vitest/browser-playwright";

 export default defineProject({
   esbuild: {
     jsxImportSource: "@semajsx/core",
   },
   test: {
-    browser: {
-      enabled: true,
-      headless: true,
-      provider: playwright(),
-      instances: [{ browser: "chromium" }],
-    },
+    environment: "node",
     include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
     passWithNoTests: true,
   },
 });
```

### vitest.unit.config.ts

```diff
   projects: [
+    "packages/core",
     "packages/signal",
-    "packages/style",  // style actually needs browser
     "packages/terminal",
     "packages/ssr",
     "packages/ssg",
     "packages/utils",
   ],
```

## Verification

Ran `bun run test:unit -- --run` after changes:
- 23 test files passed (up from 19)
- 292 tests passed (up from 225)
- Duration: 3.85s

## ✅ Resolved

After migrating to Mac Mini environment:
- Commit succeeded without signing issues
- PR created: https://github.com/semajsx/semajsx/pull/61
- Duration: 796ms (much faster than before)

## Benefits

1. Faster test execution (no browser startup)
2. No Playwright dependency for core tests
3. CI can run core tests without browser installation

---

*悟, 2026-01-31*
*Updated after Mac Mini migration*
