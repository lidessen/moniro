# Pretty Display Mode

Agent-worker now features a beautiful CLI interface using `@clack/prompts` for non-debug mode.

## Features

### 🎨 Visual Enhancements

- **Intro/Outro frames** - Clean session boundaries
- **Animated spinners** - Real-time progress indicators
- **Color-coded agents** - Each agent gets a distinct color
- **Grouped messages** - Messages from the same agent are visually grouped
- **Status badges** - Clear success/error indicators
- **Summary boxes** - Document and feedback displayed in styled boxes

### 📊 Display Modes

#### Pretty Mode (Default)
```bash
agent-worker run workflow.yaml
```

Output:
```
┌   agent-worker
│
●  Workflow: my-workflow
◇  Initialized
│
◇  ✓ Agents started
│
│  alice:
│    Hello! I'm Alice.
│
│  bob:
│    Hi Alice, I'm Bob.
│
◆  Completed in 3.2s
│
└  Done
```

#### Debug Mode (Detailed Logs)
```bash
agent-worker run workflow.yaml --debug
```

Output:
```
2026-02-10T01:37:55Z workflow: Running workflow: my-workflow
2026-02-10T01:37:55Z workflow: Agents: alice, bob
2026-02-10T01:37:55Z workflow: Starting agents...
...
```

#### JSON Mode (Machine-readable)
```bash
agent-worker run workflow.yaml --json
```

Output:
```json
{
  "success": true,
  "duration": 3200,
  "document": "...",
  "feedback": [...]
}
```

## Implementation

- `display-pretty.ts` - New pretty display implementation
- `workflow.ts` - Integrates pretty display for `run` command
- `runner.ts` - Conditional display layer selection

## Benefits

1. **Better UX** - Cleaner, more intuitive output for interactive use
2. **Progressive disclosure** - Less noise, more signal
3. **Visual hierarchy** - Important information stands out
4. **Preserved debugging** - `--debug` still shows all details
5. **Machine-readable** - `--json` for automation/scripting

## Inspiration

Based on [vercel-labs/skills](https://github.com/vercel-labs/skills) CLI design, featuring:
- `@clack/prompts` - Interactive CLI components
- `picocolors` - Lightweight terminal colors
