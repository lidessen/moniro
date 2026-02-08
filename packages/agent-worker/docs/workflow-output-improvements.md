# Workflow Output Layout Improvements

## Overview

The workflow output system has been enhanced with modern CLI best practices to improve readability, adapt to different terminal sizes, and reduce visual noise.

## Key Improvements

### 1. Adaptive Layout

**Before**: Fixed column widths wasted space
```
00:47:08 student      │ Message
00:47:08 ai           │ Response
         ^^^^^^^^^^^^  (8 wasted spaces)
```

**After**: Columns adapt to actual agent names
```
47:08 student │ Message
47:08 ai      │ Response
```

**How it works**:
- Automatically detects terminal width (`process.stdout.columns`)
- Calculates optimal column widths based on agent names
- Uses compact time format (MM:SS) for short sessions
- Caps agent name column at 20 characters for readability

### 2. Smart Text Wrapping

**Before**: Long messages caused horizontal scrolling
```
47:34 teacher ┊ [ERROR] ERROR HTTP 400: This model's maximum context length is 131072 tokens. However, you requested 215822 tokens...
```

**After**: Messages wrap intelligently at configurable width
```
47:34 teacher ┊ [ERROR] ERROR HTTP 400: This model's maximum
              ┊ context length is 131072 tokens. However, you
              ┊ requested 215822 tokens (207630 in messages,
              ┊ 8192 in completion). Please reduce the length.
```

**Features**:
- Respects 80-column convention by default
- Preserves ANSI color codes during wrapping
- Handles multi-paragraph messages correctly
- Breaks long words when necessary (hard wrapping)

### 3. Message Grouping

**Before**: Repetitive headers for consecutive messages
```
47:08 student │ First question
47:08 student │ Follow-up detail
47:08 student │ More context
```

**After**: Groups messages from same agent/minute
```
47:08 student │ First question
      │ Follow-up detail
      │ More context
```

**Benefits**:
- Reduces visual clutter
- Makes conversation flow easier to follow
- Conserves vertical space
- Can be disabled via configuration

### 4. Background-Agnostic Colors

**Before**: Manual ANSI codes assumed terminal theme
```typescript
const color = "\x1b[36m"; // Cyan - may not work on all themes
```

**After**: Using `chalk` with standard colors
```typescript
const color = chalk.cyan; // Works on light and dark themes
```

**Improvements**:
- Automatically respects `NO_COLOR` environment variable
- Uses only bold and standard colors
- Works on any terminal theme (light/dark/custom)
- Better TypeScript integration

## Technical Architecture

### File Structure

```
src/workflow/
├── layout.ts          # NEW: Layout calculation and utilities
├── display.ts         # UPDATED: Display formatting with layout system
└── runner.ts          # Uses display.ts (no changes needed)
```

### Key Components

#### `layout.ts`

Handles all layout calculations:
- `calculateLayout()` - Adaptive column width calculation
- `formatTime()` - Time formatting with change detection
- `shouldGroup()` - Message grouping logic
- `getWidth()` - Display width for Unicode/emoji
- `LAYOUT_PRESETS` - Predefined configurations

#### `display.ts`

Formatting and rendering:
- `formatChannelEntry()` - Main entry point
- `formatAgentEntry()` - Agent message formatting
- `formatLogEntry()` - Log/debug message formatting
- `wrapMessage()` - ANSI-safe text wrapping
- `startChannelWatcher()` - Real-time display

### Configuration

```typescript
// Create custom layout
const layout = calculateLayout({
  agentNames: ['alice', 'bob'],
  terminalWidth: 120,      // Override auto-detection
  compact: false,          // Use HH:MM:SS instead of MM:SS
  maxContentWidth: 100,    // Custom wrap width
});

// Use presets
import { LAYOUT_PRESETS } from './layout.ts';

const layout = LAYOUT_PRESETS.wide(['alice', 'bob']);
```

