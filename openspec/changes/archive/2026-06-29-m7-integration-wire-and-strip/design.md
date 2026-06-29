## Context

M1–M6 produced seven standalone, tested modules — `plan-file.ts`, `trigger.ts`, `planning-gate.ts`, `ledger.ts`, `orchestrator.ts`, updated `default-agents.ts`, and updated `types.ts` — plus a 960-line orchestrator test suite. None of these modules are imported or instantiated by `src/index.ts`. The extension currently operates as the original `pi-subagents` spawner with scheduling (`schedule.ts`, `schedule-store.ts`, `schedule-menu.ts`) and model-scope enforcement (`enabled-models.ts`) fully wired.

M7 is the integration milestone: connect these modules into a working pipeline-driven extension and remove the two features the roadmap explicitly strips. The orchestrator was designed for dependency injection (`OrchestratorDeps`) so wiring is straightforward — construct with live objects and call `startPipeline()`.

The `index.ts` file is 2,222 lines. The changes will add ~200 lines (orchestrator/trigger/gate wiring, `/summoner`, widget integration) and remove ~150 lines (scheduling, model-scope). Net delta is small; the risk is in getting the wiring correct at the right call sites.

## Goals / Non-Goals

**Goals:**
- Wire the orchestrator into `index.ts` — instantiate, register listeners, connect trigger hook
- Register `pi.on("turn_start")` as the ambient trigger hook — extract user message, classify, route results
- Insert `checkPlanningGate()` into Agent tool execute path — block write-capable spawns without approved plan
- Register `/summoner <task>` and `/pipeline <task>` commands
- Remove scheduling feature entirely: delete 3 source files, strip all references from `index.ts` and `settings.ts`
- Remove model scope enforcement: delete `enabled-models.ts`, strip all references
- Integrate pipeline progress widget with existing widget/fleet rendering
- Remove 4 orphaned test files (schedule × 3, enabled-models × 1)

**Non-Goals:**
- No changes to orchestrator state machine (M6)
- No changes to trigger classification logic (M3)
- No changes to planning gate logic (M4)
- No changes to ledger (M5)
- No changes to plan-file module (M2)
- No changes to agent definitions (M1)
- No persistence of orchestrator state across sessions (in-memory only, same as Ledger)
- No dynamic model assignment per role (parked per roadmap)

## Decisions

### Decision 1: Trigger hook fires on `turn_start`, not `turn_end`

**Rationale**: The trigger hook must evaluate BEFORE the main agent processes the turn, so the orchestrator can dispatch Scout/Plan before the main agent starts. `turn_end` fires after the agent has already responded — too late. `turn_start` fires at the beginning of each turn, before any agent processing.

**Alternative considered**: `message_start` with role filter. Rejected because the user message may be assembled from multiple sources (e.g., appended context from a compacted session), and `turn_start` is the canonical "new turn begins" signal. Delayed evaluation (e.g., first tool call) was rejected because by then the agent has already started reasoning — the pipeline should begin at turn boundary.

**User message extraction**: At `turn_start`, the user's message is available in `ctx.sessionManager.getEntries()` as the most recent `SessionMessageEntry` with `message.role === "user"`. If extraction fails (compaction edge case), the hook silently skips evaluation for that turn.

### Decision 2: `noPlanIntent` is a one-shot flag, not a session-wide state

**Rationale**: If a user says "no need to plan, just fix the login bug," that bypass should apply ONLY to the immediate task, not to every subsequent task in the session. A one-shot flag — set by the trigger hook, consumed by the first write-capable spawn, then cleared — prevents silent bypass accumulation.

**Alternative considered**: Flag persists until next plan approval. Rejected because it creates a confusing state where the user says "skip plan" once and then all future tasks skip the gate without the user realizing it. A session-wide toggle was also rejected because it's too coarse — users frequently switch between "just fix" and "plan this" in the same session.

**Flag lifecycle**: Set by trigger hook on `noPlanIntent: true`. Consumed by planning gate on first `checkPlanningGate()` call. Cleared immediately after consumption. If no write-capable spawn occurs that turn, flag auto-clears at next `turn_start`.

### Decision 3: Planning gate intercepts inside Agent tool `execute`, not as a wrapper

**Rationale**: The existing `Agent` tool is registered via `pi.registerTool(defineTool({...}))`. Wrapping the entire tool with a gate would require a middleware pattern that `defineTool` doesn't support. Inserting the gate check at the top of the `execute` handler — before `manager.spawn()` or `manager.spawnAndWait()` — is simpler and localizes the change.

