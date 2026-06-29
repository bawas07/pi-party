## ADDED Requirements

### Requirement: User-configured model preferences in subagents.json

The system SHALL support a `modelPreferences` object in `subagents.json` (both project `.pi/subagents.json` and global `<agentDir>/subagents.json`) with optional `thinking` and `fast` string fields. Each field SHALL accept a model identifier in `"provider/modelId"` format. Project settings SHALL override global settings (same merge behavior as all other subagents settings).

#### Scenario: Both preferences configured

- **WHEN** `subagents.json` contains `{ "modelPreferences": { "thinking": "openai/gpt-5", "fast": "openai/gpt-4o-mini" } }`
- **THEN** `selectModel("thinking", registry)` returns `gpt-5` and `selectModel("fastest", registry)` returns `gpt-4o-mini`

#### Scenario: Only thinking configured, fast falls back to auto

- **WHEN** `subagents.json` contains `{ "modelPreferences": { "thinking": "anthropic/claude-sonnet-4-6" } }` with no `fast` key
- **THEN** `selectModel("thinking", registry)` returns the configured model; `selectModel("fastest", registry)` falls back to auto-assignment

#### Scenario: No modelPreferences set at all

- **WHEN** `subagents.json` has no `modelPreferences` field
- **THEN** both `selectModel("thinking", ...)` and `selectModel("fastest", ...)` fall back to auto-assignment

### Requirement: Config-driven model resolution takes priority

The system SHALL check the configured `modelPreferences` before attempting auto-assignment. If a configured model exists in the available registry, it SHALL be returned immediately without any heuristic evaluation. If the configured model is NOT in the available registry, the system SHALL emit a warning and fall back to auto-assignment for that preference.

#### Scenario: Configured model is available

- **WHEN** `modelPreferences.thinking` is `"anthropic/claude-sonnet-4-6"` and that model is in the registry
- **THEN** `selectModel("thinking", registry)` returns that model directly

#### Scenario: Configured model is unavailable

- **WHEN** `modelPreferences.thinking` is set to a model not in the available registry
- **THEN** a warning is emitted and the system falls back to auto-assignment

### Requirement: Auto-assign fastest model (fallback)

The system SHALL provide auto-assignment for `"fastest"` preference when no config is set or the configured model is unavailable. The auto-assignment SHALL rank available models by context window size ascending (smallest first, as proxy for speed/cost) and return the smallest. The system SHALL NOT use provider-specific model name patterns.

#### Scenario: Multiple models with different context windows

- **WHEN** the registry has models with context windows of 8K, 32K, and 200K and no `modelPreferences.fast` is configured
- **THEN** `selectModel("fastest", registry)` returns the 8K context model

#### Scenario: All models have same context window

- **WHEN** all available models have the same context window size
- **THEN** `selectModel("fastest", registry)` returns the first available model alphabetically by provider/id

### Requirement: Auto-assign best thinking model (fallback)

The system SHALL provide auto-assignment for `"thinking"` preference when no config is set or the configured model is unavailable. The auto-assignment SHALL rank available models by context window size descending (largest first, as proxy for reasoning capability) and return the largest. The system SHALL NOT use provider-specific model name patterns.

#### Scenario: Multiple models with different context windows

- **WHEN** the registry has models with context windows of 8K, 32K, and 200K and no `modelPreferences.thinking` is configured
- **THEN** `selectModel("thinking", registry)` returns the 200K context model

### Requirement: Inherit parent model

The system SHALL provide `selectModel(preference: "inherit", registry, parentModel)` that returns the parent session's model unchanged. If the parent model is not in the available registry, the system SHALL fall back to `selectModel("thinking", registry)` (config first, then auto).

#### Scenario: Parent model is available

- **WHEN** `selectModel("inherit", registry, parentModel)` is called and the parent model is in the registry
- **THEN** the parent model is returned unchanged

#### Scenario: Parent model is unavailable

- **WHEN** `selectModel("inherit", registry, parentModel)` is called and the parent model is not in the available registry
- **THEN** a thinking-class model is returned as fallback (via config or auto)

### Requirement: selectModel accepts optional modelPreferences config

The system SHALL provide a `selectModel(preference, registry, parentModel?, modelPreferences?)` function where `modelPreferences` is an optional `{ thinking?: string, fast?: string }` object read from settings. When provided, config-driven resolution SHALL be attempted first; when omitted, the function SHALL proceed directly to auto-assignment.

#### Scenario: modelPreferences provided with matching config

- **WHEN** `selectModel("thinking", registry, undefined, { thinking: "openai/gpt-5" })` is called
- **THEN** config-driven resolution returns `gpt-5`

#### Scenario: modelPreferences omitted entirely

- **WHEN** `selectModel("fastest", registry)` is called without modelPreferences
- **THEN** auto-assignment runs directly (smallest context window)

### Requirement: No models available throws descriptive error

The system SHALL throw an error with a clear message when `selectModel()` is called against an empty registry. The error message SHALL describe the preference requested and state that no models are available.

#### Scenario: Empty registry

- **WHEN** `selectModel("fastest", emptyRegistry)` is called
- **THEN** an error is thrown with message indicating no models are available
