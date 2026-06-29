## ADDED Requirements

### Requirement: Orchestrator is instantiated with live dependencies

The system SHALL instantiate the `Orchestrator` class from `src/orchestrator.ts` with live `AgentManager`, `Ledger`, `AgentWidget`, `FleetList`, and `ExtensionAPI` dependencies. The orchestrator SHALL be stored in the extension's closure for use by the trigger hook, planning gate, and `/summoner` command.

#### Scenario: Orchestrator constructed on extension load

- **WHEN** the extension's default export function executes
- **THEN** a new `Orchestrator` instance is created with `{ pi, manager, ledger, widget, fleet, getCtx }` and stored in a closure variable

#### Scenario: Orchestrator receives valid context getter

- **WHEN** `getCtx()` is called during pipeline execution
- **THEN** it returns the current `ExtensionContext` (set on `session_start`) or `undefined` if no session is active

### Requirement: Ambient trigger hook runs on every turn

The system SHALL register a handler on `pi.on("turn_start")` that: extracts the user's message from `ctx.sessionManager.getEntries()`, constructs a `TurnContext`, calls `evaluateAll()` from `src/trigger.ts`, and routes the result to the appropriate action.

#### Scenario: Trigger hook fires on turn start

- **WHEN** a new conversation turn begins
- **THEN** the trigger hook evaluates the trigger classification and routes the result

#### Scenario: User message extraction fails gracefully

- **WHEN** the most recent user message cannot be extracted from session entries (e.g., first turn, compaction edge case)
- **THEN** the trigger hook skips evaluation for that turn without error

### Requirement: High-confidence implement intent starts the pipeline

The system SHALL call `orchestrator.startPipeline()` when `implementIntent` is `"high"`, `pipelineEnabled` is `true`, and no pipeline is currently running.

#### Scenario: Pipeline auto-starts on high-confidence intent

- **WHEN** the user message is "build a login system with JWT" and no pipeline is active
- **THEN** `orchestrator.startPipeline()` is called with `{ task: "build a login system with JWT", title: "build-a-login-system-with-jwt", needsScout: true }`

#### Scenario: Pipeline does not auto-start when disabled

- **WHEN** `pipelineEnabled` is `false` and the user message is "build a login system"
- **THEN** the trigger hook does NOT call `orchestrator.startPipeline()`

#### Scenario: Pipeline does not auto-start when one is already running

- **WHEN** `implementIntent` is `"high"` but a pipeline is already active
- **THEN** `orchestrator.startPipeline()` is NOT called (existing pipeline continues)

### Requirement: Medium-confidence intent surfaces a question

The system SHALL surface a question to the user when `implementIntent` is `"medium"`, asking whether they want a plan to be created. The question SHALL NOT block or delay other trigger actions (e.g., Scout dispatch from `needsScout`).

#### Scenario: Medium intent surfaces question

- **WHEN** the user message is "how would I add JWT authentication to this API?"
- **THEN** a message is sent to the user: "Want me to put together a plan for that?" — and the system waits for the user's response

### Requirement: Scout is dispatched independently of implement intent

The system SHALL dispatch a Scout background agent when `needsScout` returns `true`, regardless of the `implementIntent` classification. Scout dispatch SHALL NOT depend on pipeline state.

#### Scenario: Scout dispatched for codebase question during implementation discussion

- **WHEN** the user asks "where is the auth middleware defined?" (needsScout: true, implementIntent: low)
- **THEN** a Scout background agent is dispatched via `manager.spawn()` with `subagent_type: "Scout"`

#### Scenario: Scout dispatched alongside high implement intent

- **WHEN** the user says "build auth — where's the user model?" (needsScout: true, implementIntent: high)
- **THEN** a Scout background agent is dispatched AND `orchestrator.startPipeline()` is called

### Requirement: noPlanIntent flag bypasses the planning gate

The system SHALL set a one-shot `noPlanIntent` flag when the trigger detects explicit no-plan intent. The flag SHALL be consumed by the planning gate on the first write-capable Agent spawn of that turn. After consumption, the flag SHALL be cleared.

#### Scenario: No-plan flag set by trigger

- **WHEN** the user says "fix the login bug, no need to plan, just implement it directly"
- **THEN** the `noPlanIntent` one-shot flag is set to `true`

#### Scenario: No-plan flag consumed by planning gate

