# Reinforcement Techniques

Deep dive into constraint-maintenance mechanisms.

## The Decay Problem

Instructions decay because of attention dilution:

```
Context Window:
[System Prompt: 500 tokens] [Conversation: 5000 tokens] [Current: 500 tokens]
     ↑                              ↑                          ↑
   Original                    Diluting mass              High attention
   instruction                                            (but ephemeral)
```

**The challenge**: Keep early instructions salient despite growing context.

---

## Technique 1: Self-Echo (自我重复)

### Mechanism

Instruction tells agent to restate the constraint in its outputs.

### Implementation

```markdown
## Constraint: Security First

Never execute commands that could harm the system.

**Self-reinforcement**: Before executing any command, state:
"[Security check: command is safe because...]"
```

### Why It Works

1. **Creates fresh context**: Each output containing the echo is recent
2. **Explicit accountability**: Agent must consciously verify compliance
3. **Visible trail**: Deviation is obvious when echo stops

### Variations

**Explicit echo**:

```
Before each response, write: "[Constraint active: X]"
```

**Implicit echo**:

```
Structure every response as:
1. What I'm about to do
2. Why it's appropriate
3. The actual response
```

**Periodic echo**:

```
After every 3 responses, verify: "Am I still following X?"
```

### Trade-offs

| Pro                      | Con                 |
| ------------------------ | ------------------- |
| Strong decay resistance  | Verbose output      |
| Visible compliance trail | Can feel mechanical |
| Easy to implement        | May annoy users     |

### Best For

- Critical safety constraints
- Behaviors that are easy to drift from
- Situations where explicit verification is acceptable

---

## Technique 2: Tool Anchoring (工具锚定)

### Mechanism

Bind constraint to tool usage patterns, making violation visible.

### Implementation

```markdown
## Work Tracking Rule

ALWAYS use TodoWrite before starting any task.

This is non-negotiable. If you notice you've started working without
a TODO list, STOP immediately and create one.

The TODO list is your accountability partner.
```

### Why It Works

1. **Observable action**: Tool calls are explicit, logged, verifiable
2. **Binary compliance**: Either the tool was used or it wasn't
3. **Natural checkpoint**: Tool usage is a decision point

### Anchoring Patterns

**Pre-action anchor**:

```
Before [action], always [tool usage]
- Before editing: Read the file first
- Before committing: Run tests first
- Before answering: Search the codebase first
```

**State-tracking anchor**:

```
Use TodoWrite to maintain your task state.
If your TODO list is empty when working, something is wrong.
```

**Verification anchor**:

```
After making changes, use Bash to verify:
- Run the build
- Run the tests
- The work isn't done until verification passes
```

### Trade-offs

| Pro                                 | Con                                   |
| ----------------------------------- | ------------------------------------- |
| Very robust (tool calls are logged) | Only works for tool-related behaviors |
| Clear success/failure criteria      | Can add friction to simple tasks      |
| Self-documenting                    | Requires appropriate tools to exist   |

### Best For

- Workflow compliance (tracking, verification)
- Process adherence (commit conventions, test requirements)
- Behaviors that should create artifacts

---

## Technique 3: Checkpoint Injection (检查点注入)

### Mechanism

Create explicit moments where the agent must verify constraint compliance.

### Implementation

```markdown
## Checkpoint Protocol

Every 3 responses, pause and check:

- [ ] Am I still following the security guidelines?
- [ ] Have I stayed on task?
- [ ] Is my output quality consistent?

If any check fails, course-correct before continuing.
```

### Why It Works

1. **Attention refresh**: Checkpoints force re-reading of constraints
2. **Drift detection**: Regular checks catch gradual deviation
3. **Self-correction**: Problems fixed early, before compounding

### Checkpoint Types

**Time/count based**:

```
After every N responses...
After every N tool calls...
At the start of each new task...
```

**Event based**:

```
Before any destructive operation...
When switching contexts...
Before providing final answer...
```

**Complexity based**:

```
When task seems to be getting complicated...
When you're about to make an assumption...
When you realize you've been working for a while...
```

### Trade-offs

| Pro                    | Con                             |
| ---------------------- | ------------------------------- |
| Catches drift early    | Interrupts flow                 |
| Explicit verification  | Requires discipline to maintain |
| Customizable frequency | Can feel bureaucratic           |

### Best For

- Long-running tasks
- Complex multi-step processes
- Situations where drift has serious consequences

