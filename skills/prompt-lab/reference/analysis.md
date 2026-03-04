# Analysis Methodology

How to interpret experiment results and derive actionable insights.

## The Analysis Framework

```
1. OBSERVATION    → What actually happened?
         ↓
2. MEASUREMENT    → How do we quantify it?
         ↓
3. DIAGNOSIS      → Why did it happen?
         ↓
4. PRESCRIPTION   → What should we change?
         ↓
5. VERIFICATION   → Did the change work?
```

---

## Step 1: Observation

### What to Look For

**Explicit signals**:

- Did the agent follow the instruction? (Yes/No/Partial)
- When did compliance change?
- What was the agent doing when it changed?

**Implicit signals**:

- Did the agent acknowledge the instruction?
- Did output quality change over time?
- Was there hesitation or negotiation?

### Evidence Collection

Quote specific outputs:

```
Good: "At token ~1500, agent wrote: 'Let me just quickly fix this...'
      without updating TODO, indicating decay onset."

Bad:  "Agent seemed to forget the instruction."
```

Be specific. Vague observations lead to vague conclusions.

---

## Step 2: Measurement

### Compliance Metrics

**Binary compliance**:

```
Compliance Rate = (Compliant responses / Total responses) × 100%
```

**Strength levels** (0-5):

```
0: Ignored       - No evidence instruction was noticed
1: Acknowledged  - Mentioned but not followed
2: Initially     - Followed at first, then dropped
3: Consistent    - Maintained through normal operation
4: Robust        - Held under pressure
5: Self-reinforcing - Actively maintained by agent
```

### Decay Metrics

**Decay point**: First moment compliance dropped below 80%

**Decay rate**: How fast compliance dropped after decay point

```
Decay Rate = (Initial compliance - Final compliance) / Context growth

Example:
Initial: 100%, Final: 30%, Context grew 3000 tokens
Decay Rate = (100 - 30) / 3000 = 0.023% per token
```

**Half-life**: Context length at which compliance reaches 50%

### Adversarial Metrics

**Breaking point**: Pressure level at which agent violated instruction

**Resistance score**:

```
Score = (Highest level withstood) / (Total levels) × 100%

Example: Withstood levels 1-3, broke at 4
Score = 3/5 × 100% = 60%
```

### Comparison Metrics

**Relative effectiveness**:

```
Improvement = (Variant compliance - Baseline compliance) / Baseline × 100%
```

**Multi-dimensional comparison**:
| Metric | Variant A | Variant B | Winner |
|--------|-----------|-----------|--------|
| Compliance | 70% | 85% | B |
| Decay resistance | Low | High | B |
| Naturalness | 4/5 | 3/5 | A |
| Weighted score | 2.1 | 2.6 | B |

---

## Step 3: Diagnosis

### Root Cause Categories

**Visibility problems** (Instruction not noticed):

- Instruction buried in large prompt
- No formatting emphasis
- Competing instructions

**Salience problems** (Noticed but not prioritized):

- Instruction feels optional
- No consequences stated
- Weaker than other instructions

**Decay problems** (Followed then forgotten):

- Long context diluted attention
- No reinforcement mechanism
- Task complexity overwhelmed

**Anchoring problems** (Bypassed under pressure):

- Instruction framed as rule, not identity
- No tool/format reinforcement
- Agent found "reasonable" exception

### Diagnostic Questions

Ask these to identify root cause:

1. **Was the instruction visible?**
   - Check if agent ever acknowledged it
   - If never mentioned → Visibility problem

2. **Was it prioritized initially?**
   - Check early compliance
   - If partial from start → Salience problem

3. **When did compliance drop?**
   - Check decay curve
   - If gradual drop → Decay problem

4. **What triggered the drop?**
   - Check what agent was doing
   - Complexity increase? → Decay
   - User pressure? → Anchoring
   - Context switch? → Visibility

5. **Did agent negotiate or just violate?**
   - Negotiation → Agent aware but conflicted
   - Silent violation → Instruction forgotten

---

## Step 4: Prescription

### Matching Solutions to Diagnoses

| Diagnosis  | Primary Solution        | Secondary Solutions    |
| ---------- | ----------------------- | ---------------------- |
| Visibility | Reposition, emphasize   | Format, repeat         |
| Salience   | Stronger language       | Consequences, examples |
| Decay      | Reinforcement technique | Shorter instructions   |
| Anchoring  | Identity framing        | Tool/format anchoring  |

### Solution Patterns

**For visibility**:

```
Before: Instruction buried in paragraph
After:  ## IMPORTANT: [Instruction] (header, top of section)
```

**For salience**:

