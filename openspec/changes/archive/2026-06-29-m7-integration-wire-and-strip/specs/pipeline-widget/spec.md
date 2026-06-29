## ADDED Requirements

### Requirement: Pipeline widget displays phase and step progress

The system SHALL render a pipeline progress widget in the editor area via `ctx.ui.setWidget("pipeline", <content>)`. The widget SHALL display: the current pipeline title, the current phase, and per-step status with icons (🟢 working, 🟡 queued, ✅ done, ❌ failed). The widget SHALL update on every phase and step transition.

#### Scenario: Widget shows Scout phase

- **WHEN** the pipeline enters the "scout" phase
- **THEN** the widget displays "🔍 Pipeline: <title> [scout]" with no steps yet

#### Scenario: Widget shows crafting phase with concurrent steps

- **WHEN** the pipeline enters the "crafting" phase with two dispatched Crafters on independent steps
- **THEN** the widget displays both steps with 🟢 (dispatched) icons

#### Scenario: Widget shows mixed step status

- **WHEN** one step is completed (✅) and another is queued waiting for a dependency (🟡)
- **THEN** the widget displays both statuses accurately

### Requirement: Pipeline widget uses a separate key from AgentWidget

The system SHALL use key `"pipeline"` for the pipeline widget to avoid collision with `AgentWidget`'s internal widget key. The pipeline widget SHALL coexist with AgentWidget and FleetList without interference.

#### Scenario: Pipeline widget coexists with AgentWidget

- **WHEN** a pipeline is running and agents are also active via AgentWidget
- **THEN** both widgets render without overlap or key collision

### Requirement: Widget clears when no pipeline is active

The system SHALL clear the pipeline widget (call `setWidget("pipeline", undefined)`) when no pipeline task is active.

#### Scenario: Widget clears after pipeline completion

- **WHEN** the pipeline completes and is archived
- **THEN** the pipeline widget is removed from the editor area

#### Scenario: Widget clears after pipeline abort

- **WHEN** the user aborts the pipeline
- **THEN** the pipeline widget is removed from the editor area

### Requirement: Widget shows Gatekeeper round count

The system SHALL display the current Gatekeeper round count when the pipeline is in the gatekeeping phase.

#### Scenario: Widget shows Gatekeeper round

- **WHEN** the pipeline is in the gatekeeping phase on round 2 of 3
- **THEN** the widget displays "🛡️ Pipeline: <title> [gatekeeping]" and "Gatekeeper round: 2/3"

### Requirement: UI context is available for widget rendering

The system SHALL provide the orchestrator with access to `ctx.ui` through a lazy context getter, set from the `tool_execution_start` hook (the same place where `AgentWidget` and `FleetList` receive their UI context).

#### Scenario: UI context set on tool execution start

- **WHEN** a `tool_execution_start` event fires
- **THEN** the orchestrator's `getCtx()` returns a context with a valid `ui` property for widget rendering
