## ADDED Requirements

### Requirement: Scout agent is registered as a default agent with fastest-model preference

The system SHALL register a default agent named "Scout" with read-only tools (read, bash, grep, find, ls), `modelPreference: "fastest"`, and `promptMode: "replace"`. The Scout agent SHALL NOT have a hardcoded `model` string — its model SHALL be resolved at spawn time by `selectModel("fastest", registry)`.

#### Scenario: Scout is available for spawning

- **WHEN** the agent registry is initialized with defaults enabled
- **THEN** "Scout" appears in `getAvailableTypes()` and can be spawned via the Agent tool with `subagent_type: "Scout"`

#### Scenario: Scout resolves to fastest available model

- **WHEN** a Scout agent is spawned and the available models include flash and sonnet
- **THEN** the Scout is assigned a flash-class model, not sonnet

#### Scenario: Scout cannot write files

- **WHEN** a Scout agent attempts to use the `write` or `edit` tool
- **THEN** the tool is not available to the agent (blocked by tool scope)

### Requirement: Explore agent is removed

The system SHALL NOT register an agent named "Explore". The old Explore definition SHALL be removed from the DEFAULT_AGENTS map.

#### Scenario: Explore is not available

- **WHEN** the agent registry is initialized
- **THEN** "Explore" does not appear in `getAvailableTypes()`

### Requirement: Plan agent writes structured plan files with thinking-model preference

The system SHALL register a default agent named "Plan" with read-only tools, `modelPreference: "thinking"`, and `promptMode: "replace"`. The Plan agent SHALL NOT have a hardcoded `model` string — its model SHALL be resolved at spawn time by `selectModel("thinking", registry)`. The Plan agent's system prompt SHALL instruct it to output a markdown plan file containing a "## Checklist" section where each step uses `{#slug}` identifiers and optional `(depends on: slug, slug)` dependency declarations.

#### Scenario: Plan agent is read-only

- **WHEN** a Plan agent attempts to use the `write` or `edit` tool
- **THEN** the tool is not available to the agent

#### Scenario: Plan agent resolves to thinking-class model

- **WHEN** a Plan agent is spawned and the available models include sonnet and haiku
- **THEN** the Plan agent is assigned a sonnet-class model (best reasoning), not haiku

#### Scenario: Plan agent outputs checklist with slugs

- **WHEN** the Plan agent is asked to produce an implementation plan
- **THEN** its output includes a "## Checklist" section with steps in the format `- [ ] Task description {#task-slug}`

### Requirement: Crafter agent is registered as a default agent with inherit-model preference

The system SHALL register a default agent named "Crafter" with all built-in tools (including write and edit), `modelPreference: "inherit"`, and `promptMode: "replace"`. The Crafter agent SHALL NOT have a hardcoded `model` string — its model SHALL default to the parent session's model. The Crafter agent SHALL have write and edit capability.

#### Scenario: Crafter inherits parent model

- **WHEN** a Crafter agent is spawned and the parent session uses sonnet
- **THEN** the Crafter agent is assigned sonnet (the parent's model)

#### Scenario: Crafter can write files

- **WHEN** a Crafter agent uses the `write` tool
- **THEN** the tool is available and executes successfully

#### Scenario: Crafter is available for spawning

- **WHEN** the agent registry is initialized with defaults enabled
- **THEN** "Crafter" appears in `getAvailableTypes()`

### Requirement: Gatekeeper agent is registered as a default agent with thinking-model preference

The system SHALL register a default agent named "Gatekeeper" with read-only tools ONLY (read, bash, grep, find, ls), `modelPreference: "thinking"`, and `promptMode: "replace"`. The Gatekeeper agent SHALL NOT have a hardcoded `model` string — its model SHALL be resolved at spawn time by `selectModel("thinking", registry)`. The Gatekeeper agent SHALL NOT have access to write or edit tools.

#### Scenario: Gatekeeper is read-only

- **WHEN** a Gatekeeper agent attempts to use the `write` or `edit` tool
- **THEN** the tool is not available to the agent

#### Scenario: Gatekeeper resolves to thinking-class model

- **WHEN** a Gatekeeper agent is spawned and the available models include sonnet and haiku
- **THEN** the Gatekeeper is assigned a sonnet-class model, not haiku

#### Scenario: Gatekeeper is available for spawning

- **WHEN** the agent registry is initialized with defaults enabled
- **THEN** "Gatekeeper" appears in `getAvailableTypes()`

### Requirement: DEFAULT_AGENT_NAMES reflects the new agent lineup

The system SHALL update the `DEFAULT_AGENT_NAMES` constant in `src/types.ts` to `["general-purpose", "Scout", "Plan", "Crafter", "Gatekeeper"]`.

#### Scenario: Default agent names include new agents

- **WHEN** the constant is read
- **THEN** it contains exactly `["general-purpose", "Scout", "Plan", "Crafter", "Gatekeeper"]` and does NOT contain "Explore"

### Requirement: General-purpose agent is unchanged

The system SHALL keep the "general-purpose" default agent definition unchanged from its current state (all tools, append prompt mode, isDefault: true).

#### Scenario: General-purpose agent still works

- **WHEN** `getAvailableTypes()` is called
- **THEN** "general-purpose" appears in the list
