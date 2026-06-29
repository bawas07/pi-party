## ADDED Requirements

### Requirement: Pipeline lifecycle — start, phase transitions, completion

The `Orchestrator` class SHALL manage a single pipeline run through the phases `scout` → `plan` → `awaiting-approval` → `crafting` → `gatekeeping` → `complete`. It SHALL accept a `startPipeline(config)` call with task description, title, content, optional external plan path, optional Scout context, and optional working directory.

#### Scenario: Full pipeline with Scout

- **WHEN** `startPipeline()` is called with `needsScout: true`
- **THEN** the orchestrator dispatches a background Scout agent, transitions phase to `scout`, and on Scout's `subagents:completed` event dispatches a background Plan agent with Scout's findings as context

#### Scenario: Full pipeline without Scout

- **WHEN** `startPipeline()` is called with `needsScout: false`
- **THEN** the orchestrator dispatches a background Plan agent directly, skipping the Scout phase

#### Scenario: Pipeline starts while another is active

- **WHEN** `startPipeline()` is called and a `currentTask` already exists
- **THEN** the existing pipeline is aborted (in-flight agents stopped, Ledger claims released) before the new pipeline starts

### Requirement: Plan agent dispatch and path extraction

The orchestrator SHALL dispatch a Plan agent via `manager.spawn()` with `subagent_type: "Plan"` and a prompt containing the task description plus any Scout findings. On Plan completion, it SHALL extract the plan file path from the agent's result text by scanning for `docs/tasks/` path patterns. If extraction fails, it SHALL scan `docs/tasks/` for the most recently created `.md` file as a fallback.

#### Scenario: Plan writes file and reports path

- **WHEN** the Plan agent completes and its result contains the string `docs/tasks/2026-06-29-jwt-auth.md`
- **THEN** the orchestrator extracts that path, verifies the file exists, reads the plan content, and transitions to `awaiting-approval`

#### Scenario: Plan result has no recognizable path

- **WHEN** the Plan agent completes but no `docs/tasks/` path is found in its result
- **THEN** the orchestrator scans `docs/tasks/` for the most recent `.md` file, uses it if found, or retries Plan dispatch once if none found

### Requirement: User approval flow

On Plan completion, the orchestrator SHALL present the plan content to the user via `pi.sendMessage` with approve/reject prompt options. It SHALL set an internal `awaitingApproval` flag. The orchestrator SHALL intercept the next user turn to check for approval or rejection.

#### Scenario: User approves plan

- **WHEN** the user responds with approval after seeing the plan
- **THEN** the orchestrator sets `approved: true` on the task, opens trust mode, and transitions to the `crafting` phase

#### Scenario: User rejects plan

- **WHEN** the user responds with rejection after seeing the plan
- **THEN** the orchestrator stops the pipeline, reports back to the user, and does not dispatch any Crafters

### Requirement: Concurrent Crafter dispatch with Ledger coordination

The orchestrator SHALL query `unblockedSteps(planPath)` to identify candidate steps. For each candidate, it SHALL infer target files from the step description and cross-check with `ledger.getConflictingFiles(files)`. Steps with no conflicts SHALL be dispatched immediately as background Crafter agents. Steps with conflicts SHALL wait. Before dispatching each Crafter, the orchestrator SHALL call `ledger.claim(agentId, files)` to register file ownership.

#### Scenario: Two independent steps, no conflicts

- **WHEN** `unblockedSteps()` returns `["create-middleware", "add-tests"]` and their inferred files are disjoint
- **THEN** both Crafters are dispatched concurrently in background mode, and both file sets are registered in the Ledger

#### Scenario: Conflicting step waits

- **WHEN** `unblockedSteps()` returns `["create-middleware", "wire-routes"]` and `"wire-routes"` touches a file already claimed by an in-flight Crafter for `"create-middleware"`
- **THEN** only `"create-middleware"` is dispatched; `"wire-routes"` waits until the in-flight Crafter completes and releases its claim

#### Scenario: Step with no inferrable files

- **WHEN** a step description contains no recognizable file paths
- **THEN** the step is dispatched without a Ledger claim (no concurrent protection, sequential-only for that step)

### Requirement: Crafter completion — check off, release, re-evaluate

On a Crafter agent's `subagents:completed` event, the orchestrator SHALL call `checkOffStep(planPath, slug)` to mark the step complete in the plan file, call `ledger.release(agentId)` to release file claims, and then re-evaluate `unblockedSteps()` + Ledger conflicts to dispatch any newly eligible steps. When no unblocked steps remain and no Crafters are in-flight, the orchestrator SHALL transition to the `gatekeeping` phase.

