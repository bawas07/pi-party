## Why

pi-party's M1-M5 milestones delivered the building blocks — agent definitions, plan files, trigger hooks, planning gate, and conflict ledger — but nothing threads them together. Without an orchestrator, the pipeline is a collection of disconnected parts. The main agent must manually coordinate each phase, defeating the purpose of ambient-triggered automation and mid-run steering. This change connects everything into a single event-driven pipeline that runs autonomously while keeping the main agent free.

## What Changes

- Add a new `Orchestrator` class (`src/orchestrator.ts`) that drives the full Scout → Plan → approval → Crafter dispatch → Gatekeeper → fix loop pipeline
- Pipeline runs as a background event-driven state machine — no blocking calls, no foreground phases
- Each phase dispatches a background agent via `AgentManager.spawn()` and reacts to `subagents:*` lifecycle events
- Scout dispatch is gated independently by `needsScout` from the trigger hook
- Plan dispatch runs after Scout completes (or directly if Scout wasn't needed)
- User approval UI presented asynchronously on Plan completion; sets trust mode and opens the planning gate
- Crafter dispatch is concurrent-aware: `unblockedSteps()` identifies candidate steps, Ledger cross-checks prevent file conflicts, multiple Crafters run in parallel on independent steps
- Gatekeeper dispatch triggers after all steps complete; fix loop maxes at 3 rounds
- Plan file archived on completion; summary reported to user
- Main agent remains free to field side-questions and relay steering messages throughout
- Pipeline status widget shows per-phase/per-step progress with concurrent Crafter rows

## Capabilities

### New Capabilities
- `event-driven-orchestrator`: The pipeline orchestration engine that wires Scout, Plan, Crafter, and Gatekeeper into a single autonomous flow. Manages phase transitions, concurrent Crafter coordination, Gatekeeper fix loops, and user approval gating.

### Modified Capabilities
<!-- No existing spec requirements change. The orchestrator is purely additive — consuming existing APIs from plan-file, ledger, trigger, and planning-gate without modifying their contracts. -->

## Impact

- **New file**: `src/orchestrator.ts` (~400-600 lines expected)
- **New test file**: `test/orchestrator.test.ts`
- **Consumed modules** (no changes): `plan-file.ts`, `ledger.ts`, `trigger.ts`, `planning-gate.ts`, `agent-manager.ts`, `agent-widget.ts`, `fleet-list.ts`
- **Event system**: Listens to existing `subagents:created/started/completed/failed/steered/compacted` events
- **No API changes**: existing tools and commands unchanged; orchestrator is additive infrastructure
- **Integration point for M7**: `index.ts` will wire the orchestrator in M7 (this milestone delivers a tested, self-contained module)
