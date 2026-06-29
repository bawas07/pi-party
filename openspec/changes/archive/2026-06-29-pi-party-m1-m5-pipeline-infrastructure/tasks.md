## 1. Milestone 1 — Agent Definitions + Model Auto-Assignment (src/default-agents.ts, src/types.ts, src/model-resolver.ts, src/settings.ts)

- [x] 1.1 Add `ModelPreference` type (`"fastest" | "thinking" | "inherit"`) to `src/types.ts`
- [x] 1.2 Add optional `modelPreference` field to `AgentConfig` interface in `src/types.ts`
- [x] 1.3 Add `modelPreferences` setting (`{ thinking?: string, fast?: string }`) to `SubagentsSettings` in `src/settings.ts` with sanitization
- [x] 1.4 Wire `modelPreferences` into `applySettings()` / `applyAndEmitLoaded()` in `src/settings.ts`
- [x] 1.5 Implement `selectModel(preference, registry, parentModel?, modelPreferences?)` in `src/model-resolver.ts`: config-first (check `modelPreferences.thinking`/`modelPreferences.fast`), fallback to auto (context window ascending for fastest, descending for thinking)
- [x] 1.6 Write Scout system prompt — codebase explorer, proactive posture, returns minimal precise slices
- [x] 1.7 Write Plan system prompt — pipeline architect (Invoker-inspired), NEVER writes code, outputs structured plan files with checklist `{#slug}` syntax
- [x] 1.8 Write Crafter system prompt — implementation agent (Moonfang-inspired), full tools, self-review, coding-standards skill, reports changes with rationale
- [x] 1.9 Write Gatekeeper system prompt — QA agent (3-lens reviewer: code + architecture + security), read-only, Momus philosophy of "approve by default"
- [x] 1.10 Replace "Explore" with "Scout" in `src/default-agents.ts` DEFAULT_AGENTS map (read-only, `modelPreference: "fastest"`, replace mode)
- [x] 1.11 Replace old "Plan" with pipeline-aware Plan in `src/default-agents.ts` (read-only, `modelPreference: "thinking"`, replace mode)
- [x] 1.12 Add "Crafter" to `src/default-agents.ts` DEFAULT_AGENTS map (all tools by omission, `modelPreference: "inherit"`, replace mode, coding-standards skill)
- [x] 1.13 Add "Gatekeeper" to `src/default-agents.ts` DEFAULT_AGENTS map (READ_ONLY_TOOLS only, `modelPreference: "thinking"`, replace mode, coding-standards skill)
- [x] 1.14 Update `DEFAULT_AGENT_NAMES` in `src/types.ts` to `["general-purpose", "Scout", "Plan", "Crafter", "Gatekeeper"]`
- [x] 1.15 Verify `buildAgentPrompt` in `src/prompts.ts` handles all new agent configs (type-agnostic, but confirm)
- [x] 1.16 Unit test: `selectModel("fastest")` with config set → returns configured model directly
- [x] 1.17 Unit test: `selectModel("thinking")` with config set → returns configured model directly
- [x] 1.18 Unit test: `selectModel("fastest")` without config → returns smallest context window model
- [x] 1.19 Unit test: `selectModel("thinking")` without config → returns largest context window model
- [x] 1.20 Unit test: `selectModel("inherit")` returns parent model; falls back to thinking when parent unavailable
- [x] 1.21 Unit test: configured model not in registry → warning + auto-fallback
- [x] 1.22 Unit test: no models available → descriptive error
- [x] 1.23 Manual test: spawn Scout, verify it gets the fast model (config or smallest context)
- [x] 1.24 Manual test: spawn Plan, verify it gets the thinking model (config or largest context)
- [x] 1.25 Manual test: spawn Crafter, verify it inherits parent model
- [x] 1.26 Manual test: spawn Gatekeeper, verify read-only + thinking model
- [x] 1.27 Verify `getDefaultAgentNames()` and `getUserAgentNames()` return correct results with new defaults

## 2. Milestone 2 — Plan File Module (src/plan-file.ts)

