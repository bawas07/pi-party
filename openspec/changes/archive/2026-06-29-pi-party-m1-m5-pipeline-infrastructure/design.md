## Context

pi-party is a fork of `@tintinweb/pi-subagents` v0.12.0, transforming it from a general-purpose subagent spawner into a structured pipeline orchestration extension. The existing codebase has 3 default agents (general-purpose, Explore, Plan), an agent registry that merges defaults with user-defined agents from `.pi/agents/*.md`, a type-agnostic spawn system (`AgentManager`), worktree isolation (`worktree.ts`), and a scheduling system that will be removed in Milestone 7.

The five infrastructure modules in this change (M1–M5) are all prerequisites for the event-driven orchestrator (M6). They share no runtime dependencies with each other — the orchestrator is their only consumer. This makes them suitable for parallel implementation within a single change.

## Goals / Non-Goals

**Goals:**
- Register 5 pipeline-ready agent types (Scout, Plan, Crafter, Gatekeeper, general-purpose) via the existing `DEFAULT_AGENTS` map
- Provide a plan file module that writes, reads, checks off, archives, and dependency-queries structured markdown plans
- Provide rule-based trigger hooks that evaluate codebase-information need, implement-intent, and explicit no-plan signals on every turn
- Provide a structural gate that blocks write-capable agent spawns without an approved plan
- Provide a ledger that tracks file-level claims across concurrent Crafters for safe parallel dispatch

**Non-Goals:**
- The event-driven orchestrator itself (M6)
- Wiring hooks, gate, or ledger into `index.ts` (M7)
- Removing scheduling or model-scope enforcement (M7)
- Plan approval UX, trust mode, or user-facing pipeline interactions (M6)
- Persistence of ledger across session restart (in-memory only for now)

## Decisions

### Decision 1: Scout replaces Explore (not a new agent alongside it)

**Rationale**: Explore and Scout would have identical tool sets (read-only) and the same model (haiku). The difference is purely in system prompt posture — Scout is proactive ("codebase knowledge provider") vs. Explore's "file search specialist." Having both would confuse the type list. The roadmap explicitly says "Replace Explore with Scout."

**Alternative considered**: Keep Explore and add Scout as a new type. Rejected — two nearly-identical read-only agents adds cognitive overhead with no benefit. Users who want the old Explore behavior can define a custom agent.

### Decision 2: Plan agent writes directly to `docs/tasks/` (not through the plan-file module)

**Rationale**: The Plan agent is an LLM — it generates markdown text. The plan-file module (`writePlan`) expects structured content. Having Plan call `writePlan` internally would require either: (a) the Plan agent having access to the plan-file module's logic (it doesn't — it's an LLM in a subagent), or (b) the orchestrator parsing Plan's output and calling `writePlan` itself (which is what M6 will do). For M1, Plan's system prompt instructs it to output markdown following the template. The orchestrator (M6) will consume that output and persist it via the plan-file module.

**Alternative considered**: Have Plan call a tool to write the plan file. Rejected — Plan is a read-only agent (enforced by `builtinToolNames`). Adding write capability to Plan changes its security profile and violates the "Plan never writes code" principle.

### Decision 3: Rule-based trigger classification (not LLM-based)

**Rationale**: The trigger hook runs every turn. An LLM call per turn would be expensive and add latency. Rule-based keyword/pattern matching is fast, deterministic, and testable. The roadmap explicitly says: "Decide cost/model profile for the hook itself — should be cheap/fast."

**Alternative considered**: Haiku-based classification. Deferred — if rule-based proves insufficient after real usage, the function signatures are designed to accommodate either approach. The switch requires changing only the implementation, not callers.

### Decision 4: Planning gate is a pure function, not middleware

**Rationale**: The gate should be testable in isolation. As a pure function `checkPlanningGate(input) → result`, it has no side effects and no knowledge of the Agent tool's execution context. The integration point is a single function call in the Agent tool's `execute` function (wired in M7). This also means the gate can be tested without mocking any pi framework APIs.

**Alternative considered**: Middleware/interceptor pattern patching `manager.spawn()`. Rejected — harder to test, couples the gate to internal spawn mechanics, and makes it less obvious where the gate fires.

### Decision 5: Ledger is in-memory only (not persisted)

**Rationale**: The orchestrator (M6) is the ledger's only consumer. If the session restarts mid-pipeline, the orchestrator re-evaluates from plan file state — the ledger's state is a runtime optimization, not a source of truth. Persisting it adds serialization/deserialization complexity without a clear benefit at this stage.

