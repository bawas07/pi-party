# Plan file module — CRUD + dependency parsing + external spec translation

**Created**: 2026-06-29T12:00:00Z
**Status**: in-progress

## Goal

A self-contained module (`src/plan-file.ts`) that writes, reads, checks off, archives, and dependency-queries structured plan files. Also translates user-authored external specs into the internal checklist format. This module has no runtime dependencies on other pi-party modules — pure filesystem + markdown parsing.

## Non-goals

- ❌ Executing plans, dispatching agents, or orchestrating — M6
- ❌ The planning gate itself — M4 (just consumes this module)
- ❌ The ledger — M5
- ❌ Trigger hooks — M3

## Approach

All plan files live under `docs/tasks/`. The format is documented in the roadmap — markdown with a `## Checklist` section where each step is `- [ ] Description {#slug}` and dependencies are expressed as `(depends on: slug, slug)`. The module exposes 7 pure-ish functions operating on file paths.

### Dependency syntax (label-based)

Each checklist step carries a stable short slug: `- [ ] Do the thing {#the-thing}`. Dependencies reference those slugs: `- [ ] Wire it up (depends on: the-thing, other-step)`. This is parsed by regex, not free-text inference. Label-based references are resilient to reordering/insertion (unlike positional indices).

### Why `translateExternalSpec` is in this module

It produces internal-format checklist content — the same output shape `writePlan` produces. Keeping it here avoids duplicating the checklist format knowledge. The function reads a user-pointed-to spec file (any markdown format), extracts work items, and infers dependencies. The orchestrator (M6) never sees the translation step — it just gets a plan file in the standard format.

## Checklist

- [ ] Create `src/plan-file.ts` with module skeleton and imports (node:fs, node:path) {#create-module}
- [ ] Implement `ensureDirs()` — creates `docs/tasks/` and `docs/tasks/archived/` on demand {#ensure-dirs}
- [ ] Implement `writePlan(task: string, title: string, content: string): string` {#write-plan}
  - Generates filename: `docs/tasks/{ISO-date}-{slugified-title}.md`
  - Writes the template (see roadmap: Goal, Non-goals, Approach, Checklist)
  - Returns the absolute file path
  - Creates parent directories if missing
- [ ] Implement `readPlan(path: string): string` — reads file contents as UTF-8 string {#read-plan}
- [ ] Implement `checkOffStep(path: string, slug: string): void` {#check-off}
  - Reads the file, finds the line containing `{#slug}`, replaces `[ ]` with `[x]`
  - Only the first `[ ]` before the slug is replaced
  - No-op if slug not found or already checked
  - Writes the file back
- [ ] Implement `findExisting(task: string): string | null` {#find-existing}
  - Scans `docs/tasks/` (non-archived) for `.md` files
  - Matches by title substring in the `# Title` heading — case-insensitive
  - Returns the first match's absolute path, or null
- [ ] Implement `archive(path: string): void` {#archive}
  - Moves file from `docs/tasks/` to `docs/tasks/archived/`
  - Preserves filename (no collision handling needed — timestamps are unique enough)
- [ ] Implement `unblockedSteps(path: string): string[]` {#unblocked-steps}
  - Parses the checklist section
  - Returns slugs of unchecked steps whose dependency slugs are all checked off
  - Steps with no `depends on:` clause are always unblocked (unless already checked)
  - Steps referencing unknown slugs → treat as satisfied (don't block on typos)
- [ ] Implement `parseChecklist(content: string): ParsedStep[]` — shared parser used by `unblockedSteps` and `translateExternalSpec` {#parse-checklist}
  - Extracts each `- [ ]` / `- [x]` line from the `## Checklist` section
  - Captures: slug (`{#slug}`), checked status, raw dependency text, parsed dependency slugs
  - Returns structured array
- [ ] Implement `translateExternalSpec(externalPath: string): string` {#translate-external-spec}
  - Reads the user-pointed-to file
  - Extracts work items from any recognizable structure (headings, lists, numbered steps)
  - Infers dependencies from ordering + explicit dependency language
  - Returns a string in the internal checklist format (ready for `writePlan`'s content parameter)
  - Does NOT write a file — caller decides what to do with the output
- [ ] Add `ParsedStep` interface to module exports {#types-export}
  ```ts
  interface ParsedStep {
    slug: string;
    description: string;  // text before {#slug}, trimmed
    checked: boolean;
    rawDeps: string;       // e.g. "slug-a, slug-b"
    depSlugs: string[];    // parsed: ["slug-a", "slug-b"]
    lineNumber: number;    // 1-indexed line in the file
  }
  ```
- [ ] Create `test/plan-file.test.ts` {#create-tests}
- [ ] Unit test: `writePlan` + `readPlan` round-trip {#test-write-read}
- [ ] Unit test: `checkOffStep` marks correct line, idempotent {#test-checkoff}
- [ ] Unit test: `unblockedSteps` — no deps → all unblocked; deps satisfied → unblocked; deps unsatisfied → blocked {#test-unblocked}
- [ ] Unit test: `unblockedSteps` — unknown dependency slugs don't block {#test-unknown-deps}
- [ ] Unit test: `unblockedSteps` — already-checked steps excluded from result {#test-checked-excluded}
- [ ] Unit test: `findExisting` matches by title, returns null on miss {#test-find}
- [ ] Unit test: `archive` moves file correctly {#test-archive}
- [ ] Unit test: `parseChecklist` handles edge cases: empty checklist, no slugs, duplicate slugs, multi-line step descriptions {#test-parse-edge}
- [ ] Unit test: `translateExternalSpec` with a sample spec file — verify checklist format output {#test-translate}

## Files created

| File | Purpose |
|---|---|
| `src/plan-file.ts` | All plan file operations |
| `test/plan-file.test.ts` | Unit tests |

## Files NOT modified

No existing files touched — this is a greenfield module.