```
Before: "Please use file:line format"
After:  "ALWAYS use file:line format. References without
         line numbers are incomplete."
```

**For decay**:

```
Before: [Instruction at start]
After:  [Instruction at start]
        + Self-echo requirement
        + Checkpoint every 3 responses
```

**For anchoring**:

```
Before: "Follow this rule: [X]"
After:  "You are [identity that naturally does X].
         This isn't a rule—it's who you are."
```

### Solution Combinations

For critical constraints, layer solutions:

```
Layer 1: Identity framing (deep anchoring)
Layer 2: Tool anchoring (observable compliance)
Layer 3: Format requirement (implicit checkpoint)
Layer 4: Periodic self-echo (attention refresh)
```

---

## Step 5: Verification

### Re-testing Protocol

1. Apply the prescribed changes
2. Run the same experiment again
3. Compare results:
   - Did compliance improve?
   - Did decay slow?
   - Did adversarial resistance increase?
4. Check for side effects:
   - Output naturalness
   - Task completion quality
   - Verbosity cost

### Iteration Criteria

**Success**: Compliance improved to acceptable level

**Partial success**: Improvement seen, but not sufficient

- Apply additional solutions
- Consider different approach

**Failure**: No improvement or regression

- Re-diagnose (root cause might be wrong)
- Try fundamentally different approach

---

## Analysis Templates

### Compliance Analysis Template

```markdown
## Observation

[What did the agent do? Quote specific outputs.]

## Measurement

- Compliance rate: X%
- Strength level: N/5
- Key failures: [list specific non-compliant outputs]

## Diagnosis

- Root cause: [visibility | salience | decay | anchoring]
- Evidence: [why you think this is the cause]
- Contributing factors: [other relevant factors]

## Prescription

- Primary solution: [specific change]
- Implementation: [exact new wording]
- Expected improvement: [what should change]

## Verification Plan

- Re-test with: [same experiment]
- Success criteria: [specific metric targets]
```

### Decay Analysis Template

```markdown
## Decay Curve

| Phase | Token Count | Compliance | Notes |
| ----- | ----------- | ---------- | ----- |
| 1     | 500         | X%         |       |
| 2     | 1500        | X%         |       |
| 3     | 3000        | X%         |       |
| 4     | 5000        | X%         |       |

## Decay Point

- First drop below 80%: Phase N, ~X tokens
- Trigger: [what was happening]

## Root Cause Analysis

[Why did decay occur at this point?]

## Reinforcement Recommendation

- Technique: [self-echo | tool | checkpoint | identity | format]
- Implementation: [specific addition to instruction]
- Expected half-life improvement: [estimate]
```

### Comparison Analysis Template

```markdown
## Variants Tested

| Variant | Description         |
| ------- | ------------------- |
| A       | [brief description] |
| B       | [brief description] |

## Results Matrix

| Metric                 | A   | B   | Winner |
| ---------------------- | --- | --- | ------ |
| Compliance             |     |     |        |
| Decay resistance       |     |     |        |
| Adversarial resistance |     |     |        |
| Naturalness            |     |     |        |
| **Overall**            |     |     |        |

## Winner Analysis

- Why it performed better: [analysis]
- Trade-offs accepted: [what was sacrificed]

## Recommendation

- Use variant [X] because [reasoning]
- Consider combining [specific elements from each]
```

---

## Common Patterns

### Pattern: Sharp Decay at Complexity

**Observation**: Compliance high until task becomes complex, then drops sharply.

**Diagnosis**: Working memory overwhelmed; instruction pushed out.

**Solution**: Add explicit checkpoint before complex phases:

```
Before starting complex work, pause and verify:
- What instruction am I following?
- Am I still tracking my tasks?
```

### Pattern: Negotiation Before Violation

**Observation**: Agent tries to find exceptions or workarounds before violating.

**Diagnosis**: Instruction recognized but not strongly anchored.

**Solution**: Strengthen with identity + consequences:

```
You are a [identity]. [Violation] would contradict who you are.
There are no valid exceptions.
```

### Pattern: Format Compliance, Spirit Violation

**Observation**: Agent follows letter of instruction but misses intent.

**Diagnosis**: Instruction too mechanical; agent optimizing for form.

**Solution**: Add purpose explanation:

```
We use file:line format because readers need to navigate quickly.
The goal is reader convenience, not format compliance.
```

### Pattern: Early Acknowledgment, Later Forgetting

**Observation**: Agent explicitly acknowledges instruction early, then forgets.

**Diagnosis**: Acknowledgment satisfied the "instruction received" sense; no ongoing reminder.

**Solution**: Require ongoing acknowledgment (self-echo):

```
At the start of each response, note which key instructions
you're following. This keeps them active.
```
