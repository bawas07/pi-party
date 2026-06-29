# M7 — Integration: Wire into index.ts + Strip Features

**Created**: 2026-06-29T00:00:00.000Z
**Status**: in-progress

## Goal

Wire all M1–M6 modules into `src/index.ts`, register hooks/commands, strip the scheduling and model-scope features, and connect the event-driven orchestrator to the live extension. This is the milestone where pi-party becomes a working extension instead of a pile of tested-but-unused source files.

## Non-goals

- Not adding new features beyond what's in the roadmap M7 checklist
- Not touching the orchestrator's state machine logic (that's M6 turf)
- Not modifying plan-file, trigger, planning-gate, or ledger modules (those are complete)
- Not changing how AgentManager, AgentWidget, FleetList work internally

## Approach

### Architecture: thin wiring layer in index.ts

M7 is fundamentally a wiring exercise: instantiate the orchestrator, connect the trigger hook to it, place the planning gate in the Agent tool's execute path, register `/summoner`, and delete two features (scheduling + model scope) that are being stripped per the roadmap. The orchestrator already expects dependency injection — we just need to construct it with the right live objects.

The trigger hook uses `pi.on("turn_start", ...)` (confirmed from `ExtensionAPI` types — `TurnStartEvent` fires every turn). The user message for that turn is extracted from `ctx.sessionManager.getEntries()` → most recent `SessionMessageEntry` with `message.role === "user"`.

The planning gate intercepts `Agent` tool execution: before `manager.spawn(...)` or `manager.spawnAndWait(...)`, call `checkPlanningGate()`. A rejection replaces the spawn with a text error result. The `noPlanIntent` bypass flag is managed by the extension (set by trigger hook, cleared after one use).

### Key decisions

1. **Trigger hook is opt-in via a master switch** — `pipelineEnabled` boolean, default `true`. This lets users disable the ambient-trigger behavior without uninstalling the extension. Even when disabled, `/summoner` still works.

2. **`noPlanIntent` is a one-shot flag** — set by the trigger hook on a turn where the user explicitly says "no plan needed". Consumed by the planning gate on the first write-capable spawn of that turn, then cleared. This prevents a single "skip plan" from silently bypassing the gate for multiple unrelated tasks.

3. **`/summoner` is the manual-override command name** — per the roadmap, naming was TBD. `/summoner` wins: it's the name the original PRD used, it's discoverable via `/help`, and it's unambiguous. The task argument is the rest of the command line.

4. **Scheduling removal is surgical** — delete the 3 files, then strip every reference from `index.ts` and `settings.ts`. The `cross-extension-rpc.ts` was already checked: no scheduling references. The `schedule` JSONB field in `AgentInvocation` (types.ts) is an artifact of the upstream tintinweb code and may be present but unused — remove only if referenced.

5. **Model scope removal is simpler than scheduling** — one file (`enabled-models.ts`), one block in `index.ts` agent execute, one settings entry. The scope-check block in the Agent tool `execute` handler is ~25 lines that gate model validation; all of it goes.

6. **Pipeline widget reuses the existing `setWidget` mechanism** — the orchestrator's `updateWidget()` calls `ctx.ui.setWidget("pipeline", rows)`. We just need to ensure the UI context is available; the `tool_execution_start` hook already sets `widget.setUICtx(ctx.ui)`, and we'll extend that to also set the orchestrator's context reference.

7. **Worktree isolation is already wired** — the orchestrator passes `isolation: "worktree"` on every Crafter `manager.spawn()` call. `worktree.ts` is imported by `agent-manager.ts` and used. No changes needed here — verification only.

## Checklist

### Phase 1: Feature Removal (scheduling)

