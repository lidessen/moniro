# Review Strategies

Different projects need different review approaches. Select based on project context.

## Strategy Types

### Conservative

**When to use**:
- Financial services (banking, payments, trading)
- Healthcare systems (patient data, medical devices)
- Infrastructure (deployment, cloud, CI/CD)
- High-compliance (PCI-DSS, HIPAA, SOC2)
- Security-critical systems

**Indicators**:
- Security scanning in CI (SAST, DAST)
- Extensive test coverage (>80%)
- Regulatory comments in code
- Security review requirements in CONTRIBUTING.md
- Slow, cautious release cycle

**Focus areas**:
1. **Security first**: Full threat model review
2. **Risk analysis**: Identify all potential failure modes
3. **Backward compatibility**: Never break existing functionality
4. **Data integrity**: Verify all data changes are safe
5. **Rollback plan**: Ensure deployment can be reverted
6. **Compliance**: Check regulatory requirements met

**Review depth**: Deep, methodical, risk-averse

**Checklist priorities**:
- 🔴 Security vulnerabilities
- 🔴 Data integrity risks
- 🔴 Breaking changes
- 🔴 Compliance violations
- 🟡 Performance issues
- 🔵 Code quality (lower priority)

---

### Balanced

**When to use**:
- Standard web applications
- Internal tools
- Typical SaaS products
- Most commercial software
- Default strategy if uncertain

**Indicators**:
- Modern tech stack (React, Node, Python, etc.)
- CI with tests and linter
- Moderate test coverage (50-80%)
- Regular release cycle (weekly/bi-weekly)
- Standard development practices

**Focus areas**:
1. **Best practices**: Follow industry standards
2. **Maintainability**: Keep code clean and understandable
3. **Common pitfalls**: Avoid typical bugs (N+1, race conditions)
4. **Security**: Check OWASP top 10
5. **Performance**: Catch obvious anti-patterns

**Review depth**: Moderate, pragmatic

**Checklist priorities**:
- 🔴 Security basics (OWASP top 10)
- 🔴 Critical bugs and data issues
- 🟡 Architecture and design
- 🟡 Performance anti-patterns
- 🔵 Code quality improvements

---

### Best Practice

**When to use**:
- Greenfield projects
- Modern, well-tooled stacks
- High-maturity teams
- Open-source libraries/frameworks
- Projects prioritizing quality over speed

**Indicators**:
- Latest framework versions
- Comprehensive tooling (linter, formatter, type checker, pre-commit hooks)
- High test coverage (>90%)
- Continuous deployment
- Modern architecture (microservices, serverless, etc.)

**Focus areas**:
1. **Architecture patterns**: DDD, CQRS, Event Sourcing, etc.
2. **Performance optimization**: Profiling, caching strategies
3. **Modern idioms**: Language-specific best practices
4. **Developer experience**: Clear APIs, good error messages
5. **Observability**: Logging, monitoring, tracing

**Review depth**: High-level architecture + deep technical excellence

**Checklist priorities**:
- 🔴 Architectural soundness
- 🔴 Performance and scalability
- 🟡 Modern patterns and idioms
- 🟡 Code elegance and clarity
- 🔵 Advanced optimizations

---

## Auto-Detection Strategy

Use these indicators to detect strategy automatically:

```bash
# Conservative indicators
[ -f .security-scan.yml ] || [ -f .sonarqube.yml ]
grep -q "HIPAA\|PCI\|SOC2" README.md CONTRIBUTING.md
coverage=$(grep -oP 'coverage.*\K\d+' coverage-report.txt)
[ $coverage -gt 80 ]

# Best Practice indicators
grep -q "typescript.*latest" package.json
[ -f .pre-commit-config.yaml ]
coverage=$(grep -oP 'coverage.*\K\d+' coverage-report.txt)
[ $coverage -gt 90 ]
[ -f .github/workflows/cd.yml ]  # Continuous deployment

# Otherwise: Balanced (default)
```

---

## Strategy-Specific Review Adjustments

### Conservative: Risk Analysis Stage

Add comprehensive risk assessment before detailed review:

**Risk categories**:
1. Security vulnerabilities
2. Data loss scenarios
3. Compliance violations
4. Backward incompatibility
5. Operational risks (downtime, degradation)
6. Regulatory impacts

**Risk matrix**:
```
High Probability + High Impact = BLOCK merge
High Probability + Low Impact = REQUEST changes
Low Probability + High Impact = REQUEST changes
Low Probability + Low Impact = APPROVE with notes
```

**Additional checks**:
- [ ] Threat model reviewed for new features
- [ ] Security team consulted if needed
- [ ] Compliance officer notified of relevant changes
- [ ] Disaster recovery plan updated

---

