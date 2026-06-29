## ADDED Requirements

### Requirement: Detect if an agent type is write-capable

The system SHALL provide an `isWriteCapable(typeName: string): boolean` function that returns `true` if the resolved tool set for the given agent type includes `"write"` or `"edit"`. The function SHALL use `getToolNamesForType()` from the existing `agent-types.ts` module.

#### Scenario: Crafter is write-capable

- **WHEN** `isWriteCapable("Crafter")` is called
- **THEN** `true` is returned (Crafter has all built-in tools including write/edit)

#### Scenario: Scout is not write-capable

- **WHEN** `isWriteCapable("Scout")` is called
- **THEN** `false` is returned (Scout has read-only tools)

#### Scenario: General-purpose is write-capable

- **WHEN** `isWriteCapable("general-purpose")` is called
- **THEN** `true` is returned (general-purpose has all tools by omission of `builtinToolNames`)

### Requirement: Block write-capable spawns without approved plan

The system SHALL provide a `checkPlanningGate(input: PlanningGateInput): PlanningGateResult` function. When the subagent type is write-capable, no approved plan exists, and `noPlanIntent` is `false`, the function SHALL return `{ allowed: false, message: "<rejection reason>" }`.

#### Scenario: Write-capable spawn rejected without plan

- **WHEN** `checkPlanningGate({ subagentType: "Crafter", hasApprovedPlan: false, noPlanIntent: false })` is called
- **THEN** `{ allowed: false }` is returned with a message directing to run Plan first

#### Scenario: Write-capable spawn allowed with approved plan

- **WHEN** `checkPlanningGate({ subagentType: "Crafter", hasApprovedPlan: true, noPlanIntent: false })` is called
- **THEN** `{ allowed: true }` is returned

### Requirement: Allow read-only spawns without a plan

The system SHALL allow Agent spawns for read-only types regardless of plan state. Scout, Plan, and Gatekeeper SHALL always pass the gate.

#### Scenario: Scout spawn allowed without plan

- **WHEN** `checkPlanningGate({ subagentType: "Scout", hasApprovedPlan: false, noPlanIntent: false })` is called
- **THEN** `{ allowed: true }` is returned

#### Scenario: Gatekeeper spawn allowed without plan

- **WHEN** `checkPlanningGate({ subagentType: "Gatekeeper", hasApprovedPlan: false, noPlanIntent: false })` is called
- **THEN** `{ allowed: true }` is returned

### Requirement: Bypass gate when user explicitly says no plan needed

The system SHALL bypass the planning gate entirely when `noPlanIntent` is `true`, regardless of the agent type's write capability or plan state.

#### Scenario: No-plan bypass for write-capable agent

- **WHEN** `checkPlanningGate({ subagentType: "Crafter", hasApprovedPlan: false, noPlanIntent: true })` is called
- **THEN** `{ allowed: true }` is returned

#### Scenario: No-plan bypass for read-only agent

- **WHEN** `checkPlanningGate({ subagentType: "Scout", hasApprovedPlan: false, noPlanIntent: true })` is called
- **THEN** `{ allowed: true }` is returned

### Requirement: Custom user agents are evaluated by their actual tool set

The system SHALL evaluate custom user-defined agents based on their resolved tool set (via `getToolNamesForType()`), not their name or category. A custom agent with explicit read-only tools SHALL pass the gate; a custom agent with all tools (by omission) SHALL be blocked without a plan.

#### Scenario: Custom read-only agent passes

- **WHEN** a custom agent has `builtinToolNames: ["read", "grep"]` and no write/edit
- **THEN** `checkPlanningGate()` returns `{ allowed: true }` regardless of plan state

#### Scenario: Custom all-tools agent is blocked

- **WHEN** a custom agent has no `builtinToolNames` (all tools) and no approved plan
- **THEN** `checkPlanningGate()` returns `{ allowed: false }`
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
