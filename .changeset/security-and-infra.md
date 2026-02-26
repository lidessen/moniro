---
"agent-worker": patch
---

Security hardening, zod v4 upgrade, and CLI improvements

- Prevent command injection in git ref handling: validate refs with allowlist, use `execFileSync` instead of `execSync`, replace shell `rm -rf` with `rmSync`
- Upgrade zod from v3 to v4 (`^4.3.6`), update `z.record()` calls to explicit key/value types
- Use standard `--` separator for passing workflow params in CLI, replacing fragile `allowUnknownOption` hack
- Fix typecheck in CI without `@types/bun` by adding `preserveSymlinks` config