- **WHEN** the `noPlanIntent` flag is `true` and the Agent tool spawns a write-capable agent
- **THEN** `checkPlanningGate()` returns `{ allowed: true }` and the flag is cleared immediately

#### Scenario: No-plan flag clears if unused

- **WHEN** the `noPlanIntent` flag was set on a turn but no write-capable spawn occurred
- **THEN** the flag is cleared at the next `turn_start`

### Requirement: Pipeline master switch controls ambient triggering

The system SHALL provide a `pipelineEnabled` boolean flag (default `true`) that controls whether the ambient trigger hook routes high-confidence intent to the orchestrator. When `false`, Scout dispatch from `needsScout` still works, and `/summoner` still works — only ambient pipeline auto-start is suppressed.

#### Scenario: Pipeline disabled suppresses auto-start

- **WHEN** `pipelineEnabled` is `false` and `implementIntent` is `"high"`
- **THEN** `orchestrator.startPipeline()` is NOT called, but Scout may still dispatch if `needsScout` is `true`

#### Scenario: Pipeline disabled does not affect /summoner

- **WHEN** `pipelineEnabled` is `false` and the user runs `/summoner build auth`
- **THEN** `orchestrator.startPipeline()` IS called — manual override ignores the switch

### Requirement: /summoner command starts the pipeline manually

The system SHALL register a `/summoner <task>` command via `pi.registerCommand()`. The command SHALL parse the task description from the command arguments, construct a `StartPipelineConfig` with `needsScout: true`, and call `orchestrator.startPipeline()`. If no task argument is provided, the command SHALL prompt the user for input.

#### Scenario: /summoner with task argument

- **WHEN** the user runs `/summoner build JWT authentication`
- **THEN** `orchestrator.startPipeline()` is called with `{ task: "build JWT authentication", title: "build-jwt-authentication", needsScout: true }`

#### Scenario: /summoner without task argument

- **WHEN** the user runs `/summoner` with no arguments
- **THEN** the command prompts the user: "What should I build?" via `ctx.ui.input()`

### Requirement: /pipeline is an alias for /summoner

The system SHALL register `/pipeline` as an alias command that calls the same handler as `/summoner`.

#### Scenario: /pipeline alias works identically

- **WHEN** the user runs `/pipeline build auth`
- **THEN** the same `orchestrator.startPipeline()` call is made as `/summoner build auth`

### Requirement: Orchestrator disposes on session shutdown

The system SHALL call `orchestrator.dispose()` and `ledger.clear()` on `session_shutdown` to stop all in-flight pipeline agents, release Ledger claims, and remove event listeners.

#### Scenario: Cleanup on session end

- **WHEN** the session shuts down
- **THEN** `orchestrator.dispose()` is called, aborting any active pipeline, and `ledger.clear()` releases all claims

### Requirement: Scheduling feature is fully removed

The system SHALL have no scheduling capability. The files `src/schedule.ts`, `src/schedule-store.ts`, and `src/ui/schedule-menu.ts` SHALL be deleted. The `Agent` tool SHALL NOT accept a `schedule` parameter. The `/agents` menu SHALL NOT show a "Scheduled jobs" entry. The settings menu SHALL NOT show a "Scheduling" item.

#### Scenario: Agent tool has no schedule param

- **WHEN** the Agent tool is registered
- **THEN** the `schedule` parameter is absent from the tool schema

#### Scenario: /agents menu has no scheduled jobs

- **WHEN** the user opens the `/agents` interactive menu
- **THEN** there is no "Scheduled jobs" option

#### Scenario: Settings has no scheduling item

- **WHEN** the user opens `/agents` → Settings
- **THEN** there is no "Scheduling" setting item

### Requirement: Model scope enforcement is fully removed

The system SHALL have no model scope enforcement. The file `src/enabled-models.ts` SHALL be deleted. The Agent tool's execute handler SHALL NOT validate the selected model against any allowed-models list. The settings menu SHALL NOT show a "Scope models" item.

#### Scenario: Agent tool has no scope validation

- **WHEN** the Agent tool executes with a model parameter
- **THEN** no scope-models validation occurs — the model is used as-is (subject to existing model resolution logic only)

#### Scenario: Settings has no scope models item

- **WHEN** the user opens `/agents` → Settings
- **THEN** there is no "Scope models" setting item
