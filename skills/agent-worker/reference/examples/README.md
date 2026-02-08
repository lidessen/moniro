# Workflow Examples

Complete, runnable workflow examples for common use cases.

## Quick Start

```bash
# Run any example
agent-worker run examples/pr-review.yaml

# With custom tag
agent-worker run examples/research.yaml --tag investigation-123

# Keep agents alive
agent-worker start examples/architecture-decision.yaml
```

---

## Examples

### 1. PR Review (`pr-review.yaml`)

**Use case**: Multi-perspective code review with security, performance, and style checks.

**Agents**:
- `security` - Security vulnerability analysis
- `performance` - Performance bottleneck detection
- `style` - Code style and readability
- `synthesizer` - Combines findings into final report

**How to run**:
```bash
PR_NUMBER=123 agent-worker run examples/pr-review.yaml --tag pr-123
```

**Expected flow**:
1. Fetches PR diff via `gh pr diff`
2. Three reviewers analyze in parallel
3. Synthesizer compiles comprehensive report
4. Results written to shared document

---

### 2. Research & Synthesis (`research.yaml`)

**Use case**: Deep research with multiple agents exploring different angles, then synthesizing findings.

**Agents**:
- `researcher-a` - Primary angle investigation
- `researcher-b` - Alternative angle investigation
- `researcher-c` - Edge cases and counterarguments
- `synthesizer` - Creates comprehensive report

**How to run**:
```bash
TOPIC="Agent framework design patterns" agent-worker run examples/research.yaml
```

**Expected flow**:
1. Three researchers investigate in parallel
2. Share findings via channel and document
3. Synthesizer reads all findings and creates summary
4. Output saved to `./research-output/`

---

### 3. Test Generation (`test-gen.yaml`)

**Use case**: Automated test generation from source code analysis.

**Agents**:
- `analyzer` - Identifies test cases from code
- `generator` - Writes test code
- `validator` - Reviews generated tests for coverage

**How to run**:
```bash
FILE_PATH=src/utils.ts agent-worker run examples/test-gen.yaml
```

**Expected flow**:
1. Analyzer reads source file and lists test scenarios
2. Generator creates test code for each scenario
3. Validator checks coverage and edge cases
4. Final tests written to document

---

### 4. Architecture Decision (`architecture-decision.yaml`)

**Use case**: Collaborative architecture decision with discussion and voting.

**Agents**:
- `architect-a` - Advocates for approach A
- `architect-b` - Advocates for approach B
- `moderator` - Facilitates discussion and manages voting

**How to run**:
```bash
agent-worker run examples/architecture-decision.yaml
```

**Expected flow**:
1. Each architect presents their approach with trade-offs
2. Moderator creates proposal with both options
3. Architects vote with reasoning
4. Decision recorded in document

---

### 5. Bug Investigation (`bug-investigation.yaml`)

**Use case**: Parallel hypothesis testing for complex bugs.

**Agents**:
- `hypothesis-memory-leak` - Investigates memory issues
- `hypothesis-race-condition` - Investigates concurrency issues
- `hypothesis-config-error` - Investigates configuration issues
- `coordinator` - Aggregates findings and recommends action

**How to run**:
```bash
BUG_REPORT="App crashes after 24h uptime" agent-worker run examples/bug-investigation.yaml
```

**Expected flow**:
1. Three investigators work in parallel on different theories
2. Each shares findings via channel
3. Coordinator evaluates evidence and recommends fix
4. Investigation log saved to document

---

### 6. Documentation Generation (`doc-gen.yaml`)

**Use case**: Generate comprehensive documentation from codebase.

**Agents**:
- `api-documenter` - Documents public APIs
- `guide-writer` - Writes user guides
- `example-creator` - Creates code examples
- `editor` - Reviews and polishes all content

**How to run**:
```bash
REPO_PATH=/path/to/repo agent-worker run examples/doc-gen.yaml
```

**Expected flow**:
1. Three writers work on different doc types in parallel
2. Each writes to shared document in designated sections
3. Editor reviews, fixes inconsistencies, and finalizes
4. Complete docs exported from document

---

### 7. CI/CD Validation (`ci-validation.yaml`)

**Use case**: Multi-stage validation before deployment.

**Agents**:
- `test-runner` - Runs test suite and reports results
- `security-scanner` - Runs security checks
- `performance-checker` - Validates performance benchmarks
- `deployer` - Makes deployment decision based on all checks

**How to run**:
```bash
COMMIT_SHA=abc123 agent-worker run examples/ci-validation.yaml
```

**Expected flow**:
1. Three validators run checks in parallel
2. Each reports status (pass/fail/warning) to channel
3. Deployer creates proposal to proceed or block
4. Decision and logs saved to document

---

## Tips

**Environment variables**: Use `${{ env.VAR }}` in kickoff messages to inject runtime context.

**Tags for isolation**: Use `--tag` to run multiple instances of the same workflow without interference.

**Persistent data**: Configure `context.config.bind` to persist documents across runs.

**Monitoring**: Use `agent-worker peek @workflow:tag` to watch agent conversations in real-time.

**Debugging**: Add `--debug` flag to see detailed execution logs.

---

## Customization

All examples are templates. Modify them for your needs:

1. **Change models**: Update `model:` field per agent
2. **Adjust prompts**: Edit `system_prompt:` for different behaviors
3. **Add tools**: Include `tools:` field for custom tools (SDK backend)
4. **Modify setup**: Change `setup:` commands to fetch different data
5. **Tweak kickoff**: Edit `kickoff:` message to change initial instructions
