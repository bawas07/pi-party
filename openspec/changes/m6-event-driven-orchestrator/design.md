## Context

pi-party has five completed building blocks (M1-M5): agent definitions (Scout, Plan, Crafter, Gatekeeper), plan file CRUD with dependency parsing, per-turn intent detection hooks, a structural planning gate, and a file-level conflict ledger. Each is tested and self-contained. None of them coordinate with each other.

The current `index.ts` orchestrates background agents for general-purpose use (spawn, notify, group-join), emitting `subagents:created/started/completed/failed/steered/compacted` lifecycle events. These events are already the backbone of the notification system — they are the natural integration surface for the pipeline orchestrator.

**Constraint:** The main agent must remain free to respond to user messages at all times. A blocking pipeline call would prevent mid-run steering (a key reason tintinweb was chosen as the fork base) and side-question handling (`/btw`-style). The roadmap explicitly rejects the foreground-blocking `Orchestrate` tool approach.

## Goals / Non-Goals

**Goals:**
- Deliver a self-contained `Orchestrator` class that drives the full pipeline via event listeners
- Handle concurrent Crafter dispatch with Ledger conflict checks
- Implement the Gatekeeper → Crafter fix loop (max 3 rounds)
- Async user approval flow that doesn't block the main agent
- Pipeline progress widget with concurrent Crafter rows
- Graceful error handling at every phase transition
- Full test coverage (unit + integration)

**Non-Goals:**
- Wiring into `index.ts` (Milestone 7)
- Persistence across session interruptions
- The `/summoner` manual-override command (M7)
- Ambient hook wiring (trigger.ts is M3; wiring it to the orchestrator is M7)
- Removing scheduling/scope-models features (M7)

## Decisions

### 1. Event-driven state machine (not a blocking function)

**Chosen:** Class with registered `pi.events` listeners that dispatch agents via `manager.spawn()` in background mode. Each phase transition is a listener callback reacting to `subagents:completed` or `subagents:failed`.

**Alternatives considered:**
- **Single blocking `runPipeline()` async function** → rejected because it blocks the main agent, making mid-run steering and side-questions impossible.
- **Generator/coroutine with yield points** → rejected as over-engineered; the event system already exists and works.

**Rationale:** The `AgentManager` already emits `subagents:completed/failed` events with agent ID, type, status, and result. Filtering by agent type gives natural phase transitions with zero new infrastructure.

### 2. Single pipeline at a time

**Chosen:** One active `PipelineTask` per `Orchestrator` instance. Starting a new pipeline while one is active aborts the current one.

**Rationale:** Simplifies state management. The orchestrator tracks phase, step states, gatekeeper rounds — two concurrent pipelines would require multiplexing all of this. A user wanting parallel pipelines can always ask the main agent directly.

### 3. Scout is optional, dispatched independently

**Chosen:** `startPipeline()` accepts a `needsScout: boolean` flag from `trigger.ts`. If true, Scout dispatches first; Plan receives Scout's findings as context. If false, Plan dispatches directly.

**Rationale:** Scout's own hook (`needsScout`) is independent of `implementIntent` — the roadmap explicitly says so. The orchestrator respects this independence but sequences Scout-before-Plan when both are needed.

### 4. Phase identification via agent type string matching

**Chosen:** Listeners match `eventData.type` against `"Scout"`, `"Plan"`, `"Crafter"`, `"Gatekeeper"` to determine which phase just completed.

**Rationale:** Simple, unambiguous. The agent type names are constants defined in `DEFAULT_AGENT_NAMES`. No need for a separate tracking map — the pipeline phase already tells us what type we dispatched and are waiting on.

### 5. Plan path extraction from agent result text

**Chosen:** The Plan agent's system prompt instructs it to output the plan file path. The orchestrator parses the result text for a `docs/tasks/` path pattern. Falls back to scanning `docs/tasks/` for the most recent `.md` file.

