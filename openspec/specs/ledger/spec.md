## ADDED Requirements

### Requirement: Claim files for an agent

The system SHALL provide a `claim(agentId: string, files: string[], action?: string): void` method on the Ledger class that records which files an agent expects to touch. All file paths SHALL be normalized to absolute. If the agent already has a claim, it SHALL be replaced.

#### Scenario: New agent claims files

- **WHEN** `ledger.claim("crafter-1", ["/abs/path/auth.ts", "/abs/path/middleware.ts"], "edit")` is called
- **THEN** the ledger records those files as claimed by "crafter-1"

#### Scenario: Agent reclaims with different files

- **WHEN** `ledger.claim("crafter-1", ["/abs/path/new.ts"])` is called after a previous claim
- **THEN** the old files are released and only "/abs/path/new.ts" is claimed by "crafter-1"

### Requirement: Release an agent's claims

The system SHALL provide a `release(agentId: string): boolean` method that removes all file claims for the given agent. It SHALL return `true` if claims existed, `false` if the agent was not tracked.

#### Scenario: Release tracked agent

- **WHEN** `ledger.release("crafter-1")` is called after `ledger.claim("crafter-1", [...])`
- **THEN** `true` is returned and the agent's files are no longer claimed

#### Scenario: Release untracked agent

- **WHEN** `ledger.release("unknown-agent")` is called
- **THEN** `false` is returned

### Requirement: Get all currently claimed files

The system SHALL provide a `getClaimedFiles(): Set<string>` method that returns the union of all in-flight agents' claimed file sets.

#### Scenario: Multiple agents, disjoint files

- **WHEN** agent A claims `["/a.ts"]` and agent B claims `["/b.ts"]`
- **THEN** `getClaimedFiles()` returns `Set { "/a.ts", "/b.ts" }`

#### Scenario: No agents active

- **WHEN** no agents have claims
- **THEN** `getClaimedFiles()` returns an empty `Set`

### Requirement: Check if a specific file is claimed

The system SHALL provide an `isClaimed(file: string): boolean` method that normalizes the path and returns `true` if any in-flight agent has claimed it.

#### Scenario: File is claimed

- **WHEN** `ledger.isClaimed("/abs/path/auth.ts")` is called and that file was claimed
- **THEN** `true` is returned

#### Scenario: File is not claimed

- **WHEN** `ledger.isClaimed("/abs/path/other.ts")` is called and no agent claims it
- **THEN** `false` is returned

### Requirement: Get conflicting files for a candidate set

The system SHALL provide a `getConflictingFiles(files: string[]): string[]` method that returns the subset of input files currently claimed by any in-flight agent. An empty array SHALL mean no conflicts exist.

#### Scenario: No conflicts

- **WHEN** `getConflictingFiles(["/a.ts", "/b.ts"])` is called and neither file is claimed
- **THEN** an empty array `[]` is returned

#### Scenario: Partial conflicts

- **WHEN** agent A claims `["/a.ts"]` and `getConflictingFiles(["/a.ts", "/b.ts"])` is called
- **THEN** `["/a.ts"]` is returned

#### Scenario: All files conflict

- **WHEN** agent A claims `["/a.ts", "/b.ts"]` and `getConflictingFiles(["/a.ts", "/b.ts"])` is called
- **THEN** `["/a.ts", "/b.ts"]` is returned

### Requirement: Get active agent IDs

The system SHALL provide a `getActiveAgentIds(): string[]` method that returns the IDs of all agents with current claims.

#### Scenario: Agents active

- **WHEN** two agents have claims
- **THEN** `getActiveAgentIds()` returns both IDs

#### Scenario: No agents

- **WHEN** the ledger is empty
- **THEN** `getActiveAgentIds()` returns `[]`

### Requirement: Clear all ledger state

The system SHALL provide a `clear(): void` method that removes all claims and resets the ledger to its initial empty state.

#### Scenario: Clear populated ledger

- **WHEN** `ledger.clear()` is called after claims were added
- **THEN** `getClaimedFiles()` returns an empty Set and `getActiveAgentIds()` returns `[]`

### Requirement: Path normalization

The system SHALL normalize all file paths to absolute before storing or comparing them. Relative paths provided to `claim()`, `isClaimed()`, or `getConflictingFiles()` SHALL be resolved against the current working directory.

#### Scenario: Relative path normalized

- **WHEN** `ledger.claim("agent", ["src/auth.ts"])` is called
- **THEN** the file is stored as an absolute path (e.g., `/home/user/project/src/auth.ts`)
