## ADDED Requirements

### Requirement: Detect explicit no-plan intent

The system SHALL provide a `noPlanIntent(ctx: TurnContext): boolean` function that returns `true` ONLY when the user's message contains explicit language stating that planning should be skipped. The function SHALL use pattern matching against known skip-planning phrases ("no need to plan", "skip the plan", "don't plan", "just do it directly", "no planning needed", "implement directly", "without a plan"). The function SHALL NOT return `true` for casual or brief phrasing alone ("just fix it", "quick change", "simple").

#### Scenario: Explicit no-plan language detected

- **WHEN** the user message is "I found a bug in the login, update it to use bcrypt, no need to plan, just implement it directly"
- **THEN** `noPlanIntent()` returns `true`

#### Scenario: Casual phrasing is not no-plan

- **WHEN** the user message is "just fix the login bug"
- **THEN** `noPlanIntent()` returns `false`

#### Scenario: No planning language at all

- **WHEN** the user message is "add JWT authentication to the API"
- **THEN** `noPlanIntent()` returns `false`

### Requirement: Detect implement-intent strength

The system SHALL provide an `implementIntent(ctx: TurnContext): "high" | "medium" | "low"` function that classifies the user's message into three tiers. This function SHALL only be called when `noPlanIntent()` returns `false`.

- **High**: Clear implementation request with action verbs ("build", "create", "implement", "add feature", "write code for", "refactor ... to", "migrate", "set up", "scaffold")
- **Medium**: Ambiguous — could be implementation or discussion. Includes questions with implementation-adjacent language ("how would I", "should I", "what do you think about")
- **Low**: Everything else — pure Q&A, explanation, debugging without fix request, general chat

#### Scenario: Clear implementation request

- **WHEN** the user message is "build a login system with JWT"
- **THEN** `implementIntent()` returns `"high"`

#### Scenario: Ambiguous question about implementation

- **WHEN** the user message is "how would I add JWT authentication to the API?"
- **THEN** `implementIntent()` returns `"medium"`

#### Scenario: Pure Q&A

- **WHEN** the user message is "what does git status do?"
- **THEN** `implementIntent()` returns `"low"`

#### Scenario: Refactoring request

- **WHEN** the user message is "refactor the auth module to use JWT instead of sessions"
- **THEN** `implementIntent()` returns `"high"`

### Requirement: Detect need for codebase exploration

The system SHALL provide a `needsScout(ctx: TurnContext): boolean` function that returns `true` when answering or proceeding requires codebase knowledge the main agent does not already have. The function SHALL return `false` for: file-tree/structure lookups, questions about markdown or config files (`*.md`, `package.json`, `tsconfig.json`), and lookups where the target path is already known.

#### Scenario: Codebase exploration needed

- **WHEN** the user message is "where is the auth middleware defined?"
- **THEN** `needsScout()` returns `true`

#### Scenario: Config file lookup excluded

- **WHEN** the user message is "read package.json for me"
- **THEN** `needsScout()` returns `false`

#### Scenario: General question excluded

- **WHEN** the user message is "what does this error message mean?"
- **THEN** `needsScout()` returns `false`

#### Scenario: File-tree lookup excluded

- **WHEN** the user message is "list all .ts files in src/"
- **THEN** `needsScout()` returns `false`

### Requirement: Combined evaluation of all hooks

The system SHALL provide an `evaluateAll(ctx: TurnContext): TriggerResult` function that runs all three hooks and returns a combined result with `noPlanIntent`, `implementIntent`, and `needsScout` fields. `implementIntent` SHALL only be computed when `noPlanIntent` is `false`.

#### Scenario: All hooks fire for a clear implementation request

- **WHEN** `evaluateAll()` is called with "build a login system"
- **THEN** the result is `{ noPlanIntent: false, implementIntent: "high", needsScout: true }`

#### Scenario: No-plan overrides implement-intent

- **WHEN** `evaluateAll()` is called with "build a login system, no need to plan"
- **THEN** the result has `noPlanIntent: true` and `implementIntent` is not evaluated (defaults to `"low"`)
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
