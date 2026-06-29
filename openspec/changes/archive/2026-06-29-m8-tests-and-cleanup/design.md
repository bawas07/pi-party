## Context

Milestones 1–7 delivered the pipeline infrastructure: agent definitions (M1), plan file module (M2), trigger hook (M3), planning gate (M4), ledger (M5), event-driven orchestrator (M6), and integration wiring + feature stripping (M7). All 35 test suites pass (686 tests, 4 skipped). The orchestrator test suite (`test/orchestrator.test.ts`, 961 lines) already covers sequential pipeline flow, dependency waiting, Ledger conflict, mid-run steering, Gatekeeper fix loop, and error handling — but the roadmap explicitly calls out two scenarios not yet tested: concurrent Crafters on independent steps and `/btw`-style side questions during pipeline execution.

The project identity also needs updating: `package.json` still names itself `@tintinweb/pi-subagents`, the README documents stripped features (scheduling, model scope), and the CHANGELOG needs a Milestone 8 entry.

## Goals / Non-Goals

**Goals:**
- Add integration test for concurrent Crafter dispatch (two independent steps, both dispatching simultaneously)
- Add integration test verifying the orchestrator doesn't block the main agent (simulated `/btw` scenario)
- Extend `test/agent-widget.test.ts` beyond its current token-formatting-only scope to cover concurrent-row and pipeline-phase rendering
- Extend `test/worktree.test.ts` with a concurrent-isolation test (two worktrees created simultaneously for two "Crafter instances")
- Update `README.md` to reflect the pi-party fork identity and remove docs for stripped features
- Update `CHANGELOG.md` with Milestone 8 entry
- Update `package.json` identity fields (name, description, URLs)

**Non-Goals:**
- No new source modules, no behavioral changes, no new features
- No refactoring of existing orchestrator logic
- No changes to the pipeline agent definitions or their system prompts

## Decisions

### 1. Concurrent-Crafter integration test approach

**Decision**: Test concurrent dispatch by setting up two independent steps (no `depends on`), calling `dispatchCrafters()`, then asserting both were spawned before either completes. Then complete one and verify the other is still tracked correctly.

This mirrors the existing test pattern (mock AgentManager's spawn tracking, mock event bus) — no new test infrastructure needed. The orchestrator's `unblockedSteps` + Ledger pre-dispatch check are the specific units under test here, not actual concurrent process execution (which is the run-time's concern).

**Alternatives considered**: End-to-end test with real subagent processes. Rejected — too flaky in CI (real LLM calls, timing-dependent), and the unit-level mock approach already proves the dispatch logic is correct.

### 2. `/btw` side-question test approach

**Decision**: Simulate by starting a pipeline, manually setting it to the "crafting" phase, then calling `startPipeline()` (or equivalent) with a second, unrelated task while the first is still in flight. Verify the orchestrator accepts the second call without error — i.e., it doesn't hold a global lock preventing parallel activity.

This doesn't test real concurrency of LLM turns (which is a pi runtime behavior, not an orchestrator behavior). It tests that the orchestrator's internal state model permits concurrent pipeline runs.

### 3. Agent widget test extension

**Decision**: Test the new widget rendering functions that were added in M6/M7: format for multi-Crafter rows (running, queued, done states), pipeline phase status text, and the concurrent-agent counter display. Keep tests at the formatting level (pure functions), not DOM/rendering (pi's widget API is not unit-testable).

### 4. Worktree concurrent-isolation test

**Decision**: Add one test: create two worktrees back-to-back, make changes in each independently, verify `cleanupWorktree` for one doesn't disturb the other's files, then clean up both. This proves the isolation mechanism holds when multiple instances run concurrently.

### 5. README rewrite scope

**Decision**: Keep the README structure but:
- Replace the title/header with pi-party identity
- Remove the Scheduling and Model Scope sections entirely (features stripped in M7)
- Update the Default Agent Types table (Explore → Scout, add Crafter/Gatekeeper)
- Add a brief Pipeline Orchestration section (already partially present)
- Update the Architecture diagram to reflect current `src/` layout
- Keep the tool reference, events, RPC sections (unchanged behavior)

### 6. package.json identity

**Decision**: Change `name` to `pi-party`, update `description` to "A pi extension for structured Scout → Plan → Crafter → Gatekeeper pipeline orchestration", and update repository URLs. Keep version at `0.12.0` (the fork point). The `@tintinweb/pi-subagents` name in `package-lock.json` is auto-generated — it updates on next `npm install`.

## Risks / Trade-offs

- **[Low] Concurrent test may pass trivially** — if the orchestrator's `dispatchCrafters()` already handles concurrent dispatch correctly (which the design says it should), the test just codifies existing behavior. Mitigation: write the test regardless; its value is regression protection, not bug-finding.
- **[Low] README rewrite may miss a section** — the README is long (~600 lines). Mitigation: systematic approach — remove sections for stripped features, update the identity sections, leave everything else.
- **[None] Package identity change doesn't affect runtime** — pi extensions are loaded by path, not by npm name. The `name` field change is purely cosmetic for the npm registry / repository identity.
