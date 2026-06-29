# Trigger hook — needsScout, noPlanIntent, implementIntent

**Created**: 2026-06-29T12:00:00Z
**Status**: in-progress

## Goal

Three independent, code-level evaluations that run on every relevant turn — not prompt guidance, not inferred from the main agent's own judgment in the moment. The hook detects: (1) whether the main agent needs codebase knowledge it doesn't already have, (2) whether the user explicitly said to skip planning, and (3) how strong the implement-intent signal is.

## Non-goals

- ❌ Actually dispatching Scout or launching the pipeline — the orchestrator (M6) does that based on hook results
- ❌ The planning gate — M4 (consumes `noPlanIntent` result)
- ❌ Medium-tier UX surface — this module returns `"medium"`, the orchestrator handles the user question
- ❌ LLM-based classification for the hook itself — the roadmap says "Decide cost/model profile for the hook itself — should be cheap/fast" but for M3 we implement the evaluation logic; model selection is wired in M7

## Approach

### Hook point investigation (critical prerequisite)

The existing pi extension API exposes these events:
- `session_start` — session begins
- `session_before_switch` — switching sessions
- `session_shutdown` — session ending
- `tool_execution_start` — fires when the LLM starts executing tools (this is the agent's turn)

**Open question**: Is there a user-message-level event (e.g. `user_message`, `turn_start`, `pre_tool_execution`)? The `tool_execution_start` event fires during the agent's response turn, which means the user's message has already been received and the agent is acting on it. This is actually the right point for the trigger — we want to evaluate intent AFTER the user's message is in context but BEFORE expensive agent work begins.

**Decision for M3**: Use `tool_execution_start` as the hook point. If a better pre-response hook is discovered, the trigger module's interface is designed to be hook-point-agnostic (it just takes a context object and returns results).

### Three hooks, one module

All three hooks live in `src/trigger.ts`. They're independent — `needsScout` fires regardless of `noPlanIntent`/`implementIntent` results.

```
turnContext → noPlanIntent() → boolean
           → implementIntent() → "high" | "medium" | "low"  (only if noPlanIntent is false)
           → needsScout() → boolean  (independent, always fires)
```

### `noPlanIntent(turnContext) → boolean`

Deliberately conservative. Fires ONLY on explicit no-plan language — e.g. "no need to plan, just implement it directly", "skip the plan", "don't bother planning". Never inferred from: casual phrasing ("just fix it"), brevity, or tone. Uses keyword/pattern matching, not LLM classification.

### `implementIntent(turnContext) → "high" | "medium" | "low"`

Three-tier classification:
- **High**: Clear implementation request — "build X", "add feature Y", "create Z", "refactor W to use pattern P"
- **Medium**: Ambiguous — could be implementation or could be discussion. Examples: "how would I add X?", "what do you think about refactoring Y?"
- **Low**: Pure Q&A, code explanation, debugging help without "fix it", general discussion

### `needsScout(turnContext) → boolean`

Binary: does answering/proceeding right now require codebase knowledge the main agent doesn't already have? Explicitly excludes:
- File-tree/structure lookups (e.g. "list all .ts files", "what's in src/")
- Document files: `*.md`, `package.json`, `tsconfig.json`, and other config files

### Model for the hook

The roadmap says: "Decide cost/model profile for the hook itself — should be cheap/fast, separate from whichever model runs Scout/Plan/Crafter."

For M3, implement as **rule-based classification** (keyword matching + pattern heuristics). This avoids the cost/complexity of running an LLM call on every turn. If rule-based proves insufficient after real usage, upgrade to a cheap model (haiku) call — the function signature is designed to accommodate either approach without changing callers.

## Checklist

- [ ] Research available pi extension API hooks — document which event gives us access to the turn context (user message + conversation state) BEFORE the main agent acts {#research-hooks}
- [ ] Create `src/trigger.ts` with module skeleton {#create-module}
- [ ] Define `TurnContext` interface — the input shape all three hooks accept {#define-context}
  ```ts
  interface TurnContext {
    userMessage: string;        // the user's latest message text
    conversationSummary?: string; // optional: recent conversation context
    agentHasCodebaseKnowledge?: boolean; // set by orchestrator after Scout reports
    workingDirectory: string;
  }
  ```
- [ ] Implement `noPlanIntent(ctx: TurnContext): boolean` {#no-plan-intent}
  - Pattern-based: match explicit skip-planning language
  - Positive patterns: "no need to plan", "skip the plan", "don't plan", "just do it directly", "no planning needed", "implement directly", "without a plan"
  - Explicitly NOT triggered by: "just fix it", "quick change", "simple", brevity alone
  - Returns `false` by default (conservative — gate stays closed unless user explicitly opens it)
- [ ] Implement `implementIntent(ctx: TurnContext): "high" | "medium" | "low"` {#implement-intent}
  - **High** patterns: "build", "create", "implement", "add feature", "write code for", "refactor ... to", "migrate", "set up", "scaffold"
  - **Medium** patterns: "how would I", "what do you think", "should I", "is it better to", "can you help me figure out", questions ending with "?" but containing implementation-adjacent keywords
  - **Low**: everything else (Q&A, explanation, debugging without fix request, general chat)
  - Returns `"low"` by default
- [ ] Implement `needsScout(ctx: TurnContext): boolean` {#needs-scout}
  - Positive signals: "find where X is", "locate the code that", "which file", "search for", "explore the codebase", "how is X structured", "what pattern does Y use"
  - Negative (excluded) signals: questions answerable by file-tree listing, questions about `*.md`/`package.json`/config files, already-known paths
  - Returns `false` by default
- [ ] Implement `evaluateAll(ctx: TurnContext): TriggerResult` — convenience function that runs all three and returns a combined result {#evaluate-all}
  ```ts
  interface TriggerResult {
    noPlanIntent: boolean;
    implementIntent: "high" | "medium" | "low";
    needsScout: boolean;
  }
  ```
- [ ] Create `test/trigger.test.ts` {#create-tests}
- [ ] Unit test: `noPlanIntent` — explicit skip-planning language → true {#test-noplan-true}
- [ ] Unit test: `noPlanIntent` — casual "just fix it" → false {#test-noplan-false}
- [ ] Unit test: `noPlanIntent` — no planning language at all → false {#test-noplan-none}
- [ ] Unit test: `implementIntent` — "build a login system" → high {#test-intent-high}
- [ ] Unit test: `implementIntent` — "how would I build a login system?" → medium {#test-intent-medium}
- [ ] Unit test: `implementIntent` — "what does git status do?" → low {#test-intent-low}
- [ ] Unit test: `implementIntent` — "refactor the auth module to use JWT" → high {#test-intent-refactor}
- [ ] Unit test: `needsScout` — "where is the auth middleware defined?" → true {#test-scout-true}
- [ ] Unit test: `needsScout` — "read package.json" → false (document file exclusion) {#test-scout-config}
- [ ] Unit test: `needsScout` — "what does this git status output mean?" → false (no codebase exploration needed) {#test-scout-false}
- [ ] Unit test: `needsScout` — "list all .ts files in src/" → false (file-tree lookup exclusion) {#test-scout-filetree}
- [ ] Unit test: `evaluateAll` returns correct combined result {#test-evaluate-all}

## Files created

| File | Purpose |
|---|---|
| `src/trigger.ts` | Three hook functions + combined evaluator |
| `test/trigger.test.ts` | Unit tests with representative conversation snippets |

## Open design decisions (for later)

| Decision | Current stance | When to finalize |
|---|---|---|
| Hook point in ExtensionAPI | Assume `tool_execution_start` works; verify before wiring | Before M7 (integration) |
| Rule-based vs LLM classification | Rule-based for M3; upgrade path documented | After real-usage feedback |
| `TurnContext.conversationSummary` | Optional field; not used by rule-based approach | If upgraded to LLM classification |
