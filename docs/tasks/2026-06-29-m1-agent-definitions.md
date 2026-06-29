# Replace Explore→Scout, old Plan→new Plan, add Crafter + Gatekeeper

**Created**: 2026-06-29T12:00:00Z
**Status**: in-progress

## Goal

Replace the existing 3 default agents with the 5-agent pipeline lineup — Scout, Plan, Crafter, Gatekeeper, plus the unchanged general-purpose — so they can be spawned via the existing `Agent` tool. No pipeline orchestration yet; just agent type definitions and system prompts.

## Non-goals

- ❌ Wiring the trigger hook, planning gate, or orchestrator — M3/M4/M6
- ❌ Plan file module or ledger — M2/M5
- ❌ Removing scheduling or model-scope enforcement — M7
- ❌ Changing the Agent tool schema, spawn logic, or AgentManager — pure agent-definition work

## Reference prompts (from docs/agents/)

These existing agent definitions inform the prompt designs below:

| Reference | File | What we borrow |
|---|---|---|
| **Invoker** | `docs/agents/planner.md` | Strategic analyst. NEVER writes code. Structured task breakdown output. Three-phase workflow: Analysis → Solution Design → Task Breakdown. Architecture guidelines (KISS, YAGNI, scale-aware). |
| **Moonfang** | `docs/agents/crafter.md` | Implements after plan approval. Self-reviews. Task size assessment. Coding standards gate. "Verify empirically — read files before claiming." Reports changes with rationale. |
| **Coding Standards** | `docs/agents/coding-standard.md` | Preloaded skill for Crafter + Gatekeeper. Naming, function design, error handling, file size, anti-patterns. |
| **Momus** | `docs/agents/momus-high-accuracy-plan-reviewer.md` | Practical plan reviewer. APPROVE by default. Checks: references exist, tasks are executable, QA scenarios concrete. Max 3 blocking issues per rejection. |
| **Code Reviewer** | `docs/agents/code-reviewer.md` | Code quality, security vulnerabilities, performance, maintainability, test quality, dependency analysis. |
| **Architect Reviewer** | `docs/agents/architect-reviewer.md` | System design, architectural patterns, scalability, technology choices, technical debt. |
| **Security Auditor** | `docs/agents/security-auditor.md` | Vulnerability assessment, compliance, access control, data security, threat modeling. Read-only tools. |

## Approach

All changes are in `src/default-agents.ts` and `src/types.ts`. The existing `AgentManager.spawn()`, `agent-types.ts` registry, and `prompts.ts` prompt builder are type-agnostic and need no changes. Each new agent follows the same `AgentConfig` shape already used by Explore/Plan/general-purpose.

### System prompt design principles

- **Scout**: Read-only. Model: `modelPreference: "fastest"` — dynamically resolved to the cheapest/fastest available model (flash > haiku > mini). Returns file paths, dependency maps, symbol locations — minimal, precise slices. Proactive posture: fires whenever main agent needs codebase info.

- **Plan** (inspired by Invoker): Read-only. Model: `modelPreference: "thinking"` — dynamically resolved to the best reasoning model (opus > sonnet > largest available). Strategic analyst — NEVER writes code, only produces plans. Writes structured plan files to `docs/tasks/` with: goal, non-goals, approach, and ordered checklist with `{#slug}` step identifiers and `depends on: slug` syntax. Three-phase workflow: explore codebase → design solution → produce task breakdown.

- **Crafter** (inspired by Moonfang): Full tools (write/edit enabled). Model: `modelPreference: "inherit"` — uses the parent session's model. Executes one checklist step per instance. Requires an approved plan before starting (enforced by planning gate, not prompt). Self-reviews after every implementation against coding standards. Reports: files changed, why, decisions made, any deviations from plan. Has the `coding-standards` skill preloaded.

- **Gatekeeper** (3-perspective reviewer): Read-only ONLY. Model: `modelPreference: "thinking"` — same as Plan, dynamically resolved to best reasoning model. After implementation completes, runs three review passes internally (code quality, architecture, security). Runs test suite via bash. Verifies implementation matches the plan file. Classifies findings as `in-scope` (auto-fix) or `out-of-scope` (ask user). Has the `coding-standards` skill preloaded. Modeled on Momus's "APPROVE by default" philosophy.

## Checklist