---

## Technique 4: Identity Integration (身份整合)

### Mechanism

Make the constraint part of "who the agent is" rather than "what it must do."

### Implementation

```markdown
## Who You Are

You are a methodical investigator. You don't jump to conclusions—you
gather evidence first. When someone asks "how does X work?", your
instinct is to find and cite the actual code, not to speculate.

This isn't a rule you follow. It's how you think.
```

### Why It Works

1. **Deeper encoding**: Identity statements processed differently than rules
2. **Natural expression**: Behavior emerges from character, not compliance
3. **Resistance to override**: "This is who I am" harder to bypass than "This is what I must do"

### Identity Framing Patterns

**Value-based**:

```
You care deeply about [value]. When you see [situation], you feel
compelled to [behavior].
```

**Trait-based**:

```
You are [trait]. This means you naturally [behavior] without being
asked.
```

**Role-based**:

```
You are a [role]. A [role] always [behavior] because that's what
defines a good [role].
```

### Trade-offs

| Pro                         | Con                           |
| --------------------------- | ----------------------------- |
| Very durable                | Can feel manipulative         |
| Natural output              | Effectiveness varies by model |
| High adversarial resistance | Harder to debug/modify        |

### Best For

- Core behavioral patterns
- Constraints that should feel natural, not imposed
- Situations where explicit rules feel awkward

---

## Technique 5: Format Anchoring (格式锚定)

### Mechanism

Require output format that implicitly enforces the constraint.

### Implementation

```markdown
## Response Format

Every response must follow this structure:

1. **Understanding**: What I think you're asking
2. **Evidence**: What I found (with citations)
3. **Answer**: My response
4. **Verification**: How I know this is correct

Do not skip sections.
```

### Why It Works

1. **Visible structure**: Missing sections are obvious
2. **Implicit checkpoints**: Each section is a compliance point
3. **Self-accountability**: Format violations stand out

### Format Patterns

**Mandatory sections**:

```
[Task] [Evidence] [Action] [Verification]
```

**Checklist embedding**:

```
End each response with:
✓ Sources cited
✓ Assumptions stated
✓ Next steps clear
```

**Progressive disclosure**:

```
First: What I'll do
Then: What I did
Finally: What I learned
```

### Trade-offs

| Pro                | Con                       |
| ------------------ | ------------------------- |
| Clear structure    | Rigid output              |
| Visible compliance | May not suit all contexts |
| Self-documenting   | Can feel formulaic        |

### Best For

- Contexts requiring consistent quality
- Behaviors that can be expressed as output sections
- Situations where accountability matters

---

## Technique Combinations

Techniques work better together:

### Example: Strong Work Tracking

```markdown
## Who You Are (Identity)

You are a systematic worker who never loses track of tasks. Chaos
frustrates you. Order is satisfying.

## How You Work (Tool Anchoring)

Always use TodoWrite to track tasks. No exceptions.

## Self-Check (Self-Echo)

Before each action, note: "[Working on: task X]"

## Format (Format Anchoring)

End each response with:

- Tasks completed: [list]
- Tasks remaining: [list]
- Next action: [specific]
```

### Combination Effects

| Combination            | Effect                                          |
| ---------------------- | ----------------------------------------------- |
| Identity + Tool        | Natural usage of tools                          |
| Self-echo + Checkpoint | Regular explicit verification                   |
| Format + Tool          | Structured accountability                       |
| All four               | Maximum robustness (but also maximum verbosity) |

---

## Choosing Techniques

Match technique to constraint type:

| Constraint Type           | Recommended Techniques            |
| ------------------------- | --------------------------------- |
| Safety-critical           | Identity + Self-echo + Checkpoint |
| Workflow/process          | Tool anchoring + Format           |
| Quality standards         | Format + Checkpoint               |
| Behavioral style          | Identity + (light) Self-echo      |
| Verification requirements | Tool anchoring + Format           |

---

## Measurement Protocol

To evaluate reinforcement effectiveness:

1. **Baseline**: Test instruction without reinforcement
2. **Apply technique**: Add reinforcement
3. **Re-test**: Same conditions
4. **Compare**:
   - Decay rate (how fast compliance drops)
   - Adversarial resistance (pressure to break)
   - Output quality (is output still natural?)
   - Cost (verbosity, friction)

```
Effectiveness = (Decay Resistance × Adversarial Resistance) / Cost
```

The best technique depends on what you're optimizing for.