- [ ] Delete `src/schedule.ts`, `src/schedule-store.ts`, `src/ui/schedule-menu.ts` {#delete-schedule-files}
- [ ] Remove scheduling imports from `src/index.ts`: `SubagentScheduler`, `ScheduleStore`, `resolveStorePath`, `showSchedulesMenu` {#remove-schedule-imports}
- [ ] Remove scheduler variable (`const scheduler = new SubagentScheduler()`), `startScheduler()`, and all scheduler wiring in `session_start`, `session_before_switch`, `session_shutdown` {#remove-scheduler-wiring}
- [ ] Remove `schedulingEnabled` flag, `isSchedulingEnabled()`, `setSchedulingEnabled()` from index.ts {#remove-scheduling-flag}
- [ ] Remove `scheduleParamShape`, `scheduleParam`, `scheduleGuideline` and their usage in Agent tool schema (both the param spread and the guideline interpolation) {#remove-schedule-param}
- [ ] Remove `params.schedule` handling block from Agent tool `execute` (~30 lines: schedule validation + `scheduler.addJob()`) {#remove-schedule-execute}
- [ ] Remove "Scheduled jobs" menu entry from `/agents` interactive menu {#remove-schedule-menu-entry}
- [ ] Remove scheduling settings item from `showSettings()` {#remove-schedule-settings}
- [ ] Remove `schedulingEnabled` from `SubagentsSettings` interface in `src/settings.ts` + its sanitization in `sanitize()` + its apply in `applySettings()` {#remove-schedule-settings-ts}
- [ ] Remove `setSchedulingEnabled` from `SettingsAppliers` interface in `src/settings.ts` + its wiring in `applyAndEmitLoaded()` call in index.ts {#remove-schedule-applier}
- [ ] Delete test files: `test/schedule.test.ts`, `test/schedule-store.test.ts`, `test/schedule-e2e.test.ts` {#delete-schedule-tests}

### Phase 2: Feature Removal (model scope enforcement)

- [ ] Delete `src/enabled-models.ts` {#delete-enabled-models}
- [ ] Remove `isModelInScope`, `readEnabledModels`, `resolveEnabledModels` import from `src/index.ts` {#remove-scope-imports}
- [ ] Remove `scopeModelsEnabled` flag, `isScopeModelsEnabled()`, `setScopeModelsEnabled()` from index.ts {#remove-scope-flag}
- [ ] Remove the scope-validation block from Agent tool `execute` (~25 lines: `isScopeModelsEnabled()` check, `resolveEnabledModels`, `isModelInScope`, hard-error return, warning toast) {#remove-scope-execute}
- [ ] Remove scope models settings item from `showSettings()` {#remove-scope-settings}
- [ ] Remove `scopeModels` from `SubagentsSettings` interface in `src/settings.ts` + its sanitization + its apply {#remove-scope-settings-ts}
- [ ] Remove `setScopeModels` from `SettingsAppliers` interface in `src/settings.ts` + its wiring in `applyAndEmitLoaded()` call in index.ts {#remove-scope-applier}
- [ ] Delete test file: `test/enabled-models.test.ts` {#delete-scope-tests}

### Phase 3: Wire into index.ts (orchestrator + trigger + gate)

- [ ] Import Orchestrator, Ledger, and trigger functions into `src/index.ts` {#wire-imports}
- [ ] Instantiate Ledger: `const ledger = new Ledger()` (in-memory only for now; persistence open question per roadmap) {#wire-ledger}
- [ ] Instantiate Orchestrator with deps: `new Orchestrator({ pi, manager, ledger, widget, fleet, getCtx: () => currentCtx })` {#wire-orchestrator}
- [ ] Add `pipelineEnabled` master switch (default `true`) with getter/setter {#wire-pipeline-switch}
- [ ] Add `noPlanIntentFlag` one-shot flag (boolean, cleared after consumption by planning gate) {#wire-noplan-flag}
- [ ] Register trigger hook: `pi.on("turn_start", async (_event, ctx) => { ... })` — extract user message from `ctx.sessionManager.getEntries()`, build `TurnContext`, call `evaluateAll()`, route results {#wire-trigger-hook}
- [ ] Wire trigger results → action: `implementIntent: high` + pipelineEnabled → orchestrator.startPipeline(); `implementIntent: medium` → surface question; `needsScout: true` (independent) → dispatch Scout as background agent; `noPlanIntent: true` → set flag {#wire-trigger-actions}
- [ ] Wire planning gate into Agent tool `execute` — before `manager.spawn()` / `manager.spawnAndWait()`, call `checkPlanningGate({ subagentType, hasApprovedPlan: orchestrator.currentTask?.approved ?? false, noPlanIntent: noPlanIntentFlag })`. On rejection, return `textResult(message)`. Clear `noPlanIntentFlag` after first consumption. {#wire-planning-gate}
- [ ] Register `/summoner <task>` command: `pi.registerCommand("summoner", ...)` — parses task from args, calls `orchestrator.startPipeline({ task, title: task, content: task, needsScout: true })` {#wire-summoner-command}
- [ ] Register `/pipeline` as alias for `/summoner` (both call same handler) {#wire-pipeline-alias}
- [ ] Wire orchestrator disposal: on `session_shutdown`, call `orchestrator.dispose()` + `ledger.clear()` {#wire-dispose}

### Phase 4: Pipeline widget integration

- [ ] Ensure orchestrator's `updateWidget()` works — the orchestrator already calls `(ctx.ui as any).setWidget?.("pipeline", ...)`. Verify the UI context getter returns a valid ctx at the right times. {#widget-context}
- [ ] Set orchestrator's UI context reference from `tool_execution_start` hook — same place where `widget.setUICtx()` and `fleet.setUICtx()` are called {#widget-uictx}
- [ ] Verify the widget renders in the editor area (test manually) — the `AgentWidget` renders above editor; the pipeline widget should use a separate key ("pipeline") to avoid collision {#widget-verify}

### Phase 5: Cleanup + verify

- [ ] Remove unused imports from `src/index.ts` — any imports that existed only for scheduling or scope-models should now be gone {#cleanup-imports}
- [ ] Verify `worktree.ts` is imported by `agent-manager.ts` and used for Crafter isolation (confirm: `isolation: "worktree"` in orchestrator's spawn calls; `createWorktree()` / `cleanupWorktree()` in agent-manager's spawn flow) {#verify-worktree}
- [ ] Run existing test suite: `npm test` — verify no regressions from removed features. Expect schedule tests and scope-model tests to be gone. {#run-tests}
- [ ] Update `CHANGELOG.md` with M7 changes: scheduling removed, model-scope removed, pipeline orchestration wired, `/summoner` command added {#update-changelog}
- [ ] Update `README.md` if needed — mention `/summoner`, pipeline mode, removed features {#update-readme}
- [ ] Remove `schedule` field from `AgentInvocation` in `src/types.ts` if present (upstream artifact — check first) {#cleanup-types}
- [ ] Remove any remaining schedule/scope-model references from `src/cross-extension-rpc.ts` (confirmed: none expected, but verify) {#verify-rpc}

## Files to modify

| File | Changes |
|---|---|
| `src/index.ts` | Major: import orchestrator/ledger/trigger, instantiate, wire hooks, insert planning gate, register /summoner, remove scheduling + scope-model code, add pipeline widget wiring |
| `src/settings.ts` | Remove `schedulingEnabled` and `scopeModels` from interface, sanitize, apply, and `SettingsAppliers` |
| `src/types.ts` | Remove `schedule` field from `AgentInvocation` if present |
| `CHANGELOG.md` | Document M7 changes |
| `README.md` | Update with new features |

## Files to delete

| File | Reason |
|---|---|
| `src/schedule.ts` | Scheduling feature stripped |
| `src/schedule-store.ts` | Scheduling feature stripped |
| `src/ui/schedule-menu.ts` | Scheduling feature stripped |
| `src/enabled-models.ts` | Model scope enforcement stripped |
| `test/schedule.test.ts` | Scheduling tests |
| `test/schedule-store.test.ts` | Scheduling tests |
| `test/schedule-e2e.test.ts` | Scheduling tests |
| `test/enabled-models.test.ts` | Model scope tests |

## Files to NOT touch

| File | Reason |
|---|---|
| `src/worktree.ts` | Worktree isolation retained — already wired for Crafters |
| `test/worktree.test.ts` | Worktree isolation retained |
| `src/orchestrator.ts` | Already complete from M6 — no changes needed |
| `src/trigger.ts` | Already complete from M3 — no changes needed |
| `src/planning-gate.ts` | Already complete from M4 — no changes needed |
| `src/ledger.ts` | Already complete from M5 — no changes needed |
| `src/plan-file.ts` | Already complete from M2 — no changes needed |
| `src/default-agents.ts` | Already complete from M1 — no changes needed |

## Risk assessment

| Risk | Impact | Mitigation |
|---|---|---|
| **Agent tool regression** — gate check breaks normal spawns | High — the Agent tool is the primary interface. A gate bug means ALL agent spawns fail. | Gate check is a pure function, unit-tested. The only integration risk is the `noPlanIntentFlag` timing. Test: spawn "Scout" (read-only, always allowed) and "general-purpose" (write-capable, blocked without plan) before/after plan approval. |
| **Trigger hook false positives** — high-confidence classification triggers pipeline for non-implementation queries | Medium — user gets a plan they didn't want | Gate the hook behind `pipelineEnabled`. The `medium` tier exists specifically for ambiguous cases. The hook is rule-based (regex), so false positives are deterministic and fixable by tuning patterns. |
| **Turn_start user message extraction fails** — can't read the user's message from session entries | Medium — trigger hook silently does nothing | Fall back gracefully: if extraction fails, skip trigger evaluation for that turn (don't crash the extension). Log a warning. |
| **Widget collision** — pipeline widget key conflicts with AgentWidget | Low — different keys (`"pipeline"` vs agent widget's internal rendering) | Verify keys don't overlap. Both use the same `ctx.ui` but different `setWidget` keys. |
| **Scheduling removal leaves dangling references** — a forgotten import or call crashes the extension at load time | Low — TypeScript compilation catches missing imports | Run `npx tsc --noEmit` after changes. The test suite also catches import errors. |
| **Scope-model removal breaks settings persistence** — users with `scopeModels: true` in their settings.json get an unknown-field warning | Low — `sanitize()` silently drops unknown fields | The field simply disappears from settings on next save. No crash, no warning. |