### Balanced: Pragmatic Best Practices

Focus on common issues that matter in production:

**Practical checks**:
- [ ] Common security issues (OWASP top 10)
- [ ] Obvious performance problems (N+1, missing indexes)
- [ ] Clear error handling (user-facing errors are friendly)
- [ ] Reasonable test coverage (new logic tested)
- [ ] Code is maintainable (not too complex)

**Skip**:
- Advanced optimizations
- Perfect test coverage
- Theoretical security scenarios
- Over-engineering concerns

---

### Best Practice: Architecture & Excellence

Go deep on design and technical quality:

**Architecture review**:
- [ ] SOLID principles followed
- [ ] Design patterns applied appropriately
- [ ] Separation of concerns clear
- [ ] Dependencies flow in one direction
- [ ] Testability designed in

**Technical excellence**:
- [ ] Idiomatic language usage
- [ ] Performance profiled (if relevant)
- [ ] Error messages developer-friendly
- [ ] Logging structured and meaningful
- [ ] Observability considered

**Modern practices**:
- [ ] Immutability preferred
- [ ] Pure functions where possible
- [ ] Type safety maximized
- [ ] Async properly handled
- [ ] Resources managed (RAII, context managers)

---

## When to Ask User

If auto-detection uncertain, ask user to confirm:

**Ask if**:
- No clear indicators found
- Mixed signals (high coverage but no security scanning)
- Unusual tech stack
- Custom tooling

**How to ask**:
> "I've analyzed the project and it seems like a standard web application. Should I use:
> - **Conservative**: Focus heavily on security and risk (financial/healthcare)
> - **Balanced**: Pragmatic best practices (typical web app) ← Default
> - **Best practice**: Deep architecture and technical excellence (greenfield/quality-first)"

---

## Combining Strategy with Size

**Final review depth** = Strategy + Change Size

Examples:

| Strategy | Size | Depth |
|----------|------|-------|
| Conservative | Small | Full risk analysis + thorough review |
| Conservative | X-Large | Risk analysis + critical paths only |
| Balanced | Small | Best practices + quality |
| Balanced | X-Large | Architecture + high-risk only |
| Best Practice | Small | Deep technical review |
| Best Practice | X-Large | Architecture + critical technical decisions |

**Key insight**: Even conservative + X-Large doesn't review everything - still prioritizes based on risk.

---

## Examples

### Conservative Review Output
```markdown
## Risk Analysis
- 🔴 High risk: Database migration affects 10M user records
- 🟡 Medium risk: API change might break mobile app v1.2
- 🟢 Low risk: UI update in admin panel

## Security Assessment
- ✅ No new attack surface
- ⚠️ Input validation needs rate limiting
- ✅ All data encrypted in transit and at rest

## Compliance
- ✅ PCI-DSS: No cardholder data logged
- ✅ GDPR: Personal data handling compliant
```

### Balanced Review Output
```markdown
## Key Issues
- 🔴 Missing authorization check on DELETE endpoint
- 🟡 N+1 query in user list (use eager loading)
- 🔵 Consider extracting validation logic to helper

## Positive
- ✅ Good test coverage
- ✅ Clear error handling
```

### Best Practice Review Output
```markdown
## Architecture
- ✅ Clean separation: Controller → Service → Repository
- 🟡 Consider using Result<T> instead of throwing exceptions
- 🔵 Could benefit from CQRS pattern for complex queries

## Technical Excellence
- ✅ Excellent TypeScript usage (no any, strict mode)
- ✅ Proper async/await throughout
- 🟡 Consider adding distributed tracing spans
```

---

## Review Depth by Change Size

Adapt review focus based on change size to maximize signal-to-noise ratio.

**Core principle**: Focus on problems that **tools cannot catch**. Don't waste time on what lint/typecheck/tests already verify.

### Small Changes (<200 lines, <5 files)

**Can afford detail**:
- Review code quality, naming, structure
- Check edge cases and error handling
- Verify test coverage
- Provide constructive quality feedback

**But still prioritize**:
- Logic correctness
- Security issues
- Edge cases

**Skip**: Formatting (if project has linter), obvious style issues

**Time allocation**: ~10-20 minutes for thorough review

---

### Medium Changes (200-800 lines, 5-20 files)

**Focus on**:
- Architecture and design decisions
- API contracts and signatures
- Data flow and transformations
- Security on critical paths
- Performance considerations

**Ignore**: Style/formatting issues, naming nitpicks

**Key technique**: Signature change analysis
```bash
# Find signature changes
git diff <from>..<to> | grep -E "^[-+].*\b(function|def|class|interface|type|struct)\b"

# For each change, find callers
grep -r "functionName" --include="*.ts" .
```

