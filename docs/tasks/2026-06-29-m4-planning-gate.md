# Planning gate — structural interception of write-capable Agent spawns

**Created**: 2026-06-29T12:00:00Z
**Status**: in-progress

## Goal

A structural gate that prevents any Agent spawn with write/edit tools from executing unless a user-approved plan exists for that task. The gate is hard-on by default with no heuristic exceptions — the ONLY bypass is the `noPlanIntent` hook returning true (user explicitly said no plan needed).

## Non-goals

- ❌ Deciding what constitutes a "plan" — that's the plan file module's domain (M2)
- ❌ The approve/reject UX flow — the orchestrator handles that (M6)
- ❌ Detecting `noPlanIntent` — that's the trigger hook (M3), consumed here
- ❌ The Ledger's conflict checking — separate concern (M5)

## Approach

### Interception point

The `Agent` tool is registered in `src/index.ts` via `pi.registerTool(defineTool({...}))`. The tool's `execute` function calls `manager.spawn()` for foreground/background/resume paths. The gate intercepts BEFORE `manager.spawn()` is reached.

**Design**: The gate is a pure function that the Agent tool's `execute` function calls as its first substantive step (after parameter resolution but before spawn). This keeps the gate testable in isolation and the integration point obvious.

```ts
// In index.ts, Agent tool execute function, after param resolution:
const gateResult = checkPlanningGate({
  subagentType: resolvedType,
  hasApprovedPlan: planFileExists && planIsApproved,
  noPlanIntent: triggerResult.noPlanIntent,
});
if (!gateResult.allowed) {
  return textResult(gateResult.message);
}
// ... proceed to spawn
```

### "Approved plan" state

The gate doesn't own plan state — it receives it from the caller. The orchestrator (M6) tracks whether a plan has been approved. For M4, the gate function signature accepts a `hasApprovedPlan: boolean` parameter. The orchestrator is responsible for setting this to true after the user approves.

### Tool-set check

The gate checks the resolved agent type's tool set for `write` or `edit`. This uses `getToolNamesForType()` from `agent-types.ts` (which returns the resolved tool list after user overrides). An agent type with `builtinToolNames` omitted (all tools) includes write/edit; an agent type explicitly set to `READ_ONLY_TOOLS` does not.

### Bypass: `noPlanIntent` only

The ONLY bypass path is `noPlanIntent: true` from the trigger hook. There is no separate flag, no orchestrator self-declaration path, no heuristic (e.g. task description length). The bypass is deliberately narrow — judgment about what doesn't need a plan stays with a human.

## Checklist

- [ ] Create `src/planning-gate.ts` {#create-module}
- [ ] Define `PlanningGateInput` interface {#define-input}
  ```ts
  interface PlanningGateInput {
    subagentType: string;       // resolved type name
    hasApprovedPlan: boolean;   // does an approved plan exist for this task?
    noPlanIntent: boolean;      // did the user explicitly say no plan needed?
  }
  ```
- [ ] Define `PlanningGateResult` interface {#define-output}
  ```ts
  interface PlanningGateResult {
    allowed: boolean;
    message?: string;  // rejection reason, shown to the orchestrator
  }
  ```
- [ ] Implement `isWriteCapable(typeName: string): boolean` {#is-write-capable}
  - Uses `getToolNamesForType(typeName)` from `agent-types.ts`
  - Returns `true` if the resolved tool set includes `"write"` or `"edit"`
  - Returns `false` for read-only types (Scout, Plan, Gatekeeper)
  - Returns `true` for Crafter and general-purpose (all tools by omission)
- [ ] Implement `checkPlanningGate(input: PlanningGateInput): PlanningGateResult` {#check-gate}
  - If `noPlanIntent` is `true` → `{ allowed: true }` (bypass, no message)
  - If `!isWriteCapable(input.subagentType)` → `{ allowed: true }` (read-only agents don't need a plan)
  - If `hasApprovedPlan` is `true` → `{ allowed: true }`
  - Otherwise → `{ allowed: false, message: "No approved plan exists for this task. Run Plan first to create one, or explicitly tell me to skip planning." }`
- [ ] Create `test/planning-gate.test.ts` {#create-tests}
- [ ] Unit test: write-capable spawn WITHOUT approved plan → rejected {#test-reject-no-plan}
- [ ] Unit test: write-capable spawn WITH approved plan → allowed {#test-allow-approved}
- [ ] Unit test: read-only spawn (Scout) WITHOUT plan → allowed {#test-allow-readonly}
- [ ] Unit test: Gatekeeper (read-only) WITHOUT plan → allowed {#test-allow-gatekeeper}
- [ ] Unit test: Crafter (write-capable) WITHOUT plan → rejected {#test-reject-crafter}
- [ ] Unit test: general-purpose (write-capable by omission) WITHOUT plan → rejected {#test-reject-general-purpose}
- [ ] Unit test: `noPlanIntent: true` overrides everything → allowed even for write-capable without plan {#test-bypass-noplan}
- [ ] Unit test: `noPlanIntent: true` for read-only → still allowed (no-op, but confirm) {#test-bypass-noplan-readonly}
- [ ] Unit test: `hasApprovedPlan: true` but `noPlanIntent: true` → allowed (both paths allow) {#test-both-true}
- [ ] Unit test: custom user agent with explicit `builtinToolNames: ["read"]` → read-only, allowed {#test-custom-readonly}
- [ ] Unit test: custom user agent with `builtinToolNames` omitted → all tools, write-capable, rejected without plan {#test-custom-write}

## Files created

| File | Purpose |
|---|---|
| `src/planning-gate.ts` | Gate logic + tool-set check |
| `test/planning-gate.test.ts` | Unit tests for all gate states |

## Files NOT modified

| File | Why |
|---|---|
| `src/index.ts` | Integration point for the gate — wired in M7 |
| `src/agent-manager.ts` | Gate is upstream of manager.spawn() |
| `src/agent-types.ts` | Consumed via `getToolNamesForType()` import |

## Dependency note

The gate function imports `getToolNamesForType` from `agent-types.ts`. This is an existing, stable export — no changes needed. The gate does NOT import from M2 (plan-file) or M3 (trigger) — it receives pre-computed booleans from the caller, keeping module boundaries clean.
