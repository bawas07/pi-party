# M6 — Event-Driven Orchestrator

**Created**: 2026-06-29T00:00:00.000Z
**Status**: in-progress

## Goal

Build the pipeline orchestration engine (`src/orchestrator.ts`) — an event-driven state machine that listens to `subagents:*` lifecycle events and drives Scout → Plan → approval → concurrent Crafter dispatch → Gatekeeper → fix loop, without any single blocking call. Main Agent stays free to respond to side-questions and relay steering messages throughout.

## Non-goals

- **Not wiring into `index.ts`** — that's Milestone 7. This milestone delivers a tested, self-contained `Orchestrator` class.
- **Not persistence across interruptions** — state is in-memory for the pipeline run (same policy as Ledger).
- **Not the manual-override command** (`/summoner`) — also Milestone 7 integration.
- **Not the ambient hook wiring** — the `trigger.ts` hook already exists; wiring it into the orchestrator happens in M7.
- **Not removing scheduling/scope-models** — that's M7's strip-features task.

## Approach

### Architecture: event-driven state machine

The orchestrator is a class with a single active `PipelineTask` at a time (one pipeline run). It registers listeners on `pi.events` for `subagents:completed`, `subagents:failed`, `subagents:started`, and `subagents:steered`. Each listener advances the state machine one transition.

State transitions are deterministic per phase:

```
idle → scout (if needsScout) → plan → awaiting-approval → crafting → gatekeeping → complete
                                                                     ↑___________|
                                                                   (fix loop, max 3)
```

The orchestrator dispatches agents via `AgentManager.spawn()` with `isBackground: true`. It does NOT use `spawnAndWait` — the whole point is to not block. Completion arrives via the lifecycle event that `AgentManager` already emits through `onComplete` → `pi.events.emit("subagents:completed")`.

### Dependency injection

The orchestrator receives its dependencies at construction time:

```typescript
interface OrchestratorDeps {
  pi: ExtensionAPI;          // events, sendMessage, UI
  manager: AgentManager;     // spawn background agents
  ledger: Ledger;            // file-level conflict tracking
  widget: AgentWidget;       // progress display
  fleet: FleetList;          // fleet view
  getCtx: () => ExtensionContext | undefined;  // lazy ctx for spawn calls
}
```

### PipelineTask shape

```typescript
interface PipelineTask {
  planPath: string;
  title: string;
  phase: PipelinePhase;
  approved: boolean;
  trustMode: boolean;
  /** Map slug → dispatched step state */
  stepStates: Map<string, { agentId?: string; completed: boolean; failed: boolean }>;
  gatekeeperRounds: number;
  maxGatekeeperRounds: number;
  cwd: string;
}
```

### Key decisions

1. **Single pipeline at a time** — only one `currentTask`. Starting a new pipeline while one is active aborts the current one (user-initiated override).
2. **Scout is optional** — `needsScout` flag on `startPipeline()` controls whether Scout is dispatched before Plan. Scout's completion event is filtered by agent type (`subagent_type === "Scout"`).
3. **Plan always produces a file** — the Plan agent writes to `docs/tasks/`. The orchestrator extracts the path from the Plan agent's result text (since Plan's prompt instructs it to output the path).
4. **Approval is async** — `ctx.ui` interaction waits for user response. While waiting, Main Agent is free.
5. **Crafter dispatch is batch** — `unblockedSteps()` returns all candidate slugs; each is cross-checked against the Ledger; eligible ones spawn concurrently via separate `manager.spawn()` calls. Ledger claims are registered before spawn.
6. **Ledger claims are file sets** — the orchestrator infers target files from each step's description (simple heuristic: look for file paths in the step text; if ambiguous, claim a conservative set or ask the user). If no files can be inferred, the step is dispatched without a ledger claim (fallback: sequential-only).
7. **Gatekeeper rounds max at 3** — after 3 Gatekeeper → Crafter → Gatekeeper cycles, remaining issues are reported to the user as unresolved.
8. **Main agent stays free** — at no point does any function block on a promise without returning. All async work happens in event listener callbacks that `await` but never hold the main thread.

### File inference for Ledger claims

