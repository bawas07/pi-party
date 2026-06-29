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
