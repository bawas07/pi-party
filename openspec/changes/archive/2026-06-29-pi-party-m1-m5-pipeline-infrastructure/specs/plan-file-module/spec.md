## ADDED Requirements

### Requirement: Write a new plan file

The system SHALL provide a `writePlan(task: string, title: string, content: string): string` function that creates a new plan file at `docs/tasks/{ISO-date}-{slugified-title}.md` with the standard template (Goal, Non-goals, Approach, Checklist sections), creates parent directories on demand, and returns the absolute file path.

#### Scenario: Write a plan file

- **WHEN** `writePlan("auth", "JWT Authentication", "# Goal\n...")` is called
- **THEN** a file is created at `docs/tasks/<date>-jwt-authentication.md` containing the template with the provided content

#### Scenario: Parent directories are created

- **WHEN** `docs/tasks/` does not exist and `writePlan()` is called
- **THEN** the directory is created before the file is written

### Requirement: Read a plan file

The system SHALL provide a `readPlan(path: string): string` function that returns the full contents of a plan file as a UTF-8 string.

#### Scenario: Read an existing plan

- **WHEN** `readPlan("/path/to/plan.md")` is called and the file exists
- **THEN** the complete file contents are returned as a string

### Requirement: Check off a step by slug

The system SHALL provide a `checkOffStep(path: string, slug: string): void` function that finds the line containing `{#slug}` in the plan file and replaces the first `[ ]` before the slug with `[x]`. The function SHALL be idempotent — checking off an already-checked step is a no-op.

#### Scenario: Check off a pending step

- **WHEN** `checkOffStep(path, "add-auth")` is called and the file contains `- [ ] Create auth middleware {#add-auth}`
- **THEN** the line becomes `- [x] Create auth middleware {#add-auth}` and the file is saved

#### Scenario: Check off an already-checked step

- **WHEN** `checkOffStep(path, "add-auth")` is called and the step is already `[x]`
- **THEN** the file is unchanged

#### Scenario: Slug not found

- **WHEN** `checkOffStep(path, "nonexistent")` is called and no step has that slug
- **THEN** no error is thrown and the file is unchanged

### Requirement: Find an existing plan by task

The system SHALL provide a `findExisting(task: string): string | null` function that scans `docs/tasks/` (excluding `archived/`) for `.md` files whose `# Title` heading matches the task string (case-insensitive substring match) and returns the first match's absolute path, or `null` if none found.

#### Scenario: Find a matching plan

- **WHEN** `findExisting("jwt auth")` is called and a plan titled `# JWT Authentication` exists
- **THEN** the absolute path to that plan file is returned

#### Scenario: No matching plan

- **WHEN** `findExisting("nonexistent")` is called
- **THEN** `null` is returned

### Requirement: Archive a plan file

The system SHALL provide an `archive(path: string): void` function that moves the plan file from `docs/tasks/` to `docs/tasks/archived/`, preserving the filename.

#### Scenario: Archive a completed plan

- **WHEN** `archive("/path/to/docs/tasks/plan.md")` is called
- **THEN** the file is moved to `docs/tasks/archived/plan.md` and no longer exists at the original path

### Requirement: Get unblocked steps by dependency resolution

The system SHALL provide an `unblockedSteps(path: string): string[]` function that parses the checklist, resolves dependency slugs against checked-off status, and returns the slugs of all unchecked steps whose dependency slugs are all satisfied. Steps with no `depends on:` clause SHALL always be unblocked (unless already checked). Steps referencing unknown dependency slugs SHALL be treated as satisfied (do not block on typos).

#### Scenario: All steps unblocked when no dependencies

- **WHEN** the checklist has 3 unchecked steps with no dependency clauses
- **THEN** `unblockedSteps()` returns all 3 slugs

#### Scenario: Blocked by unsatisfied dependency

- **WHEN** step A is unchecked, step B is unchecked and `(depends on: A)`
- **THEN** `unblockedSteps()` returns only step A's slug (step B is blocked)

#### Scenario: Unblocked when dependency is checked off

- **WHEN** step A is `[x]`, step B is unchecked and `(depends on: A)`
- **THEN** `unblockedSteps()` returns step B's slug

#### Scenario: Unknown dependency slugs do not block

- **WHEN** a step depends on a slug that does not exist in the checklist
- **THEN** that dependency is treated as satisfied and the step is unblocked

#### Scenario: Already-checked steps excluded

- **WHEN** all steps are `[x]`
- **THEN** `unblockedSteps()` returns an empty array

### Requirement: Parse checklist steps from plan content

The system SHALL provide a `parseChecklist(content: string): ParsedStep[]` function that extracts each `- [ ]` / `- [x]` line from the `## Checklist` section, capturing the slug (`{#slug}`), checked status, raw dependency text, and parsed dependency slugs.

#### Scenario: Parse a simple checklist

- **WHEN** content has `- [ ] Do thing {#do-thing}` and `- [x] Done thing {#done-thing}`
- **THEN** `parseChecklist()` returns two ParsedStep objects with correct slugs and checked status

#### Scenario: Parse dependencies

- **WHEN** a step has `(depends on: slug-a, slug-b)`
- **THEN** the ParsedStep has `depSlugs: ["slug-a", "slug-b"]`

### Requirement: Translate external spec to internal checklist format

The system SHALL provide a `translateExternalSpec(externalPath: string): string` function that reads a user-pointed-to spec/plan file, extracts work items from recognizable structures (headings, lists, numbered steps), infers dependencies from ordering and explicit dependency language, and returns a string in the internal checklist format. This function SHALL NOT write any files.

#### Scenario: Translate a structured spec

- **WHEN** an external spec has headings describing tasks and sub-lists describing steps
- **THEN** the returned string contains a `## Checklist` section with `{#slug}` identifiers for each extracted work item