The orchestrator needs to know which files a step will touch to check the Ledger. Strategy:

1. Parse the step description for absolute paths and `src/...` patterns.
2. If the Plan step mentions specific files (e.g., "Create `src/auth.ts`"), claim those files.
3. If no files are inferrable from the step text, dispatch the step without a Ledger claim — it runs, but the orchestrator won't dispatch another step concurrently that might overlap. This is safe but conservative.

### Phase transitions in detail

#### Scout phase
- Dispatch `Agent` tool call with `subagent_type: "Scout"`, prompt = task description + "explore the relevant parts of the codebase"
- On `subagents:completed` with matching agent type "Scout": extract findings, feed into Plan prompt, transition to Plan phase

#### Plan phase
- Dispatch `Agent` tool call with `subagent_type: "Plan"`, prompt = task + Scout findings + "write plan to docs/tasks/"
- On `subagents:completed` with matching agent type "Plan": extract plan path from result, validate file exists, transition to `awaiting-approval`

#### Approval phase
- Read the plan file
- Present via `ctx.ui` (or `pi.sendMessage` with prompt buttons)
- Wait for user's next message — the orchestrator sets a flag that the next user turn should be checked for approval/rejection
- On approval: set `task.approved = true`, transition to `crafting`
- On rejection: stop, report back

#### Crafting phase
- Call `unblockedSteps(task.planPath)` to get candidate slugs
- For each slug, infer target files from step description
- Cross-check with `ledger.getConflictingFiles(files)` — if conflicts exist, step waits
- For each clear step: `ledger.claim(agentId, files)`, then `manager.spawn(...)` with `subagent_type: "Crafter"`
- On `subagents:completed` with matching agent type "Crafter":
  - `checkOffStep(planPath, slug)`
  - `ledger.release(agentId)`
  - Re-evaluate `unblockedSteps` + Ledger, dispatch newly unblocked steps
  - If no more unblocked steps and no in-flight Crafters: transition to `gatekeeping`