**Alternative considered**: Persist via `pi.appendEntry`. Deferred — the roadmap's open question about ledger persistence remains unresolved. If persistence is needed later, the `Ledger` class API (claim/release/getConflictingFiles) doesn't change — only the internal storage and initialization.

### Decision 7: Dynamic model selection — config first, auto-assignment as fallback

**Rationale**: Hardcoding model strings breaks across providers (Anthropic vs OpenAI vs Gemini) and across model deprecations. Pattern-matching on model names ("flash", "sonnet") is provider-specific and fragile. The correct approach: let the user configure their preferred models explicitly, and provide a sensible auto-assignment fallback for when they don't.

**Two-tier resolution**:
1. **Config-driven (primary)**: User sets `modelPreferences: { thinking?, fast? }` in `subagents.json`. If a preference is configured and the model exists in the registry → use it directly. No heuristics, no guessing.
2. **Auto-assignment (fallback)**: If not configured (or configured model is unavailable), rank available models by context window size. "Fastest" = smallest context window (proxy for speed/cost). "Thinking" = largest context window (proxy for reasoning capability). Provider-agnostic — works with any model from any provider.

**Agent preference mapping**:
- Scout → `"fastest"` (read-only exploration, needs speed not depth)
- Plan → `"thinking"` (needs deep reasoning for architecture decisions)
- Crafter → `"inherit"` (uses parent session's model; user already chose it)
- Gatekeeper → `"thinking"` (needs deep analysis across code/architecture/security)

**Implementation**: `selectModel(preference, registry, parentModel?, modelPreferences?)` in `model-resolver.ts`. The `modelPreferences` parameter is read from settings at spawn time. The `modelPreferences` setting is added to `SubagentsSettings` in `settings.ts` with the same global+project merge behavior as all other settings.

**Alternative considered**: Pure auto-assignment with provider-specific name heuristics (flash/haiku/sonnet/opus). Rejected — doesn't work for non-Claude providers, creates maintenance burden as models get renamed/released.

### Decision 8: Gatekeeper uses one agent with three internal review lenses (not three sub-agents)

**Rationale**: The roadmap says Gatekeeper is one agent type. Spawning three separate sub-agents (code-reviewer, architect-reviewer, security-auditor) from within Gatekeeper would be a second layer of sub-agent orchestration — complex, hard to debug, and slow. Instead, Gatekeeper's system prompt instructs it to think through all three perspectives in a single pass. The output classifies findings by type.

**Alternative considered**: Gatekeeper spawns three internal sub-agents and synthesizes their output. Rejected — adds latency, cost (3x LLM calls per review), and failure modes (partial results if one sub-agent errors out). The single-pass approach is simpler and sufficient for v1.

## Risks / Trade-offs

| Risk | Impact | Mitigation |
|---|---|---|
| **Plan agent doesn't follow the `{#slug}` syntax reliably** | Medium — orchestrator can't parse dependencies, concurrent dispatch breaks | Plan's system prompt includes examples and a "MUST" constraint on slug format. Plan-file module's parser is tolerant (unknown slugs don't block). Orchestrator can fall back to sequential execution. |
| **Rule-based trigger misclassifies intent** | Medium — false negatives miss pipeline triggers, false positives trigger unnecessary plans | Three-tier design with medium "ask" tier catches ambiguity. Rule patterns are documented and testable. Upgrade path to LLM classification exists. |
| **Gate blocks legitimate quick fixes** | Low — users can't do single-line edits without a plan | `noPlanIntent` hook is the escape hatch. User says "no need to plan, just fix X" and the gate opens. The hook is conservative but the bypass is always one sentence away. |
| **Ledger conflict detection is conservative (estimated files, not actual)** | Low — false conflicts hold back steps unnecessarily but never allow unsafe concurrency | False conflicts only delay, never corrupt. Worktree isolation (M7) provides a second safety layer for any misses. |

## Open Questions

- **Trigger hook point**: Confirmed hook name in the ExtensionAPI event list. `tool_execution_start` is the current assumption; validate before M7 wiring.
- **Ledger persistence**: In-memory for now; revisit after M6 integration testing reveals whether session-restart scenarios are common enough to justify persistence.
- **Skill preloading for `coding-standards`**: The `skills: true` on Crafter and Gatekeeper means all installed skills are available. If we want only `coding-standards`, use `skills: ["coding-standards"]`. Finalize during M1 implementation based on how the skill system resolves explicit skill lists.
