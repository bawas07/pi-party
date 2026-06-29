# Test Coverage and Cleanup

**Purpose**: Ensure the pi-party pipeline modules have comprehensive test coverage including integration scenarios for concurrent Crafters, non-blocking orchestrator behavior, widget rendering, and worktree isolation. Additionally, maintain clean project identity as a fork of `@tintinweb/pi-subagents`.

## Requirements

### Requirement: Concurrent Crafter integration test

The test suite SHALL include an integration test verifying that when a checklist has two independent steps (no dependency relationship), both Crafters are dispatched concurrently in a single `dispatchCrafters()` call.

#### Scenario: Two independent steps dispatch concurrently

- **WHEN** a plan file has two unchecked steps with no `depends on` relationship
- **THEN** `dispatchCrafters()` spawns two Crafter agents in the same call, both tracked in `stepStates`

#### Scenario: One Crafter completes, the other remains tracked

- **WHEN** one of two concurrent Crafters emits `subagents:completed`
- **THEN** its step is checked off, its Ledger claim is released, and the other Crafter's step remains `dispatched`

### Requirement: Side-question non-blocking test

The test suite SHALL include a test verifying the orchestrator does not hold a global lock preventing a second pipeline from starting while the first is in flight.

#### Scenario: Second pipeline starts while first is in crafting phase

- **WHEN** a pipeline is in the "crafting" phase (Crafter running)
- **THEN** calling `startPipeline()` with a new task succeeds without error and creates a new task record

### Requirement: Agent widget concurrent-row rendering tests

The test suite for `AgentWidget` SHALL verify formatting functions for multi-row concurrent-Crafter display, including running (🟢), queued/waiting (🟡), and done (✅) states.

#### Scenario: Concurrent widget rows show correct states

- **WHEN** two Crafters are active (one running, one waiting) and one step is complete
- **THEN** the widget formatting produces distinct visual states for each row

### Requirement: Worktree concurrent-isolation test

The test suite for worktree isolation SHALL verify that creating two worktrees simultaneously from the same repo doesn't cause interference, and cleaning up one doesn't affect the other.

#### Scenario: Concurrent worktrees coexist

- **WHEN** two worktrees are created for two different agent IDs from the same git repo
- **THEN** both worktrees exist simultaneously with distinct paths, and changes in one are invisible to the other

### Requirement: Project identity updated

The project SHALL identify itself as `pi-party` rather than `@tintinweb/pi-subagents` in `package.json`, `README.md`, and `CHANGELOG.md`.

#### Scenario: package.json reflects fork identity

- **WHEN** inspecting `package.json`
- **THEN** `name` is `pi-party`, `description` references pipeline orchestration, and repository URLs point to the fork

#### Scenario: README reflects pi-party identity

- **WHEN** reading the README
- **THEN** the title section identifies the project as pi-party, stripped features (scheduling, model scope) are not documented, and the architecture diagram lists current modules

#### Scenario: CHANGELOG has Milestone 8 entry

- **WHEN** inspecting the CHANGELOG
- **THEN** the [Unreleased] section includes a Milestone 8 entry documenting test coverage completion and identity cleanup
