## Why

The pi-party roadmap defines a structured explore→plan→build→verify pipeline that transforms pi-subagents from a general-purpose subagent spawner into a purpose-built orchestration extension. Before the orchestrator (Milestone 6) can drive that pipeline, five infrastructure modules must exist: agent type definitions, a plan file system, intent-detection hooks, a structural planning gate, and a conflict-tracking ledger. These building blocks are independently testable, share no runtime dependencies with each other, and all converge on the orchestrator as their single consumer.

## What Changes

- **Replace** the `Explore` agent with `Scout` — a proactive codebase knowledge provider with the same read-only tool set but a broader posture, dynamically assigned the fastest available model
- **Replace** the old `Plan` agent with a pipeline-aware Plan that writes structured, machine-parseable plan files with labeled steps and explicit dependencies, dynamically assigned the best thinking model
- **Add** `Crafter` — an implementation agent (write/edit enabled) that executes one checklist step per instance, self-reviews against coding standards, and inherits the parent session's model
- **Add** `Gatekeeper` — a read-only QA agent that reviews implementation through three lenses (code quality, architecture, security), runs tests, classifies issues as in-scope or out-of-scope, dynamically assigned the best thinking model
- **Add** dynamic model auto-assignment (`selectModel()` in `model-resolver.ts`) — resolves agent `modelPreference` (`"fastest"`, `"thinking"`, `"inherit"`) against the actual available model registry at spawn time. No hardcoded model strings — adapts automatically as the user's available models change.
- **Add** a plan file module (`src/plan-file.ts`) providing CRUD operations, dependency parsing (`{#slug}` / `depends on:` syntax), and external spec translation for `docs/tasks/` plan files
- **Add** a trigger hook module (`src/trigger.ts`) that evaluates `needsScout`, `noPlanIntent`, and `implementIntent` every turn using rule-based classification — independent of the main agent's prompt
- **Add** a planning gate module (`src/planning-gate.ts`) that structurally intercepts Agent tool calls and blocks write-capable spawns unless an approved plan exists (single bypass: user explicitly says no plan needed)
- **Add** a ledger module (`src/ledger.ts`) that tracks file-level claims by in-flight Crafters and provides a pre-dispatch conflict check so concurrent Crafters never touch the same file

None of these modules depend on each other at runtime. The planning gate imports `getToolNamesForType` from the existing `agent-types.ts` (stable, unchanged). The trigger, plan-file, gate, and ledger modules are pure infrastructure consumed by the orchestrator (Milestone 6).

## Capabilities

### New Capabilities

- `pipeline-agent-definitions`: Default agent types Scout, Plan, Crafter, and Gatekeeper registered in the agent registry alongside the existing general-purpose agent. Each has a defined tool scope, `modelPreference`, and system prompt. Scout and Gatekeeper are read-only; Crafter is write-capable; Plan is read-only and produces structured plan files. Models are resolved dynamically at spawn time by `selectModel()`, not hardcoded.

- `model-auto-assignment`: Dynamic model selection — config first, auto-assignment as fallback. Users can set `modelPreferences: { thinking?, fast? }` in `subagents.json` for explicit control. When not configured, `selectModel()` ranks available models by context window size (ascending for "fastest", descending for "thinking") — provider-agnostic, works with any LLM provider.

- `plan-file-module`: Write, read, check off, archive, and dependency-query structured plan files in `docs/tasks/`. Supports label-based step dependencies (`{#slug}` + `depends on: slug` syntax) and translation of user-authored external specs into the internal checklist format.

- `trigger-hook`: Rule-based, per-turn evaluation of three independent signals: whether the main agent needs codebase knowledge (`needsScout`), whether the user explicitly said to skip planning (`noPlanIntent`), and the strength of implement-intent (`implementIntent` — high/medium/low). All three are independent; `noPlanIntent` is checked first and short-circuits `implementIntent`.

- `planning-gate`: Structural interception of Agent tool spawns. Blocks write-capable subagent types (Crafter, general-purpose with all tools) unless an approved plan exists or `noPlanIntent` is true. Read-only agents (Scout, Plan, Gatekeeper) are never blocked.

- `ledger`: In-memory file-level conflict tracker. Records which files each in-flight Crafter claims. Provides a pre-dispatch check: if a candidate step's files overlap with an active Crafter's claims, the step waits even if its plan-file dependencies are satisfied.

### Modified Capabilities

<!-- No existing specs to modify — all capabilities are new -->
None.

## Impact

- **Files created**: `src/plan-file.ts`, `src/trigger.ts`, `src/planning-gate.ts`, `src/ledger.ts` (4 new modules)
- **Files modified**: `src/default-agents.ts` (replace Explore→Scout, Plan→new Plan, add Crafter/Gatekeeper with modelPreference), `src/types.ts` (update `DEFAULT_AGENT_NAMES`, add `ModelPreference`, add `modelPreference` to `AgentConfig`), `src/model-resolver.ts` (add `selectModel()` — config-first, auto-fallback), `src/settings.ts` (add `modelPreferences` to settings with sanitization and wiring)
- **Files NOT modified**: `src/agent-types.ts`, `src/agent-manager.ts`, `src/prompts.ts` (type-agnostic — work with any registered agent type)
- **Tests created**: `test/plan-file.test.ts`, `test/trigger.test.ts`, `test/planning-gate.test.ts`, `test/ledger.test.ts` (4 new test files); existing `test/model-resolver.test.ts` and `test/settings.test.ts` extended
- **Dependencies**: No new npm dependencies. All modules use Node.js built-ins (`fs`, `path`) + existing pi extension APIs.
- **Breaking**: The `Explore` agent name is removed. The old `Plan` agent's output format changes. Agent model resolution is no longer static — Scout no longer hardcodes haiku; Plan/Gatekeeper no longer blindly inherit the parent model.