**Gate check placement**: The check runs after parameter resolution (`subagentType` is known), model resolution, and scope validation (which is being removed), but before any spawn call. For background execution, it's before `manager.spawn()`. For foreground, it's before `manager.spawnAndWait()`. For resume, no gate — resuming an existing agent doesn't create a new write-capable session.

**Alternative considered**: Gate as a `before_agent_start` event handler. Rejected because at that point the agent session is already created, and aborting mid-creation is messier than a clean pre-spawn rejection. The `Agent` tool's `execute` returns a structured `textResult()` the LLM can read — better UX than a lifecycle event rejection.

### Decision 4: Pipeline widget uses `ctx.ui.setWidget` with key `"pipeline"`

**Rationale**: The existing `AgentWidget` uses `ctx.ui.setWidget` internally with a timer-based render loop. The pipeline widget is a separate concern — it shows pipeline phase/step progress, not individual agent activity. Using a different key (`"pipeline"` vs the widget's internal key) avoids collision.

**UI context availability**: The orchestrator's `updateWidget()` needs `ctx.ui`. The `tool_execution_start` hook already captures `ctx.ui` for `widget.setUICtx()` and `fleet.setUICtx()`. We extend this to also pass `ctx.ui` to the orchestrator's context reference.

**Alternative considered**: Extending `AgentWidget` to also render pipeline state. Rejected because `AgentWidget` is already complex (per-agent spinners, tool counts, token tracking) and the pipeline is a fundamentally different abstraction (a task with phases and steps, not individual agents). Separate rendering keeps both simpler.

### Decision 5: Feature stripping is done before wiring

**Rationale**: Removing scheduling and model-scope FIRST reduces the surface area the wiring touches. Fewer code paths to consider when inserting the planning gate (scope check was adjacent to spawn calls). Fewer variables in the closure when wiring the trigger hook (scheduler init was in `session_start`).

**Implementation order within M7**: Phase 1 (strip scheduling) → Phase 2 (strip model scope) → Phase 3 (wire orchestrator + trigger + gate) → Phase 4 (widget) → Phase 5 (cleanup). This is the order in the task checklist.

### Decision 6: `/summoner` is the command name, `/pipeline` is an alias

**Rationale**: `/summoner` is the name used throughout the PRD and roadmap. It's the name users will find if they've read any pi-party documentation. `/pipeline` is provided as an alias because it may be more intuitive for new users who haven't read the docs. Both call the same handler — no divergence.

**Command argument handling**: The task description is the rest of the command line after the command name. If no task is provided, the command prompts the user for one via `ctx.ui.input()`.

### Decision 7: Worktree isolation is confirmed wired, not re-wired

**Rationale**: The orchestrator already passes `isolation: "worktree"` in every `manager.spawn()` call for Crafters (both in `dispatchCrafters()` and the Gatekeeper fix loop). `agent-manager.ts` imports and calls `createWorktree()`, `cleanupWorktree()`, and `pruneWorktrees()` from `worktree.ts`. No changes needed — this is verification-only.

## Risks / Trade-offs

**Trigger hook false positives** → The hook is rule-based (regex patterns only, no LLM). Deterministic false positives can occur (e.g., "build understanding of the codebase" matches "build" + code-related words but isn't an implementation request). Mitigation: the `pipelineEnabled` master switch lets users disable ambient triggering. The `medium` tier surfaces a question instead of auto-starting. Patterns can be refined iteratively.

**User message extraction at turn_start fails** → If the most recent user message can't be found in session entries (edge case: session just started, no entries yet; or the user message was a compacted custom message), the trigger silently skips. Downside: triggers don't fire that turn. Mitigation: `/summoner` always works as a manual fallback.

**Planning gate + existing Agent tool interaction** → The Agent tool's render logic and notification system don't know about the planning gate. A gate rejection returns a `textResult` — the LLM sees the rejection message but the TUI widget shows a completed (error) agent row. This is acceptable for v1: the gate prevents the spawn entirely (no `manager.spawn()` call), so there's no phantom agent. The rejection is just text.

**Concurrent gate checks** → If two Agent tool calls arrive in the same turn (parallel tool calls), both check the planning gate. The `noPlanIntent` flag is consumed by the first one; the second one may be blocked if no plan exists. This is correct behavior — multiple parallel writes should all be under the same plan.

**Strip features, then run tests** → Deleting scheduling and scope-model files means those tests will be gone. The remaining test suite (`npm test`) must pass. If any test imports a deleted module, it will fail at compile time. Mitigation: run `npm test` after each deletion phase, not just at the end.