Available presets:
- `default` - Standard interactive terminal
- `compact` - CI/logs (120-char content, compact time)
- `wide` - Large terminals (120-char content)
- `narrow` - Split screens (50-char content)

### Display Context

```typescript
const context = createDisplayContext(
  ['student', 'teacher'],
  { enableGrouping: true }
);

const formatted = formatChannelEntry(message, context);
```

## Testing

### Run Unit Tests
```bash
bun test layout.test.ts
```

Tests cover:
- Adaptive layout calculation
- Terminal width constraints
- Time formatting and grouping detection
- Message grouping logic
- Width calculations for Unicode
- Edge cases (narrow/wide terminals)

### Run Visual Demo
```bash
bun run test/display-demo.ts
```

Demonstrates all features with realistic workflow messages.

## Migration Guide

### For Existing Code

**No changes required!** The new system is backward compatible.

The `startChannelWatcher()` interface remains the same:
```typescript
startChannelWatcher({
  contextProvider,
  agentNames,
  log: console.log,
  showDebug: false,
});
```

### Optional: Enable Grouping Control

```typescript
startChannelWatcher({
  contextProvider,
  agentNames,
  log: console.log,
  enableGrouping: false, // NEW: Disable grouping if needed
});
```

### For Custom Display Logic

If you have custom formatting code, consider migrating to the new system:

```typescript
// Before
const NAME_WIDTH = 12;
const time = formatTime(timestamp);
const name = entry.from.padEnd(NAME_WIDTH);
console.log(`${time} ${name} | ${entry.content}`);

// After
import { createDisplayContext, formatChannelEntry } from './display.ts';

const context = createDisplayContext(agentNames);
const formatted = formatChannelEntry(entry, context);
console.log(formatted);
```

## Best Practices Implementation

This implementation follows industry standards from:

### References

- [Command Line Interface Guidelines](https://clig.dev/) - Comprehensive CLI UX guide
- [CLI Best Practices](https://relay.sh/blog/command-line-ux-in-2020/) - Modern design principles
- [Google Developer Style Guide](https://developers.google.com/style/code-syntax) - Documentation standards

### Key Principles Applied

1. **Human-first design** - Optimize for readability over compactness
2. **Composability** - TTY detection for pipeline compatibility
3. **Terminal diversity** - Background-agnostic colors
4. **Progressive disclosure** - Group repeated information
5. **Accessibility** - Respect `NO_COLOR` and standard colors
6. **Convention** - 80-column limit for readability

## Performance

### Memory
- Minimal overhead: layout calculated once per workflow
- Grouping state: ~50 bytes per workflow
- No buffering: messages stream through

### CPU
- Text wrapping: O(n) where n = message length
- Width calculation: O(m) where m = string length
- Negligible impact on workflow performance

## Future Enhancements

Potential improvements for future versions:

1. **Progress indicators** - Animated spinners for running agents
2. **Status summaries** - Table of agent activity on completion
3. **Truncation strategies** - Smart truncation for very long messages
4. **Custom themes** - User-configurable color schemes
5. **Accessibility mode** - High-contrast output for vision impairment
6. **Export formats** - HTML/Markdown export of workflow output

## Troubleshooting

### Colors not showing
```bash
# Check if NO_COLOR is set
echo $NO_COLOR

# Check if running in TTY
[ -t 1 ] && echo "TTY" || echo "Not TTY"
```

### Layout looks wrong
```bash
# Check terminal width detection
node -e "console.log('Columns:', process.stdout.columns)"

# Force specific width
COLUMNS=120 your-command
```

### Message grouping unexpected
```typescript
// Disable grouping
startChannelWatcher({
  // ...
  enableGrouping: false,
});
```

## Contributing

When modifying display logic:

1. Run tests: `bun test layout.test.ts`
2. Check visual output: `bun run test/display-demo.ts`
3. Test on different terminal widths: `COLUMNS=60 bun run test/display-demo.ts`
4. Verify both TTY and non-TTY modes
5. Update documentation if adding features

## License

Same as parent project (agent-worker).
