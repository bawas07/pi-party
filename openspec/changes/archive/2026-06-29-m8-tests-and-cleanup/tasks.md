## 1. Orchestrator integration tests — concurrent Crafters

- [x] 1.1 Add integration test: two independent steps dispatch both Crafters concurrently (15.2 — "Two independent steps spawn two Crafters in single dispatchCrafters() call, both tracked in stepStates")
- [x] 1.2 Add integration test: one of two concurrent Crafters completes, the other remains tracked and its step stays dispatched (extend 15.2 scenario — "Complete one Crafter, verify other step remains dispatched")

## 2. Orchestrator integration tests — side-question non-blocking

- [x] 2.1 Add integration test: second pipeline starts while first is in crafting phase (15.8 — "startPipeline() succeeds without error while another pipeline is in flight, creates new task record")
- [x] 2.2 Verify both tasks coexist independently (different task IDs, different phase tracking)

## 3. Agent widget test extension

- [x] 3.1 Add tests for pipeline phase status formatting (Scout/Plan/Crafting/Gatekeeping/Complete phase labels)
- [x] 3.2 Add tests for concurrent-Crafter row formatting (running 🟢, queued 🟡, done ✅, failed ❌ states)
- [x] 3.3 Add tests for the queued/waiting count display in multi-Crafter scenario

## 4. Worktree concurrent-isolation test

- [x] 4.1 Add test: create two worktrees concurrently from the same repo, verify distinct paths
- [x] 4.2 Add test: make independent changes in each worktree, verify one's changes are invisible to the other
- [x] 4.3 Add test: cleanup one worktree, verify the other remains intact and functional

## 5. README cleanup

- [x] 5.1 Replace header/title: `@tintinweb/pi-subagents` → pi-party with pipeline orchestration description
- [x] 5.2 Remove Scheduling section (schedule param, cron formats, menu entry docs — feature stripped in M7)
- [x] 5.3 Remove Model Scope section (enabled-models validation docs — feature stripped in M7)
- [x] 5.4 Update Default Agent Types table: Explore → Scout, add Crafter and Gatekeeper rows
- [x] 5.5 Update Architecture section: add new pipeline modules (plan-file.ts, trigger.ts, planning-gate.ts, ledger.ts, orchestrator.ts), remove schedule.ts and enabled-models.ts
- [x] 5.6 Update install command to reflect fork name
- [x] 5.7 Remove any remaining scheduling/model scope references in feature descriptions

## 6. CHANGELOG update

- [x] 6.1 Add Milestone 8 entry under [Unreleased] documenting test coverage completion (integration tests for concurrent Crafters, side-questions, widget/worktree extensions), README/package.json identity cleanup, and marking the fork transformation as complete

## 7. package.json identity

- [x] 7.1 Change `name` from `@tintinweb/pi-subagents` to `pi-party`
- [x] 7.2 Change `description` to reflect pipeline orchestration focus
- [x] 7.3 Update `repository.url`, `homepage`, `bugs.url` to point to fork repository

## 8. Final verification

- [x] 8.1 Run full test suite — verify all existing and new tests pass, no regressions
- [x] 8.2 Run `npm run typecheck` — verify no TypeScript errors
- [x] 8.3 Run `npm run lint` — verify no lint errors from README/package.json changes (if any)
