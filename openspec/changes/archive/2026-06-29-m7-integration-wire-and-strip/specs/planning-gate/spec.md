## ADDED Requirements

### Requirement: Planning gate intercepts Agent tool execution

The system SHALL call `checkPlanningGate()` before every `manager.spawn()` or `manager.spawnAndWait()` call in the Agent tool's execute handler. The gate check SHALL run after parameter resolution (so `subagentType` is known) but before any spawn call. On rejection, the execute handler SHALL return a `textResult` with the rejection message instead of spawning.

#### Scenario: Gate blocks write-capable spawn before it starts

- **WHEN** the Agent tool is called with `subagent_type: "Crafter"` and no approved plan exists
- **THEN** `checkPlanningGate()` returns `{ allowed: false }` and the tool returns a text error directing to run Plan first — no agent is spawned

#### Scenario: Gate passes for write-capable spawn with approved plan

- **WHEN** the Agent tool is called with `subagent_type: "Crafter"` and an approved plan exists
- **THEN** `checkPlanningGate()` returns `{ allowed: true }` and the agent is spawned normally

### Requirement: noPlanIntent flag is a one-shot consumed by the gate

The system SHALL manage a one-shot `noPlanIntent` flag set by the trigger hook. The planning gate at the Agent tool execute site SHALL consume this flag: pass it to `checkPlanningGate()`, and clear it immediately after consumption. If no write-capable spawn occurs in a turn where the flag was set, the flag SHALL be cleared at the next `turn_start`.

#### Scenario: Flag consumed on first write-capable spawn

- **WHEN** `noPlanIntent` flag is `true` and a write-capable agent is spawned via Agent tool
- **THEN** `checkPlanningGate()` receives `noPlanIntent: true`, returns `{ allowed: true }`, and the flag is cleared

#### Scenario: Flag not consumed by read-only spawn

- **WHEN** `noPlanIntent` flag is `true` and a read-only agent (Scout) is spawned via Agent tool
- **THEN** `checkPlanningGate()` returns `{ allowed: true }` (read-only is always allowed), and the flag is NOT cleared — it stays for potential write-capable spawns later in the turn

### Requirement: Agent resume bypasses the planning gate

The system SHALL NOT apply the planning gate check when the Agent tool is called with a `resume` parameter. Resuming an existing agent does not create a new write-capable session.

#### Scenario: Resume bypasses gate

- **WHEN** the Agent tool is called with `resume: "<existing-agent-id>"`
- **THEN** no `checkPlanningGate()` call is made — the resume proceeds directly
