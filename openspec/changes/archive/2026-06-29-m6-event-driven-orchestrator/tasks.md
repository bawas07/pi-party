## 1. Module skeleton and types

- [x] 1.1 Create `src/orchestrator.ts` with `Orchestrator` class, `PipelinePhase` type (`"idle" | "scout" | "plan" | "awaiting-approval" | "crafting" | "gatekeeping" | "complete"`), `PipelineTask` interface, `OrchestratorDeps` interface, and `StepState` interface
- [x] 1.2 Implement constructor that stores `pi`, `manager`, `ledger`, `widget`, `fleet`, `getCtx` from `OrchestratorDeps`, initializes `currentTask = null`, and initializes empty listeners array
- [x] 1.3 Define `StartPipelineConfig` type: `{ task: string; title: string; content: string; needsScout: boolean; planPath?: string; cwd?: string }`

## 2. Event listener infrastructure

- [x] 2.1 Implement `registerListeners()` that subscribes to `pi.events` for `subagents:completed`, `subagents:failed`, `subagents:started`, and `subagents:steered` — storing unsubscribe functions
- [x] 2.2 Implement listener guard: each handler checks `if (!this.currentTask) return` before processing, and filters by agent type matching the expected phase agent
- [x] 2.3 Implement `dispose()` that calls all stored unsubscribe functions, calls `abort()` if pipeline active, and nulls out references

## 3. Pipeline entry point

- [x] 3.1 Implement `startPipeline(config: StartPipelineConfig)` — creates `PipelineTask`, aborts existing pipeline if active, writes plan file via `writePlan()` if no external `planPath`, calls `registerListeners()` if first run, transitions to Scout or Plan phase based on `config.needsScout`
- [x] 3.2 Implement `abort()` — stops all in-flight pipeline agents via `manager.abort()`, releases all Ledger claims for current task, resets `currentTask = null`
- [x] 3.3 Handle pipeline-level errors: wrap `startPipeline` in try/catch, surface initialization failures via `pi.sendMessage` rather than throwing

## 4. Scout phase

- [x] 4.1 Implement `dispatchScout()` — spawns `manager.spawn()` with `subagent_type: "Scout"`, prompt containing task description, `isBackground: true`. Sets phase to `scout`. Records agent ID for later matching.
- [x] 4.2 Implement Scout completion handler (in `onAgentCompleted`) — matches `eventData.type === "Scout"` and `currentTask.phase === "scout"`. Extracts findings from `eventData.result`, feeds into `dispatchPlan()` with Scout context.

## 5. Plan phase

- [x] 5.1 Implement `dispatchPlan(scoutFindings?: string)` — spawns `manager.spawn()` with `subagent_type: "Plan"`, prompt containing task description + Scout findings + instruction to write plan to `docs/tasks/`. Sets phase to `plan`.
- [x] 5.2 Implement plan path extraction — `extractPlanPath(result: string): string | null` that scans for `docs/tasks/` path pattern. If no match, `findMostRecentPlan(cwd)` scans `docs/tasks/` for newest `.md` file.
- [x] 5.3 Implement Plan completion handler — extracts plan path, validates file exists, reads plan via `readPlan()`, stores `planPath` on `PipelineTask`, transitions to `awaiting-approval` phase

## 6. Approval flow

- [x] 6.1 Implement `presentApprovalUI()` — reads plan content, sends via `pi.sendMessage` with approve/reject options. Sets `currentTask.phase = "awaiting-approval"`. Returns immediately without blocking.
- [x] 6.2 Implement approval hook — registers a check on the next user turn that intercepts the message for approve/reject keywords. On approve: sets `approved = true`, calls `dispatchCrafters()`. On reject: stops pipeline, reports to user.

## 7. Crafter dispatch with Ledger coordination

