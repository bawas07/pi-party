## 1. Remove Scheduling Feature

- [x] 1.1 Delete source files: `src/schedule.ts`, `src/schedule-store.ts`, `src/ui/schedule-menu.ts`
- [x] 1.2 Delete test files: `test/schedule.test.ts`, `test/schedule-store.test.ts`, `test/schedule-e2e.test.ts`
- [x] 1.3 Remove scheduling imports from `src/index.ts` (`SubagentScheduler`, `ScheduleStore`, `resolveStorePath`, `showSchedulesMenu`)
- [x] 1.4 Remove scheduler variable, `startScheduler()`, and all scheduler wiring in `session_start`, `session_before_switch`, `session_shutdown`
- [x] 1.5 Remove `schedulingEnabled` flag, `isSchedulingEnabled()`, `setSchedulingEnabled()` from `src/index.ts`
- [x] 1.6 Remove `scheduleParamShape`, `scheduleParam`, `scheduleGuideline` and their usage in Agent tool schema
- [x] 1.7 Remove `params.schedule` handling block from Agent tool `execute` (~30 lines)
- [x] 1.8 Remove "Scheduled jobs" menu entry from `/agents` interactive menu
- [x] 1.9 Remove scheduling settings item from `showSettings()`
- [x] 1.10 Remove `schedulingEnabled` from `SubagentsSettings` interface in `src/settings.ts`, plus its sanitization, apply, and `SettingsAppliers` wiring
- [x] 1.11 Verify Agent tool schema no longer accepts `schedule` param (spec: `pipeline-orchestration-wiring` — Scheduling feature is fully removed)

## 2. Remove Model Scope Enforcement

- [x] 2.1 Delete `src/enabled-models.ts`
- [x] 2.2 Delete `test/enabled-models.test.ts`
- [x] 2.3 Remove `isModelInScope`, `readEnabledModels`, `resolveEnabledModels` import from `src/index.ts`
- [x] 2.4 Remove `scopeModelsEnabled` flag, `isScopeModelsEnabled()`, `setScopeModelsEnabled()` from `src/index.ts`
- [x] 2.5 Remove scope-validation block from Agent tool `execute` (~25 lines — `isScopeModelsEnabled()` check, `resolveEnabledModels`, `isModelInScope`, error return, warning toast)
- [x] 2.6 Remove scope models settings item from `showSettings()`
- [x] 2.7 Remove `scopeModels` from `SubagentsSettings` interface in `src/settings.ts`, plus its sanitization, apply, and `SettingsAppliers` wiring
- [x] 2.8 Verify Agent tool execute no longer performs model-scope validation (spec: `pipeline-orchestration-wiring` — Model scope enforcement is fully removed)

## 3. Wire Orchestrator, Trigger Hook, and Planning Gate

- [x] 3.1 Import `Orchestrator`, `Ledger`, and trigger functions (`evaluateAll`, `noPlanIntent`, `implementIntent`, `needsScout`) into `src/index.ts`
- [x] 3.2 Instantiate `Ledger` as `const ledger = new Ledger()` (in-memory only)
- [x] 3.3 Instantiate `Orchestrator` with live deps: `new Orchestrator({ pi, manager, ledger, widget, fleet, getCtx: () => currentCtx })` (spec: `pipeline-orchestration-wiring` — Orchestrator is instantiated with live dependencies)
- [x] 3.4 Add `pipelineEnabled` master switch (default `true`) with getter function — gates ambient auto-start but not `/summoner` (spec: `pipeline-orchestration-wiring` — Pipeline master switch; spec: `trigger-hook` — Trigger hook is gated by pipelineEnabled)
- [x] 3.5 Add `noPlanIntentFlag` one-shot boolean — set by trigger, consumed by gate, cleared after use (spec: `planning-gate` — noPlanIntent flag is a one-shot consumed by the gate)
- [x] 3.6 Register trigger hook: `pi.on("turn_start", async (_event, ctx) => { ... })` — extract user message from `ctx.sessionManager.getEntries()`, build `TurnContext`, call `evaluateAll()`, route results (spec: `trigger-hook` — Trigger hook is registered on turn_start; spec: `trigger-hook` — Trigger results route to concrete actions)
- [x] 3.7 Wire trigger results: high + pipelineEnabled → `orchestrator.startPipeline()`; medium → surface question via `pi.sendMessage()`; needsScout → dispatch Scout background agent; noPlanIntent → set flag (spec: `pipeline-orchestration-wiring` — High/Medium/Scout dispatch requirements)
- [x] 3.8 Insert planning gate into Agent tool `execute` — before `manager.spawn()` / `manager.spawnAndWait()`, call `checkPlanningGate({ subagentType, hasApprovedPlan, noPlanIntent: noPlanIntentFlag })`. On rejection, return `textResult(message)`. Skip for resume. Clear flag after first consumption. (spec: `planning-gate` — Planning gate intercepts Agent tool execution)
- [x] 3.9 Register `/summoner <task>` command: parse task from args, call `orchestrator.startPipeline({ task, title, content: task, needsScout: true })`. If no task arg, prompt via `ctx.ui.input()`. (spec: `pipeline-orchestration-wiring` — /summoner command)
- [x] 3.10 Register `/pipeline` as alias for `/summoner` (same handler) (spec: `pipeline-orchestration-wiring` — /pipeline is an alias)
- [x] 3.11 Wire orchestrator disposal: on `session_shutdown`, call `orchestrator.dispose()` + `ledger.clear()` (spec: `pipeline-orchestration-wiring` — Orchestrator disposes on session shutdown)

## 4. Pipeline Widget Integration

- [x] 4.1 Ensure orchestrator's `getCtx()` returns valid context — set from `tool_execution_start` hook alongside existing `widget.setUICtx()` and `fleet.setUICtx()` calls (spec: `pipeline-widget` — UI context is available for widget rendering)
- [x] 4.2 Verify `updateWidget()` in orchestrator renders via `ctx.ui.setWidget("pipeline", ...)` with correct key to avoid AgentWidget collision (spec: `pipeline-widget` — Pipeline widget uses a separate key from AgentWidget)
- [x] 4.3 Verify widget clears on pipeline completion/abort, shows Gatekeeper round count, and displays per-step 🟢🟡✅❌ status (spec: `pipeline-widget` — all widget display requirements)

## 5. Cleanup and Verify

- [x] 5.1 Remove any remaining unused imports from `src/index.ts` after scheduling + scope-model removal
- [x] 5.2 Remove `schedule` field from `AgentInvocation` in `src/types.ts` if present (check first — upstream artifact)
- [x] 5.3 Verify `worktree.ts` is imported by `agent-manager.ts` and used for Crafter isolation (`isolation: "worktree"` in orchestrator's spawn calls, `createWorktree()`/`cleanupWorktree()` in agent-manager)
- [x] 5.4 Run `npm test` — verify no regressions, deleted tests are gone, all remaining tests pass
- [x] 5.5 Run `npx tsc --noEmit` — verify no TypeScript compilation errors from removed imports or missing types
- [x] 5.6 Update `CHANGELOG.md` — document scheduling removed, model-scope removed, pipeline orchestration wired, `/summoner` command added
- [x] 5.7 Update `README.md` — mention `/summoner`, pipeline mode, removed features if referenced
