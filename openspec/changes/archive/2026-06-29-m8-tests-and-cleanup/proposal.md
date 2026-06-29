## Why

Milestones 1–7 are complete — the pipeline modules exist and all 35 test suites pass. But gaps remain: no integration test covers concurrent Crafters (a load-bearing feature explicitly called out in the roadmap), the `/btw` side-question scenario has no test, the worktree and agent-widget test suites haven't been extended for the pipeline's needs, and the project still identifies as `@tintinweb/pi-subagents` with docs describing features that were stripped (scheduling, model scope). This milestone closes those gaps — it's the final quality and identity pass before declaring pi-party's fork transformation complete.

## What Changes

- **Integration test: concurrent Crafters on independent steps** — verify two Crafters can run concurrently when their plan steps have no dependency relationship, and the orchestrator correctly handles dual completion events
- **Integration test: `/btw`-style side question answered while pipeline in flight** — verify the main agent remains free during a pipeline run (no global lock), demonstrated by the orchestrator accepting an unrelated turn while a Crafter is running
- **Extend `test/agent-widget.test.ts`** — current suite only tests `formatSessionTokens` (26 lines); add tests for concurrent-row rendering, pipeline-phase status rendering, and the queued/waiting state display
- **Extend `test/worktree.test.ts`** — add tests that verify concurrent worktree creation (two Crafter instances simultaneously, each with its own isolated worktree) doesn't interfere, and that cleanup of one worktree doesn't affect the other
- **Update README.md** — strip scheduling and model scope documentation (features already removed), update project identity from `@tintinweb/pi-subagents` to pi-party fork description, update architecture diagram to include new pipeline modules
- **Update CHANGELOG.md** — add Milestone 8 entry under [Unreleased], marking the fork transformation as complete
- **Update `package.json`** — change `name` to `pi-party`, update `description` to reflect the pipeline orchestration focus, update `repository`/`homepage`/`bugs` to point to the fork

## Capabilities

### New Capabilities

*(None — this is a test-coverage and cleanup milestone, not new functionality.)*

### Modified Capabilities

*(None — no existing spec requirements are changing.)*

## Impact

- **Test files**: `test/orchestrator.test.ts` (new integration tests), `test/agent-widget.test.ts` (extended), `test/worktree.test.ts` (extended)
- **Documentation**: `README.md` (rewritten identity + stripped features), `CHANGELOG.md` (Milestone 8 entry)
- **Project identity**: `package.json` (name, description, repository URLs)