#### Gatekeeping phase
- Dispatch `manager.spawn(...)` with `subagent_type: "Gatekeeper"`, prompt = plan path + "review all changes"
- On `subagents:completed` with matching agent type "Gatekeeper":
  - Parse findings (structured output from Gatekeeper's prompt)
  - In-scope issues → dispatch Crafter(s) to fix (each fix counts as a round)
  - Out-of-scope issues → ask user
  - If no issues → transition to `complete`, archive plan
  - If max rounds exceeded → report unresolved to user, archive plan

### Widget updates

The orchestrator maintains a widget key `"pipeline"` via `ctx.ui.setStatus` (for a single-line status) or `ctx.ui.setWidget` (for a multi-line progress display). States map to the roadmap's widget design:

```
🟢 Scout       Exploring auth module structure…
✅ Scout       Found 12 relevant files
🟢 Plan        Drafting implementation plan…
✅ Plan        Plan written: docs/tasks/2026-06-29-jwt-auth.md
🟢 Crafter-1   Step 1/4: Create middleware file
🟢 Crafter-2   Step 2/4: Add tests
🟡 Crafter     Step 3/4: Apply to route files (queued — depends on step 1)
🟡 Gatekeeper  Waiting…
```

### Error handling

- **Scout fails** → report error, ask user whether to proceed without Scout or abort
- **Plan fails** → report error, stop pipeline
- **Crafter fails** → mark step as failed, continue with remaining steps (dependent steps stay blocked); report failed steps at end
- **Gatekeeper fails** → report error, stop pipeline, leave plan in-place for manual review
- **Any phase leaves inconsistent state** → catch in the event listener, log, reset phase to previous stable state, report to user

## Checklist

- [ ] Create `src/orchestrator.ts` with `Orchestrator` class skeleton, `PipelinePhase` type, `PipelineTask` interface, `OrchestratorDeps` interface, and `startPipeline()` entry point {#create-skeleton}
- [ ] Implement `startPipeline()` — sets up `PipelineTask`, registers event listeners, stores as `currentTask`, enters `scout` or `plan` phase {#start-pipeline}
- [ ] Implement Scout phase dispatch: `dispatchScout()` — spawns background Scout agent via `manager.spawn()`, sets phase to `scout` {#scout-dispatch}
- [ ] Implement Plan phase dispatch: `dispatchPlan()` — spawns background Plan agent, sets phase to `plan`. Receives optional Scout findings as context. {#plan-dispatch}
- [ ] Implement event listener registration — `onAgentCompleted()` handler that routes by phase and agent type, driving state transitions {#event-listeners}
- [ ] Implement Scout completion handler — extracts findings from Scout result, feeds into Plan dispatch {#scout-complete}
- [ ] Implement Plan completion handler — extracts plan path from result text, validates file exists, reads plan, transitions to `awaiting-approval` {#plan-complete}
- [ ] Implement `presentApprovalUI()` — reads plan content, presents to user via `pi.sendMessage` with approve/reject prompt buttons, sets approval-pending flag {#approval-ui}
- [ ] Implement approval response handling — on next user turn after approval UI, check for approve/reject. On approve: set `approved=true`, call `dispatchCrafters()`. On reject: stop pipeline. {#approval-response}
- [ ] Implement `dispatchCrafters()` — queries `unblockedSteps()`, infers target files per step, cross-checks Ledger, dispatches concurrent Crafters for clear steps, registers Ledger claims {#crafter-dispatch}
- [ ] Implement file inference from step descriptions — regex-based extraction of file paths, conservative fallback when ambiguous {#file-inference}
- [ ] Implement Crafter completion handler — checks off step in plan file, releases Ledger claim, re-evaluates unblocked steps + Ledger, dispatches newly eligible steps, transitions to Gatekeeper when all done {#crafter-complete}
- [ ] Implement `onAgentFailed()` handler — routes by phase. Scout fail → ask user. Plan fail → stop pipeline. Crafter fail → mark step failed, continue. Gatekeeper fail → stop pipeline. {#failed-handler}
- [ ] Implement `onAgentSteered()` handler — marks the steered agent's state as potentially stale; on its next completion, re-validates rather than trusting prior assumptions {#steered-handler}
- [ ] Implement Gatekeeper dispatch — `dispatchGatekeeper()` spawns background Gatekeeper, sets phase to `gatekeeping` {#gatekeeper-dispatch}
- [ ] Implement Gatekeeper completion handler — parses structured findings (in-scope vs out-of-scope), dispatches Crafter(s) for in-scope fixes, asks user for out-of-scope. Tracks round count. {#gatekeeper-complete}
- [ ] Implement fix loop logic — after Crafter fix-for-Gatekeeper completes, re-dispatch Gatekeeper for re-check. Max 3 rounds. {#fix-loop}
- [ ] Implement `archiveAndComplete()` — calls `archive(planPath)`, clears `currentTask`, reports completion summary via `pi.sendMessage` {#archive-complete}
- [ ] Implement widget updates — single-line status via `ctx.ui.setStatus("pipeline", ...)` updated at each phase/step transition. Multi-line progress widget via `ctx.ui.setWidget("pipeline", ...)` showing concurrent Crafter rows. {#widget-updates}
- [ ] Implement `abort()` — stops all in-flight pipeline agents via `manager.abort()`, clears Ledger claims, resets state to idle {#abort}
- [ ] Implement listener cleanup — `dispose()` removes all event listeners, aborts current pipeline, resets state. Called on `session_shutdown`. {#cleanup}
- [ ] Confirm Main Agent stays free — add comment documentation and a runtime assertion that no `startPipeline()` or event handler path holds a blocking promise {#main-agent-free}
- [ ] Write unit tests for orchestrator state machine — mock AgentManager, Ledger, pi.events; test each phase transition in isolation. Tests file: `test/orchestrator.test.ts` {#unit-tests}
- [ ] Write integration test: full pipeline, sequential steps only — uses real plan-file and ledger, mocked agent spawns {#integration-sequential}
- [ ] Write integration test: full pipeline with two concurrent Crafters on independent steps {#integration-concurrent}
- [ ] Write integration test: user steers a running Crafter mid-step; orchestrator picks up correctly {#integration-steered}
- [ ] Write integration test: error at each phase doesn't leave listeners in inconsistent state {#integration-errors}

