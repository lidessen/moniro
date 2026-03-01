# Examples

Test cases organized by complexity.

## Validated (✅)

| File                     | Category   | Steps | Description                         |
| ------------------------ | ---------- | ----- | ----------------------------------- |
| github-login-error.yaml  | foundation | 3     | Login form with invalid credentials |
| github-user-repos.yaml   | flow       | 4     | Profile → repos → repo detail       |
| github-repo-commits.yaml | flow       | 3     | Repo → commit history               |

## Draft (📝)

| File                  | Category    | Notes                           |
| --------------------- | ----------- | ------------------------------- |
| github-pr-review.yaml | composition | Multi-user template, needs auth |

## Running Examples

```bash
# Validate a case (agent interprets and executes)
# No automated runner yet - agent reads YAML and runs commands

agent-browser open https://github.com/torvalds --headed
agent-browser snapshot --json
# ... follow steps in YAML
```

## Contributing

1. Record with `agent-browser` in headed mode
2. Convert refs to semantic selectors
3. Add expect conditions
4. Validate with sub-agent execution
5. Document in exploration section
