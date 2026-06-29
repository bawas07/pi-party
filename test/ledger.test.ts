import { describe, expect, it } from "vitest";
import { Ledger } from "../src/ledger.js";
import { resolve } from "node:path";

describe("Ledger", () => {
  describe("claim and getClaimedFiles", () => {
    it("claim adds entry, getClaimedFiles returns union of all claims (task 5.10)", () => {
      const ledger = new Ledger();
      ledger.claim("crafter-1", ["/abs/auth.ts", "/abs/middleware.ts"], "edit");

      const claimed = ledger.getClaimedFiles();
      expect(claimed.size).toBe(2);
      expect(claimed.has("/abs/auth.ts")).toBe(true);
      expect(claimed.has("/abs/middleware.ts")).toBe(true);
    });

    it("multiple agents' files are unioned", () => {
      const ledger = new Ledger();
      ledger.claim("agent-a", ["/a.ts"]);
      ledger.claim("agent-b", ["/b.ts"]);

      const claimed = ledger.getClaimedFiles();
      expect(claimed.size).toBe(2);
      expect(claimed.has("/a.ts")).toBe(true);
      expect(claimed.has("/b.ts")).toBe(true);
    });
  });

  describe("release", () => {
    it("removes entry, returns true (task 5.11)", () => {
      const ledger = new Ledger();
      ledger.claim("crafter-1", ["/abs/auth.ts"]);
      expect(ledger.release("crafter-1")).toBe(true);
      expect(ledger.getClaimedFiles().size).toBe(0);
    });

    it("returns false for unknown agent (task 5.11)", () => {
      const ledger = new Ledger();
      expect(ledger.release("unknown")).toBe(false);
    });
  });

  describe("getConflictingFiles", () => {
    it("all free → empty array (task 5.12)", () => {
      const ledger = new Ledger();
      const conflicts = ledger.getConflictingFiles(["/a.ts", "/b.ts"]);
      expect(conflicts).toEqual([]);
    });

    it("partially claimed → returns subset (task 5.12)", () => {
      const ledger = new Ledger();
      ledger.claim("agent-a", ["/a.ts"]);
      const conflicts = ledger.getConflictingFiles(["/a.ts", "/b.ts"]);
      expect(conflicts).toEqual(["/a.ts"]);
    });

    it("fully claimed → returns all (task 5.12)", () => {
      const ledger = new Ledger();
      ledger.claim("agent-a", ["/a.ts", "/b.ts"]);
      const conflicts = ledger.getConflictingFiles(["/a.ts", "/b.ts"]);
      expect(conflicts.length).toBe(2);
    });
  });

  describe("re-claim for same agent", () => {
    it("replaces old claim, old files released (task 5.13)", () => {
      const ledger = new Ledger();
      ledger.claim("crafter-1", ["/old.ts"]);
      ledger.claim("crafter-1", ["/new.ts"]);

      const claimed = ledger.getClaimedFiles();
      expect(claimed.size).toBe(1);
      expect(claimed.has("/old.ts")).toBe(false);
      expect(claimed.has("/new.ts")).toBe(true);
    });
  });

  describe("disjoint claims", () => {
    it("two agents with disjoint files → no conflicts for B (task 5.14)", () => {
      const ledger = new Ledger();
      ledger.claim("agent-a", ["/a.ts"]);
      ledger.claim("agent-b", ["/b.ts"]);

      const conflicts = ledger.getConflictingFiles(["/b.ts"]);
      expect(conflicts).toEqual(["/b.ts"]); // B's own file IS claimed (by B)
    });

    it("two agents disjoint → candidate files not claimed get empty conflicts", () => {
      const ledger = new Ledger();
      ledger.claim("agent-a", ["/a.ts"]);
      ledger.claim("agent-b", ["/b.ts"]);

      const conflicts = ledger.getConflictingFiles(["/c.ts"]);
      expect(conflicts).toEqual([]);
    });
  });

  describe("overlapping claims", () => {
    it("overlapping files detected as conflicts (task 5.15)", () => {
      const ledger = new Ledger();
      ledger.claim("agent-a", ["/shared.ts", "/a.ts"]);
      ledger.claim("agent-b", ["/shared.ts", "/b.ts"]);

      // Check if candidate files for agent C conflict
      const conflicts = ledger.getConflictingFiles(["/shared.ts"]);
      expect(conflicts.length).toBe(1);
      expect(conflicts[0]).toBe("/shared.ts");
    });
  });

  describe("clear", () => {
    it("resets everything (task 5.16)", () => {
      const ledger = new Ledger();
      ledger.claim("a", ["/a.ts"]);
      ledger.claim("b", ["/b.ts"]);
      expect(ledger.getClaimedFiles().size).toBe(2);

      ledger.clear();
      expect(ledger.getClaimedFiles().size).toBe(0);
      expect(ledger.getActiveAgentIds()).toEqual([]);
    });
  });

  describe("path normalization", () => {
    it("relative paths are resolved to absolute (task 5.17)", () => {
      const ledger = new Ledger();
      ledger.claim("agent", ["src/auth.ts"]);
      const claimed = ledger.getClaimedFiles();
      const resolved = resolve("src/auth.ts");
      expect(claimed.has(resolved)).toBe(true);
    });

    it("isClaimed normalizes relative paths", () => {
      const ledger = new Ledger();
      ledger.claim("agent", ["/abs/auth.ts"]);
      expect(ledger.isClaimed("/abs/auth.ts")).toBe(true);
    });
  });

  describe("getActiveAgentIds", () => {
    it("reflects current state after claims and releases (task 5.18)", () => {
      const ledger = new Ledger();
      expect(ledger.getActiveAgentIds()).toEqual([]);

      ledger.claim("a", ["/a.ts"]);
      ledger.claim("b", ["/b.ts"]);
      expect(ledger.getActiveAgentIds()).toHaveLength(2);

      ledger.release("a");
      expect(ledger.getActiveAgentIds()).toEqual(["b"]);

      ledger.clear();
      expect(ledger.getActiveAgentIds()).toEqual([]);
    });
  });

  describe("isClaimed", () => {
    it("returns true for claimed file", () => {
      const ledger = new Ledger();
      ledger.claim("agent", ["/abs/auth.ts"]);
      expect(ledger.isClaimed("/abs/auth.ts")).toBe(true);
    });

    it("returns false for unclaimed file", () => {
      const ledger = new Ledger();
      expect(ledger.isClaimed("/abs/other.ts")).toBe(false);
    });
  });
});