- [x] 7.1 Implement `inferTargetFiles(stepDescription: string): string[]` — regex extraction of file-like patterns: backtick-quoted paths, `src/...`, `test/...`, absolute paths. Returns empty array if nothing found.
- [x] 7.2 Implement `dispatchCrafters()` — calls `unblockedSteps(currentTask.planPath)`, maps each slug to step description via `parseChecklist()`, infers target files, calls `ledger.getConflictingFiles(files)`. For each clear step: claims files via `ledger.claim()`, spawns Crafter via `manager.spawn()` with prompt = step description + plan context + existing patterns. Records agent ID → slug mapping in `currentTask.stepStates`.
- [x] 7.3 Implement Crafter completion handler — matches `eventData.type === "Crafter"` and phase is `crafting`. Calls `checkOffStep(planPath, slug)`, `ledger.release(agentId)`. Updates `stepStates`. Calls `dispatchCrafters()` again (which re-evaluates unblockedSteps + Ledger and dispatches new eligible steps). If no unblocked steps and no in-flight Crafters: calls `dispatchGatekeeper()`.
- [x] 7.4 Handle step with no inferrable files — dispatch without Ledger claim, no concurrent protection but doesn't block

## 8. Gatekeeper phase and fix loop

- [x] 8.1 Implement `dispatchGatekeeper()` — spawns `manager.spawn()` with `subagent_type: "Gatekeeper"`, prompt containing plan path + "review all changes against the plan". Sets phase to `gatekeeping`.
- [x] 8.2 Implement `parseGatekeeperFindings(result: string)` — extracts in-scope and out-of-scope issue lists from Gatekeeper's structured output using section headers (`#### In-Scope`, `#### Out-of-Scope`). Returns `{ inScope: string[], outOfScope: string[] }`. Falls back to all-out-of-scope on parse failure.
- [x] 8.3 Implement Gatekeeper completion handler — if no findings: calls `archiveAndComplete()`. If in-scope findings and `rounds < 3`: dispatches Crafter for fixes, increments `gatekeeperRounds`, sets flag to re-dispatch Gatekeeper after fix Crafter completes. If out-of-scope: presents to user. If `rounds >= 3` with remaining issues: reports unresolved, calls `archiveAndComplete()`.
- [x] 8.4 Implement fix-loop Crafter completion handler — same as regular Crafter completion but instead of checking for more unblocked steps, re-dispatches Gatekeeper

## 9. Completion and archive

- [x] 9.1 Implement `archiveAndComplete()` — calls `archive(planPath)` from plan-file module, sets `currentTask.completedAt`, reports completion summary via `pi.sendMessage` with step counts (completed/failed/skipped)
- [x] 9.2 Implement completion summary format — lists completed steps, failed steps (if any), Gatekeeper findings (if any), plan file archive location

## 10. Error handling per phase

- [x] 10.1 Scout failure handler — on `subagents:failed` with type "Scout": sends message asking user whether to proceed without Scout or abort pipeline. Waits for user response before continuing.
- [x] 10.2 Plan failure handler — on `subagents:failed` with type "Plan": reports error, stops pipeline. No retry — user must restart.
- [x] 10.3 Crafter failure handler — on `subagents:failed` with type "Crafter": marks step as failed in `stepStates`, releases Ledger claim, continues with remaining steps (dependent steps stay blocked). Failed steps included in completion summary.
- [x] 10.4 Gatekeeper failure handler — on `subagents:failed` with type "Gatekeeper": reports error, stops pipeline, leaves plan in-place for manual review

## 11. Steered agent handling

- [x] 11.1 Implement `onAgentSteered` handler — on `subagents:steered` event for a pipeline agent, sets `steered: true` flag on that agent's step state entry
- [x] 11.2 On steered agent's subsequent completion — re-reads plan file to validate step state before calling `checkOffStep`. If step appears incomplete (not checked off correctly), marks as failed instead of completed.

## 12. Widget updates

