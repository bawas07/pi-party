/**
 * ledger.ts — File-level conflict tracker for concurrent Crafter dispatch.
 *
 * Records which files are claimed by in-flight Crafters so the orchestrator
 * can hold back spawns whose target files overlap with active Crafter claims.
 *
 * In-memory only for M5. Persistence decision deferred.
 */

import { resolve } from "node:path";

// ---- Types ----

export interface LedgerEntry {
  agentId: string;
  files: Set<string>;
  action: string;
  timestamp: number;
}

// ---- Ledger ----

export class Ledger {
  private entries = new Map<string, LedgerEntry>();

  /**
   * Claim files for an agent.
   * All paths are normalized to absolute. If the agent already has a claim,
   * it is replaced (re-spawn of same step after fix).
   */
  claim(agentId: string, files: string[], action: string = "edit"): void {
    const normalized = files.map(f => resolve(f));
    this.entries.set(agentId, {
      agentId,
      files: new Set(normalized),
      action,
      timestamp: Date.now(),
    });
  }

  /**
   * Release all claims for an agent.
   * Returns true if the agent was tracked, false otherwise.
   */
  release(agentId: string): boolean {
    return this.entries.delete(agentId);
  }

  /**
   * Get the union of all in-flight agents' claimed files.
   */
  getClaimedFiles(): Set<string> {
    const all = new Set<string>();
    for (const entry of this.entries.values()) {
      for (const file of entry.files) {
        all.add(file);
      }
    }
    return all;
  }

  /**
   * Check if a specific file is claimed by any in-flight agent.
   * Normalizes the path before checking.
   */
  isClaimed(file: string): boolean {
    const normalized = resolve(file);
    for (const entry of this.entries.values()) {
      if (entry.files.has(normalized)) return true;
    }
    return false;
  }

  /**
   * Return the subset of input files that are currently claimed by
   * any in-flight agent. Empty array = no conflicts, safe to dispatch.
   */
  getConflictingFiles(files: string[]): string[] {
    const claimed = this.getClaimedFiles();
    return files
      .map(f => resolve(f))
      .filter(f => claimed.has(f));
  }

  /**
   * Get the IDs of all agents with current claims.
   */
  getActiveAgentIds(): string[] {
    return [...this.entries.keys()];
  }

  /**
   * Remove all entries and reset to empty state.
   */
  clear(): void {
    this.entries.clear();
  }
}