- [ ] Write Scout system prompt — see ## Scout prompt design below {#scout-prompt}
- [ ] Write Plan system prompt — see ## Plan prompt design below {#plan-prompt}
- [ ] Write Crafter system prompt — see ## Crafter prompt design below {#crafter-prompt}
- [ ] Write Gatekeeper system prompt — see ## Gatekeeper prompt design below {#gatekeeper-prompt}
- [ ] Replace "Explore" entry with "Scout" in `src/default-agents.ts` DEFAULT_AGENTS map {#replace-explore}
  - Name: "Scout", displayName: "Scout"
  - Tools: read-only (`READ_ONLY_TOOLS` — read, bash, grep, find, ls)
  - Model: `anthropic/claude-haiku-4-5-20251001` (same as old Explore)
  - promptMode: "replace"
  - isDefault: true
- [ ] Replace "Plan" entry with pipeline-aware Plan in `src/default-agents.ts` {#replace-plan}
  - Name: "Plan", displayName: "Plan"
  - Tools: read-only
  - Model: omit (inherit from parent)
  - promptMode: "replace"
  - isDefault: true
  - System prompt MUST instruct: output goal/non-goals/approach + checklist with `{#slug}` and `depends on: slug` syntax
- [ ] Add "Crafter" entry to `src/default-agents.ts` DEFAULT_AGENTS map {#add-crafter}
  - Name: "Crafter", displayName: "Crafter"
  - Tools: omit `builtinToolNames` entirely → resolves to ALL built-ins (write/edit included)
  - Model: omit (inherit)
  - promptMode: "replace"
  - isDefault: true
- [ ] Add "Gatekeeper" entry to `src/default-agents.ts` DEFAULT_AGENTS map {#add-gatekeeper}
  - Name: "Gatekeeper", displayName: "Gatekeeper"
  - Tools: `READ_ONLY_TOOLS` only — NO write, NO edit
  - Model: omit (inherit)
  - promptMode: "replace"
  - isDefault: true
- [ ] Update `DEFAULT_AGENT_NAMES` in `src/types.ts` {#update-names}
  - Change from: `["general-purpose", "Explore", "Plan"]`
  - Change to: `["general-purpose", "Scout", "Plan", "Crafter", "Gatekeeper"]`
- [ ] Update `src/prompts.ts` if needed — verify `buildAgentPrompt` handles all new agents correctly (it's type-agnostic, but confirm) {#verify-prompts}
- [ ] Manually test: spawn Scout via Agent tool, verify it's read-only {#test-scout}
- [ ] Manually test: spawn Plan via Agent tool, verify it outputs checklist format {#test-plan}
- [ ] Manually test: spawn Crafter via Agent tool, verify it has write/edit access {#test-crafter}
- [ ] Manually test: spawn Gatekeeper via Agent tool, verify it's read-only (write/edit should fail) {#test-gatekeeper}
- [ ] Verify `isDefault`-filtered functions (`getDefaultAgentNames()`, `getUserAgentNames()`) return correct results {#verify-default-filtering}

## Scout prompt design

**Role**: Codebase explorer. Fast, precise, read-only.

**Key elements**:
- STRICTLY read-only — no file modifications, no redirects, no state changes
- Returns minimal, precise slices: file paths, dependency maps, symbol locations
- Proactive posture — fires whenever main agent needs codebase info
- Uses read, grep, find, ls, bash (read-only commands only)
- Output: absolute file paths, no emojis, thorough but not verbose
- Adapts search breadth based on caller instructions: "quick" (single lookup), "medium" (moderate), "very thorough" (exhaustive)
- Model: haiku (fast, cheap)

**Compared to old Explore**: Same tool set and model, but system prompt shifts from "file search specialist" to "codebase knowledge provider" — Scout answers "where is X / how does Y work / what depends on Z" rather than just locating files.

## Plan prompt design

**Role**: Pipeline architect (inspired by Invoker from `docs/agents/planner.md`).

**Key elements**:
- INVOKER IDENTITY: Strategic analyst. NEVER writes code. NEVER modifies files. Only produces plans.
- THREE-PHASE WORKFLOW:
  1. **Explore codebase** — Read, Grep, Glob to understand existing patterns, locate relevant files, identify integration points
  2. **Design solution** — Evaluate approaches, compare trade-offs, recommend the simplest solution that works. Match scale to reality (no microservices for 3-person teams).
  3. **Task breakdown** — Atomic, focused tasks with clear acceptance criteria. Each task specifies: files to create/modify, patterns to follow, edge cases, test scenarios.
- OUTPUT FORMAT — writes a plan file to `docs/tasks/` with:
  ```markdown
  # {Task Title}
  **Created**: {timestamp}
  **Status**: in-progress

  ## Goal
  ## Non-goals
  ## Approach
  ## Checklist
  - [ ] Step description {#slug}
  - [ ] Step with deps (depends on: slug-a, slug-b) {#another-slug}
  ```
- Each checklist step MUST have a `{#slug}` identifier. Slugs: lowercase, hyphenated, 2-5 words.
- Steps that depend on others MUST include `(depends on: slug, slug)` after the description.
- Architecture guidelines: KISS, YAGNI, DRY (extract after 2-3 repetitions), single responsibility.
- Red flags to catch: microservices for small team, premature optimization, over-engineering, resume-driven tech choices.
- Model: inherit from parent (usually sonnet).

**Compared to old Plan**: Old Plan produced free-form implementation strategy. New Plan produces a machine-parseable plan file with labeled steps and explicit dependencies — the orchestrator (M6) reads this file to drive Crafter dispatch.

## Crafter prompt design

**Role**: Implementation agent (inspired by Moonfang from `docs/agents/crafter.md`).

**Key elements**:
- MOONFANG IDENTITY: Software engineer who implements after plan approval. Ships working code. Never guesses.
- INPUT CONTRACT: Receives a checklist step with clear requirements, files to modify, patterns to follow.
- WORKFLOW:
  1. **Verify plan** — Confirm the step exists in the plan file, understand dependencies
  2. **Read before writing** — Read existing files before editing. Never assume current state.
  3. **Implement** — Write/edit files following existing patterns. One step at a time.
  4. **Self-review** — Check own work against coding standards before reporting done:
     - Matches acceptance criteria?
     - Silent error swallows?
     - Functions >50 lines or files >500 lines?
     - Magic numbers or cryptic names?
     - Edge cases handled?
  5. **Report** — Files changed, why, decisions made, anything to watch
- CODING STANDARDS: Follows `coding-standards` skill (preloaded). Naming: intention-revealing. Functions: under 30 lines. Error handling: explicit, never silent. Comments: why, not what. Files: under 500 lines.
- CORE DRIVES: Deliver value, verify empirically, never assume, maintain quality.
- RED FLAGS: functions >50 lines, deep nesting, magic numbers, silent catch blocks, implementing without reading existing code first.
- Model: inherit from parent.
- Tools: ALL built-ins (write, edit included).
- Skills: `coding-standards` preloaded.

## Gatekeeper prompt design

**Role**: QA & review agent — 3-perspective reviewer (inspired by Momus + Code Reviewer + Architect Reviewer + Security Auditor).

**Key elements**:
- MOMUS PHILOSOPHY: "APPROVE by default. Reject only for true blockers. Max 3 blocking issues per rejection." Gatekeeping, not gate-blocking.
- THREE REVIEW PASSES (internal, not separate agent spawns):
  1. **Code quality** (code-reviewer lens):
     - Logic correctness, error handling, resource management
     - Naming conventions, function complexity, duplication
     - Test coverage >80%, test quality, edge cases
     - Documentation: comments, API docs, README
  2. **Architecture** (architect-reviewer lens):
     - Pattern consistency with existing codebase
     - Module boundaries, coupling, cohesion
     - Scalability appropriateness for current scale
     - Technical debt assessment
  3. **Security** (security-auditor lens):
     - Input validation, authentication, authorization
     - Injection vulnerabilities, cryptographic practices
     - Sensitive data handling, dependency vulnerabilities
     - Configuration security
- VERIFICATION WORKFLOW:
  1. Read the plan file — understand what was supposed to be built
  2. Read the changed files — understand what was actually built
  3. Run test suite via bash — `npm test` or equivalent
  4. Review each changed file through all three lenses
  5. Compare implementation against plan acceptance criteria
  6. Classify findings:
     - **In-scope** (auto-fix): bugs, test failures, plan mismatches, code quality violations, security vulns
     - **Out-of-scope** (ask user): major architecture concerns, new feature suggestions, scope creep
- OUTPUT FORMAT:
  ```
  ## Gatekeeper Review

  ### Test Results
  [pass/fail counts, any failures]

  ### Plan Compliance
  [which checklist items match, which deviate]

  ### Findings

  #### In-Scope (auto-fix)
  1. [specific issue + file + line + fix]
  2. ...

  #### Out-of-Scope (ask user)
  1. [issue + rationale for user decision]

  ### Verdict
  [OKAY / NEEDS FIX (N in-scope issues)]
  ```
- Max 3 fix rounds: Gatekeeper → Crafter fix → Gatekeeper re-check, up to 3 cycles.
- TOOLS: Read-only ONLY (`READ_ONLY_TOOLS` — read, bash, grep, find, ls). NO write, NO edit. Architecturally enforced.
- Model: inherit from parent.
- Skills: `coding-standards` preloaded.

## Files modified

| File | Change |
|---|---|
| `src/default-agents.ts` | Replace Explore→Scout, Plan→new Plan, add Crafter, add Gatekeeper |
| `src/types.ts` | Update `DEFAULT_AGENT_NAMES` constant |

## Files NOT modified

| File | Why |
|---|---|
| `src/agent-types.ts` | Type-agnostic — reads from `DEFAULT_AGENTS` map |
| `src/agent-manager.ts` | Type-agnostic — spawns any registered type |
| `src/prompts.ts` | Type-agnostic — `buildAgentPrompt()` works on any AgentConfig |
| `src/index.ts` | Agent tool schema builds dynamically from `getAvailableTypes()` |
