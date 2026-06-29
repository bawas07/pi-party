## Why

M1–M6 delivered standalone, tested modules (plan-file, trigger, planning-gate, ledger, orchestrator) and updated agent definitions — but none of them are wired into the live extension. `index.ts` still operates as the original `pi-subagents` spawner with scheduling and model-scope features intact. This change connects everything into a working pi-party extension and strips the two features the roadmap explicitly removes.

## What Changes

- **Wire the orchestrator** into `index.ts` — instantiate Ledger + Orchestrator with live dependencies, register lifecycle listeners, connect trigger hook results to orchestrator actions
- **Register the ambient trigger hook** on `pi.on("turn_start")` — evaluate `needsScout`, `noPlanIntent`, and three-tier `implementIntent` every turn; route results: high confidence → auto-start pipeline, medium → surface question, Scout need → dispatch independently
- **Insert the planning gate** into Agent tool execution — intercept write-capable spawns, reject without approved plan (only bypass: user-explicit `noPlanIntent` flag)
- **Register `/summoner <task>`** command and `/pipeline` alias as manual override — forces pipeline start regardless of ambient trigger classification
- **Remove scheduling** — delete `schedule.ts`, `schedule-store.ts`, `schedule-menu.ts` and all references from `index.ts` and `settings.ts`; remove `schedule` param from Agent tool schema **BREAKING**
- **Remove model scope enforcement** — delete `enabled-models.ts` and all references from `index.ts` and `settings.ts` **BREAKING**
- **Add pipeline status widget** — a multi-line progress display showing per-phase and per-step status with 🟢🟡✅❌ indicators, rendered via `ctx.ui.setWidget`
- **Clean up** — remove orphaned imports, update CHANGELOG/README, verify worktree isolation is wired

## Capabilities

### New Capabilities

- `pipeline-orchestration-wiring`: Ambient trigger hook, planning gate interception, `/summoner` command, and orchestrator lifecycle all wired into the live extension. The extension transitions from a general-purpose subagent spawner to a pipeline-driven implementation orchestrator.
- `pipeline-widget`: A live pipeline progress widget displayed alongside the existing AgentWidget and FleetList, showing Scout→Plan→Crafter→Gatekeeper phase progression with per-step concurrent-Crafter status.

### Modified Capabilities

- `planning-gate`: The gate goes from a standalone, tested function to an active interceptor in the Agent tool's execute path. No logic change — purely integration: the `noPlanIntent` flag is now managed by the trigger hook and consumed as a one-shot bypass.
- `trigger-hook`: The trigger goes from a standalone module to a per-turn hook registered on `pi.on("turn_start")`. No classification logic changes — purely integration: results now route to orchestrator actions and planning-gate flag management.

## Impact

- **Primary file**: `src/index.ts` — ~200 lines added (orchestrator wiring, trigger hook, gate, /summoner), ~150 lines removed (scheduling, model-scope)
- **Settings**: `src/settings.ts` — 2 fields removed from interface, sanitize, apply, and appliers
- **Deleted files**: `src/schedule.ts`, `src/schedule-store.ts`, `src/ui/schedule-menu.ts`, `src/enabled-models.ts`, 4 test files
- **Tests**: 4 test files deleted; existing test suite must pass without them
- **User-facing**: `/summoner` and `/pipeline` commands become available; `schedule` param disappears from Agent tool; ambient trigger may auto-start pipelines on high-confidence implementation intent
- **No changes to**: `orchestrator.ts`, `trigger.ts`, `planning-gate.ts`, `ledger.ts`, `plan-file.ts`, `default-agents.ts`, `worktree.ts`, `agent-manager.ts`