- [x] 12.1 Implement `updateWidget()` — builds a render function for `ctx.ui.setWidget("pipeline", ...)` showing per-phase progress with 🟢🟡✅❌ indicators. Maps from `currentTask.phase` and `stepStates` to visual rows.
- [x] 12.2 Call `updateWidget()` at every state transition: phase change, step dispatch, step completion, step failure
- [x] 12.3 Widget format matches roadmap spec: one row per pipeline agent, concurrent Crafters shown as `Crafter-1`, `Crafter-2`, etc. Queued steps shown with 🟡 and reason (depends on X, or waiting for file Y)

## 13. Edge cases and robustness

- [x] 13.1 Handle Plan agent retry — if `extractPlanPath()` returns null and `findMostRecentPlan()` also fails, retry Plan dispatch once with a stronger prompt ("You MUST create the plan file at docs/tasks/..."). If still fails, report error and stop.
- [x] 13.2 Handle duplicate completion events — if a Crafter's completion fires twice (race condition), `checkOffStep` is idempotent (already handles this), and the second event is a no-op
- [x] 13.3 Handle rapid phase transitions — ensure `registerListeners()` is called exactly once; guard against double-registration
- [x] 13.4 Handle empty checklist — if Plan produces a plan with zero steps, report to user and stop (nothing to build)
- [x] 13.5 Confirm main agent non-blocking — add JSDoc assertion on `startPipeline()` and audit all methods for blocking promises. All spawn calls use `isBackground: true`.

## 14. Unit tests

- [x] 14.1 Create `test/orchestrator.test.ts` with mocked `pi`, `manager`, `ledger`, `widget`, `fleet`
- [x] 14.2 Test `startPipeline` — creates PipelineTask, aborts existing, enters correct phase based on `needsScout`
- [x] 14.3 Test phase transitions — mock `subagents:completed` events with different agent types, verify phase advances correctly through Scout→Plan→awaiting-approval→crafting→gatekeeping→complete
- [x] 14.4 Test `extractPlanPath` with valid and invalid result strings
- [x] 14.5 Test `inferTargetFiles` with step descriptions containing file paths and without
- [x] 14.6 Test `parseGatekeeperFindings` with structured output, empty output, and malformed output
- [x] 14.7 Test `abort()` — verifies manager.abort called, ledger claims released, currentTask nulled
- [x] 14.8 Test `dispose()` — verifies listeners unsubscribed, pipeline aborted if active
- [x] 14.9 Test error handlers — each phase's failure handler produces correct behavior (Scout=ask, Plan=stop, Crafter=continue, Gatekeeper=stop)

## 15. Integration tests

- [x] 15.1 Integration test: full pipeline with sequential steps — mock AgentManager.spawn to resolve immediately with fake results; verify plan written, steps checked off in order, Gatekeeper dispatched, plan archived
- [x] 15.2 Integration test: two concurrent Crafters on independent steps — verify both spawn concurrently, both complete independently, both checked off, then Gatekeeper
- [x] 15.3 Integration test: dependent step waits — step B depends on step A; verify B is not dispatched until A completes
- [x] 15.4 Integration test: Ledger conflict delays step — step A claims `src/auth.ts`, step B also touches `src/auth.ts`; verify B waits until A completes and releases claim
- [x] 15.5 Integration test: user steers Crafter — steer event fires during step, verify step marked as steered, completion re-validates
- [x] 15.6 Integration test: Gatekeeper fix loop — Gatekeeper finds 2 in-scope issues; verify Crafter dispatched to fix, Gatekeeper re-dispatched, second run finds 0 issues, pipeline completes
- [x] 15.7 Integration test: max 3 Gatekeeper rounds exceeded — Gatekeeper keeps finding issues; verify pipeline stops after 3rd round, unresolved issues reported
- [x] 15.8 Integration test: error at each phase doesn't corrupt state — force failure at Scout, Plan, Crafter, Gatekeeper phases; verify subsequent phase handlers work correctly for remaining agents
- [x] 15.9 Integration test: disposal during active pipeline — call `dispose()` while Crafters are running; verify all agents stopped, all listeners unsubscribed