- [x] 2.1 Create `src/plan-file.ts` with module skeleton and `ParsedStep` interface export
- [x] 2.2 Implement `ensureDirs()` — creates `docs/tasks/` and `docs/tasks/archived/` on demand
- [x] 2.3 Implement `writePlan(task, title, content)` — writes plan file with template, returns path
- [x] 2.4 Implement `readPlan(path)` — returns file contents as UTF-8 string
- [x] 2.5 Implement `checkOffStep(path, slug)` — finds `{#slug}` line, replaces `[ ]` with `[x]`, idempotent
- [x] 2.6 Implement `findExisting(task)` — scans `docs/tasks/`, matches by title substring, returns path or null
- [x] 2.7 Implement `archive(path)` — moves file to `docs/tasks/archived/`
- [x] 2.8 Implement `parseChecklist(content)` — shared parser for checklist extraction (slugs, checked status, dependencies)
- [x] 2.9 Implement `unblockedSteps(path)` — resolves dependencies, returns slugs of unblocked unchecked steps; unknown deps don't block
- [x] 2.10 Implement `translateExternalSpec(externalPath)` — reads user spec, extracts work items + infers deps, returns internal checklist string (does NOT write files)
- [x] 2.11 Create `test/plan-file.test.ts` with unit tests for all operations
- [x] 2.12 Unit test: `writePlan` + `readPlan` round-trip
- [x] 2.13 Unit test: `checkOffStep` marks correct line, idempotent on already-checked
- [x] 2.14 Unit test: `unblockedSteps` — no deps (all unblocked), deps satisfied (unblocked), deps unsatisfied (blocked), unknown deps (don't block), already-checked (excluded)
- [x] 2.15 Unit test: `findExisting` matches by title, returns null on miss
- [x] 2.16 Unit test: `archive` moves file correctly
- [x] 2.17 Unit test: `parseChecklist` edge cases — empty checklist, no slugs, duplicate slugs, multi-line descriptions
- [x] 2.18 Unit test: `translateExternalSpec` with sample spec file — verify checklist output

## 3. Milestone 3 — Trigger Hook (src/trigger.ts)

- [x] 3.1 Research available pi ExtensionAPI hooks — confirm which event gives access to turn context before agent acts (current assumption: `tool_execution_start`)
- [x] 3.2 Create `src/trigger.ts` with `TurnContext` and `TriggerResult` interfaces
- [x] 3.3 Implement `noPlanIntent(ctx)` — pattern-based: explicit skip-planning language only; NOT triggered by casual/brief phrasing
- [x] 3.4 Implement `implementIntent(ctx)` — three-tier: high (build/create/implement/refactor), medium (how would I/should I), low (everything else); only called when `noPlanIntent` is false
- [x] 3.5 Implement `needsScout(ctx)` — binary: needs codebase knowledge? Excludes file-tree lookups, config/md files, already-known paths
- [x] 3.6 Implement `evaluateAll(ctx)` — runs all three hooks, returns combined `TriggerResult`
- [x] 3.7 Create `test/trigger.test.ts` with unit tests
- [x] 3.8 Unit test: `noPlanIntent` — "no need to plan, just implement directly" → true
- [x] 3.9 Unit test: `noPlanIntent` — "just fix it" → false (casual, not explicit)
- [x] 3.10 Unit test: `noPlanIntent` — no planning language → false
- [x] 3.11 Unit test: `implementIntent` — "build a login system" → high
- [x] 3.12 Unit test: `implementIntent` — "how would I build a login system?" → medium
- [x] 3.13 Unit test: `implementIntent` — "what does git status do?" → low
- [x] 3.14 Unit test: `implementIntent` — "refactor the auth module to use JWT" → high
- [x] 3.15 Unit test: `needsScout` — "where is the auth middleware defined?" → true
- [x] 3.16 Unit test: `needsScout` — "read package.json" → false (config file exclusion)
- [x] 3.17 Unit test: `needsScout` — "list all .ts files in src/" → false (file-tree exclusion)
- [x] 3.18 Unit test: `evaluateAll` returns correct combined result; no-plan overrides implement-intent

## 4. Milestone 4 — Planning Gate (src/planning-gate.ts)

- [x] 4.1 Create `src/planning-gate.ts` with `PlanningGateInput` and `PlanningGateResult` interfaces
- [x] 4.2 Implement `isWriteCapable(typeName)` — uses `getToolNamesForType()` from `agent-types.ts`, returns true if tool set includes "write" or "edit"
- [x] 4.3 Implement `checkPlanningGate(input)` — noPlanIntent bypass → allowed; read-only type → allowed; hasApprovedPlan → allowed; otherwise → rejected with message
- [x] 4.4 Create `test/planning-gate.test.ts` with unit tests
- [x] 4.5 Unit test: Crafter (write-capable) without plan → rejected
- [x] 4.6 Unit test: Crafter with approved plan → allowed
- [x] 4.7 Unit test: Scout (read-only) without plan → allowed
- [x] 4.8 Unit test: Gatekeeper (read-only) without plan → allowed
- [x] 4.9 Unit test: general-purpose (write-capable by omission) without plan → rejected
- [x] 4.10 Unit test: `noPlanIntent: true` → bypasses gate for write-capable without plan
- [x] 4.11 Unit test: Custom user agent with explicit read-only tools → allowed without plan
- [x] 4.12 Unit test: Custom user agent with all tools (omitted `builtinToolNames`) → rejected without plan

## 5. Milestone 5 — Ledger (src/ledger.ts)

- [x] 5.1 Create `src/ledger.ts` with `LedgerEntry` interface and `Ledger` class
- [x] 5.2 Implement `claim(agentId, files, action?)` — normalizes paths, records entry, replaces existing claim if agentId already tracked
- [x] 5.3 Implement `release(agentId)` — removes claims, returns true if found, false if unknown
- [x] 5.4 Implement `getClaimedFiles()` — returns union Set of all in-flight agents' claimed files
- [x] 5.5 Implement `isClaimed(file)` — normalizes path, checks against all entries
- [x] 5.6 Implement `getConflictingFiles(files)` — returns subset of input files currently claimed by any agent; empty array = no conflicts
- [x] 5.7 Implement `getActiveAgentIds()` — returns IDs of all agents with current claims
- [x] 5.8 Implement `clear()` — resets all state
- [x] 5.9 Create `test/ledger.test.ts` with unit tests
- [x] 5.10 Unit test: `claim` adds entry, `getClaimedFiles` returns union of all claims
- [x] 5.11 Unit test: `release` removes entry, `getClaimedFiles` no longer includes those files; returns false for unknown agent
- [x] 5.12 Unit test: `getConflictingFiles` — all free (empty), partially claimed (subset), fully claimed (all)
- [x] 5.13 Unit test: `claim` twice for same agentId → replaces, old files released
- [x] 5.14 Unit test: Two agents claim disjoint files → `getConflictingFiles` for B's files returns empty
- [x] 5.15 Unit test: Two agents claim overlapping files → `getConflictingFiles` detects the overlap
- [x] 5.16 Unit test: `clear` resets everything
- [x] 5.17 Unit test: Path normalization — relative paths resolved to absolute
- [x] 5.18 Unit test: `getActiveAgentIds` reflects current state after claims and releases