**Tool-delegated**: Let lint/typecheck catch syntax, types, imports

**Time allocation**: ~30-60 minutes

---

### Large Changes (800-2000 lines, 20-50 files)

**Focus only on**:
- High-risk areas (security, data, breaking changes)
- Architectural decisions and patterns
- Impact of signature changes on call chains
- Breaking changes

**Ignore**: All style/quality issues unless security-critical

**Key technique**: Cherry-pick critical files
- Security: auth, input validation, crypto
- Data: migrations, schema changes
- APIs: public endpoints, contracts

**Impact analysis**: Modified shared functions → validate call chain safety

**Tool-delegated**: All formatting, imports, basic type errors

**Time allocation**: ~1-2 hours (requires progress tracking)

---

### X-Large Changes (>2000 lines, >50 files)

**Focus exclusively on**:
- Critical paths (payments, auth, data integrity)
- Security vulnerabilities
- Breaking changes
- Database migrations

**Ignore**: Everything else

**Requirements**:
- CI must be green (trust tests, lint, types)
- Create progress document (see [progress-tracking.md](progress-tracking.md))
- Multiple review sessions expected

**Impact analysis**: Deep dive on:
- Signature changes in shared utilities
- State modifications in core systems
- Data model evolution

**Skip**: All code quality, style, minor issues

**Time allocation**: 2+ hours, multiple sessions

---

## Depth Strategy Decision Matrix

| Strategy | Size | Focus | Skip | Time |
|----------|------|-------|------|------|
| Conservative | Small | Risk + Quality | Minor style | 20-30 min |
| Conservative | Medium | Risk + Architecture | Style | 45-90 min |
| Conservative | Large | Critical risks only | All quality | 2+ hours |
| Conservative | X-Large | Critical + breaking | Everything else | Multiple sessions |
| Balanced | Small | Quality + logic | Format | 10-20 min |
| Balanced | Medium | Architecture + security | Style | 30-60 min |
| Balanced | Large | High-risk only | Quality | 1-2 hours |
| Balanced | X-Large | Critical only | Everything else | Multiple sessions |
| Best Practice | Small | Excellence + patterns | Format | 15-30 min |
| Best Practice | Medium | Architecture deep | Style | 45-90 min |
| Best Practice | Large | Design + critical | Quality | 2+ hours |
| Best Practice | X-Large | Architecture + critical | Everything else | Multiple sessions |

---

## Tool Responsibility Assumption

Before reviewing, verify what tools are running:

```bash
# Check CI status
gh pr checks  # GitHub
glab mr ci-status  # GitLab

# Common tools
- Linter: eslint, pylint, clippy, rubocop
- Type checker: tsc, mypy, flow
- Tests: jest, pytest, go test
- Security: SAST, Snyk, CodeQL
```

**If CI is green, trust it for**:
- Syntax errors
- Type errors  
- Import errors
- Formatting violations
- Test failures
- Known security patterns

**Exception**: If no CI or tools, adjust depth up one level (Medium → Small depth).

---

## High-Value Details (Always Check)

Regardless of size or strategy, always check these:

### 1. Impact Analysis for Signature Changes

When function/interface signatures change, find all callers:

```bash
# Detect changes
git diff <from>..<to> -- file.ts | grep "^-.*function\|^+.*function"

# Find usage
grep -r "functionName" --include="*.ts" .
```

Verify:
- All call sites compatible with new signature
- Backward compatibility if needed
- No runtime errors from type mismatches

### 2. Data Flow Completeness

When data structures change:

- **New field** → verify: validation, storage, retrieval, display all updated
- **Deleted field** → verify: migration path, backward compatibility
- **Type change** → verify: serialization, DB schema, API contracts aligned

### 3. Security on Critical Paths

When modifying authentication, authorization, or input handling:

- Auth changes → trace full flow (login → session → access check)
- Input handling → verify sanitization and validation
- SQL/queries → check parameterization, injection safety

### 4. Error Path Coverage

When adding new operations:

- New operations have error handling
- Changed exceptions handled by callers
- Async operations have rejection handling

---

## What to Skip (Time-Limited)

**Low-value details**:
- Variable naming (unless truly confusing)
- Code formatting (if linter exists)
- Import organization
- Comment style
- Minor refactoring preferences
- Subjective "cleaner" alternatives

**Let tools handle**:
- Syntax errors
- Type errors
- Unused variables
- Dead code
- Import sorting
- Line length

---

## Quick Reference

**Small**: Full review OK, include quality  
**Medium**: Architecture + impact, skip style  
**Large**: High-risk only, skip quality  
**X-Large**: Critical paths, trust CI, use progress doc

**Always check**: Security, signatures, data flow, breaking changes  
**Always skip**: Format, style, naming (if tools exist)