#### Scenario: Completion unblocks dependent step

- **WHEN** Crafter for step "create-middleware" completes and step "wire-routes" depends on "create-middleware"
- **THEN** `checkOffStep` is called for "create-middleware", Ledger claim is released, and "wire-routes" becomes eligible for dispatch

#### Scenario: All steps complete

- **WHEN** the last in-flight Crafter completes and no unblocked steps remain
- **THEN** the orchestrator transitions to `gatekeeping` and dispatches a Gatekeeper agent

#### Scenario: Crafter fails

- **WHEN** a Crafter agent emits `subagents:failed`
- **THEN** the orchestrator marks the step as failed, releases its Ledger claim, and continues with remaining steps (dependent steps stay blocked)

### Requirement: Gatekeeper dispatch and fix loop

The orchestrator SHALL dispatch a Gatekeeper agent via `manager.spawn()` with `subagent_type: "Gatekeeper"` once all Crafter steps complete. On Gatekeeper completion, it SHALL parse the result for in-scope and out-of-scope findings. In-scope findings SHALL trigger Crafter dispatch for fixes, followed by Gatekeeper re-check. The fix loop SHALL max at 3 rounds total.

#### Scenario: Gatekeeper finds in-scope issues

- **WHEN** Gatekeeper completes with in-scope issues and the current round count is less than 3
- **THEN** one Crafter is dispatched to fix the issues, and after the fix Crafter completes, Gatekeeper is re-dispatched

#### Scenario: Gatekeeper finds no issues

- **WHEN** Gatekeeper completes with zero findings
- **THEN** the orchestrator transitions to `complete`, archives the plan file, and reports completion

#### Scenario: Max fix rounds exceeded

- **WHEN** Gatekeeper completes with in-scope issues on the 3rd round
- **THEN** the orchestrator reports remaining issues to the user as unresolved, archives the plan file, and transitions to `complete`

#### Scenario: Gatekeeper finds out-of-scope issues

- **WHEN** Gatekeeper reports out-of-scope findings
- **THEN** the orchestrator presents those findings to the user and asks whether to fix or leave them

### Requirement: Steered agent handling

When a pipeline agent receives a `subagents:steered` event, the orchestrator SHALL mark that agent's state as potentially stale. On the agent's subsequent `subagents:completed` event, the orchestrator SHALL re-validate step completion rather than trusting its prior understanding.

#### Scenario: Crafter steered mid-step

- **WHEN** a running Crafter receives a steering message via `steer_subagent`
- **THEN** the orchestrator records the steer and, on the Crafter's next completion, checks the plan file's actual state before marking the step complete

### Requirement: Pipeline abort

The orchestrator SHALL provide an `abort()` method that stops all in-flight pipeline agents via `manager.abort()`, releases all Ledger claims for the current task, and resets state to idle.

#### Scenario: Abort during crafting phase

- **WHEN** `abort()` is called while Crafters are running
- **THEN** all Crafters are stopped, their Ledger claims are released, and the orchestrator resets to idle state

### Requirement: Disposal and cleanup

The orchestrator SHALL provide a `dispose()` method that removes all registered event listeners, aborts the current pipeline if active, and releases all resources. It SHALL be safe to call multiple times.

#### Scenario: Dispose called on session shutdown

- **WHEN** `dispose()` is called (e.g., on `session_shutdown`)
- **THEN** all event listeners are unsubscribed, any active pipeline is aborted, and further events have no effect

### Requirement: Main agent non-blocking guarantee

No method on the `Orchestrator` class SHALL hold a blocking promise or perform synchronous work exceeding 50ms. All agent dispatch SHALL use `manager.spawn()` with `isBackground: true`. All phase transitions SHALL occur in event listener callbacks.

#### Scenario: Main agent fields side-question during pipeline

- **WHEN** a pipeline phase is in flight (e.g., Crafter running in background)
- **THEN** the main agent remains free to respond to a `/btw`-style side question without waiting for the pipeline

### Requirement: Pipeline progress widget

The orchestrator SHALL maintain a pipeline status widget via `ctx.ui.setWidget("pipeline", renderFn)` that displays per-phase progress with agent states. The widget SHALL show 🟢 (working), 🟡 (queued/waiting), ✅ (done), and ❌ (failed) indicators for each pipeline agent.

#### Scenario: Widget during concurrent crafting

- **WHEN** two Crafters are running concurrently and one is queued waiting for a dependency
- **THEN** the widget shows two 🟢 rows for running Crafters and one 🟡 row for the queued Crafter