**Rationale:** The Plan agent writes the file via the `write` tool (or Plan's own bash commands). The orchestrator has no direct hook into the agent's tool calls — it sees only the final result text. Path extraction from text is fragile but sufficient; the fallback scan makes it robust.

### 6. File inference from step descriptions

**Chosen:** Regex extraction of file-like patterns (`src/...`, `test/...`, absolute paths, and backtick-quoted paths) from step descriptions. If no files are found, the step is dispatched without a Ledger claim.

**Rationale:** Plan steps reference target files in their descriptions (e.g., "Create `src/auth.ts` and `src/middleware.ts`"). A simple regex covers the common case. The conservative fallback (no claim = sequential-only) prevents false-confidence conflicts. Future improvement: have the Plan agent explicitly declare target files in each step.

### 7. User approval via `pi.sendMessage` + next-turn hook

**Chosen:** On Plan completion, the orchestrator sends a message with approve/reject prompt buttons (`pi.sendMessage` with `telegram_button` comments or inline options). Sets an `awaitingApproval` flag. The next user turn is intercepted (via a hook registered by the orchestrator) to check for approval/rejection.

**Alternatives considered:**
- **Blocking `ctx.ui` modal** → rejected; blocks the main agent.
- **Separate event listener for user messages** → chosen as the most non-blocking approach.

**Rationale:** Non-blocking, natural UX. The user sees the plan and responds on their next message. The main agent can handle other questions while waiting.

### 8. Gatekeeper findings parsing via structured format

**Chosen:** Gatekeeper's prompt instructs it to output findings in a parseable format with `#### In-Scope` and `#### Out-of-Scope` sections. The orchestrator regex-parses these sections to extract issue lists.

**Fallback:** If parsing fails, treat all findings as out-of-scope (ask user). Never auto-fix on unparseable output.

### 9. Error handling: fail phase, not pipeline

**Chosen:** Scout failure → ask user whether to proceed without. Plan failure → stop pipeline (no plan, nothing to build). Crafter failure → mark step failed, continue with remaining steps. Gatekeeper failure → stop pipeline, leave plan for manual review.

**Rationale:** Different phases have different criticality. A failed Crafter step shouldn't kill the entire pipeline — dependent steps stay blocked but independent steps can still succeed.

### 10. Widget updates via `ctx.ui.setWidget`

**Chosen:** The orchestrator maintains a widget render function registered via `ctx.ui.setWidget("pipeline", renderFn)`. Updated at every phase/step transition. Shows per-agent rows with 🟢/🟡/✅/❌ states.

**Rationale:** `ctx.ui.setWidget` is already used by `AgentWidget` for the activity display. A separate widget key avoids collision.

## Risks / Trade-offs

| Risk | Impact | Mitigation |
|---|---|---|
| **Event listener ordering** — `subagents:completed` fires for all agents including non-pipeline spawns | The orchestrator could misidentify a general-purpose agent's completion as a pipeline phase result | Filter by `eventData.type` matching the expected pipeline agent type AND only process when `currentTask` is non-null AND the phase matches |
| **Plan path extraction fragility** — regex on free-text agent output | Orchestrator can't find the plan file, stops pipeline | Fallback: scan `docs/tasks/` for most recent `.md` file. If still not found, retry Plan dispatch once |
| **Concurrent Crafter merge conflicts** — two worktrees complete with overlapping changes to different files that share imports | Merge fails or produces broken state | Ledger prevents same-file conflicts pre-dispatch. Merge strategy for worktree branches is handled by existing `worktree.ts` cleanup logic (sequential merge into main). The orchestrator doesn't add new merge logic — it relies on the existing infrastructure |
| **State inconsistency on crash** — orchestrator in-memory state lost mid-pipeline | Orphaned agent processes, stale Ledger claims, half-completed plan file | `dispose()` cleans up on `session_shutdown`. In-memory-only is acceptable for M6; persistence is an open question per roadmap |
| **Approval phase timeout** — user never responds to approval prompt | Pipeline stuck in `awaiting-approval` indefinitely | No timeout in M6 — the orchestrator stays ready. If user starts a new pipeline, the old one is aborted. Timeout can be added later |

## Open Questions

- **How to handle the "medium" implementIntent tier** — the orchestrator currently only knows about `startPipeline()`. The medium-tier flow (ask user, wait for confirmation) will be handled in M7 when the trigger hook is wired. For M6, `startPipeline()` is the sole entry point and assumes the caller already decided to proceed.
- **Gatekeeper severity classification prompt** — roadmap says "user will provide example prompt." M6 uses a default prompt from the Gatekeeper agent definition; tuning happens post-M6.
