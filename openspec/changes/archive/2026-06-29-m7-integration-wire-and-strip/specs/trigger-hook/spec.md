## ADDED Requirements

### Requirement: Trigger hook is registered on turn_start

The system SHALL register the trigger evaluation on `pi.on("turn_start")` so that `evaluateAll()` runs on every conversation turn, before the main agent processes the turn.

#### Scenario: Trigger evaluates on every turn

- **WHEN** a new conversation turn starts (user sends a message)
- **THEN** the trigger hook fires and runs `evaluateAll()` with the user's message

#### Scenario: Trigger does not crash on missing user message

- **WHEN** the user message cannot be extracted from session entries at turn start
- **THEN** the trigger hook skips evaluation gracefully (no error, no crash)

### Requirement: Trigger results route to concrete actions

The system SHALL route trigger results to concrete extension actions:

- `implementIntent: "high"` and `pipelineEnabled` → call `orchestrator.startPipeline()`
- `implementIntent: "medium"` → surface a question to the user via `pi.sendMessage()`
- `needsScout: true` → dispatch a Scout background agent independently of implement intent
- `noPlanIntent: true` → set the one-shot flag consumed by the planning gate

#### Scenario: High intent starts pipeline

- **WHEN** `evaluateAll()` returns `{ implementIntent: "high", needsScout: true, noPlanIntent: false }`
- **THEN** `orchestrator.startPipeline()` is called with `needsScout: true`

#### Scenario: Medium intent surfaces question

- **WHEN** `evaluateAll()` returns `{ implementIntent: "medium" }`
- **THEN** a message is sent to the user asking if they want a plan created

#### Scenario: Scout fires independently of low implement intent

- **WHEN** `evaluateAll()` returns `{ implementIntent: "low", needsScout: true }`
- **THEN** a Scout background agent is dispatched, but `startPipeline()` is NOT called

### Requirement: Trigger hook is gated by pipelineEnabled switch

The system SHALL suppress pipeline auto-start (high intent → `startPipeline()`) when `pipelineEnabled` is `false`. Scout dispatch from `needsScout` SHALL NOT be gated by this switch.

#### Scenario: Pipeline disabled prevents auto-start

- **WHEN** `pipelineEnabled` is `false` and `implementIntent` is `"high"`
- **THEN** `orchestrator.startPipeline()` is NOT called

#### Scenario: Pipeline disabled does not suppress Scout

- **WHEN** `pipelineEnabled` is `false` and `needsScout` is `true`
- **THEN** a Scout background agent IS dispatched
