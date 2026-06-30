import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// We need to mock getAgentDir for global path tests
const TEST_GLOBAL_DIR = join(tmpdir(), `pi-party-test-global-${randomUUID().slice(0, 8)}`);
const TEST_PROJECT_DIR = join(tmpdir(), `pi-party-test-project-${randomUUID().slice(0, 8)}`);

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => TEST_GLOBAL_DIR,
}));

import {
  loadPartyRules,
  savePartyRules,
  partyRulesExists,
  partyRulesPath,
  describePartyRulesSources,
  type PartyRules,
  type PartyRulesScope,
} from "../src/party-rules.js";

function setup() {
  mkdirSync(TEST_GLOBAL_DIR, { recursive: true });
  mkdirSync(join(TEST_PROJECT_DIR, ".pi"), { recursive: true });
}

function teardown() {
  rmSync(TEST_GLOBAL_DIR, { recursive: true, force: true });
  rmSync(TEST_PROJECT_DIR, { recursive: true, force: true });
}

function writeJson(path: string, data: unknown) {
  writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
}

describe("party-rules", () => {
  beforeEach(() => {
    teardown();
    setup();
  });

  afterEach(() => {
    teardown();
  });

  describe("savePartyRules", () => {
    it("saves rules to local scope", () => {
      const rules: PartyRules = { fast: "openai/gpt-4o-mini", general: "openai/gpt-4o" };
      const ok = savePartyRules(rules, "local", TEST_PROJECT_DIR);
      expect(ok).toBe(true);

      const path = partyRulesPath("local", TEST_PROJECT_DIR);
      expect(existsSync(path)).toBe(true);
      const saved = JSON.parse(readFileSync(path, "utf-8"));
      expect(saved).toEqual(rules);
    });

    it("saves rules to global scope", () => {
      const rules: PartyRules = { thinking: "anthropic/claude-opus-4-6" };
      const ok = savePartyRules(rules, "global", TEST_PROJECT_DIR);
      expect(ok).toBe(true);

      const path = partyRulesPath("global", TEST_PROJECT_DIR);
      expect(existsSync(path)).toBe(true);
      const saved = JSON.parse(readFileSync(path, "utf-8"));
      expect(saved).toEqual(rules);
    });

    it("creates parent directories", () => {
      // Remove the .pi dir and test auto-creation
      const deep = join(TEST_PROJECT_DIR, ".pi");
      rmSync(deep, { recursive: true, force: true });
      expect(existsSync(deep)).toBe(false);

      const rules: PartyRules = { fast: "openai/gpt-4o-mini" };
      const ok = savePartyRules(rules, "local", TEST_PROJECT_DIR);
      expect(ok).toBe(true);
      expect(existsSync(partyRulesPath("local", TEST_PROJECT_DIR))).toBe(true);
    });
  });

  describe("loadPartyRules", () => {
    it("returns empty object when no files exist", () => {
      const rules = loadPartyRules(TEST_PROJECT_DIR);
      expect(rules).toEqual({});
    });

    it("loads local rules only", () => {
      const rules: PartyRules = { fast: "openai/gpt-4o-mini" };
      savePartyRules(rules, "local", TEST_PROJECT_DIR);

      const loaded = loadPartyRules(TEST_PROJECT_DIR);
      expect(loaded).toEqual(rules);
    });

    it("loads global rules only", () => {
      const rules: PartyRules = { general: "openai/gpt-4o" };
      savePartyRules(rules, "global", TEST_PROJECT_DIR);

      const loaded = loadPartyRules(TEST_PROJECT_DIR);
      expect(loaded).toEqual(rules);
    });

    it("local overrides global per-key", () => {
      savePartyRules({ fast: "openai/gpt-4o-mini", general: "openai/gpt-4o" }, "global", TEST_PROJECT_DIR);
      savePartyRules({ fast: "anthropic/claude-haiku-4-5" }, "local", TEST_PROJECT_DIR);

      const loaded = loadPartyRules(TEST_PROJECT_DIR);
      expect(loaded.fast).toBe("anthropic/claude-haiku-4-5"); // local wins
      expect(loaded.general).toBe("openai/gpt-4o"); // global only
      expect(loaded.thinking).toBeUndefined();
    });

    it("ignores malformed JSON", () => {
      const path = partyRulesPath("local", TEST_PROJECT_DIR);
      writeFileSync(path, "not json", "utf-8");

      const loaded = loadPartyRules(TEST_PROJECT_DIR);
      expect(loaded).toEqual({});
    });

    it("ignores entries without slash (invalid format)", () => {
      writeJson(partyRulesPath("local", TEST_PROJECT_DIR), { fast: "invalid-format" });

      const loaded = loadPartyRules(TEST_PROJECT_DIR);
      expect(loaded.fast).toBeUndefined();
    });
  });

  describe("partyRulesExists", () => {
    it("returns false when no file exists", () => {
      expect(partyRulesExists("local", TEST_PROJECT_DIR)).toBe(false);
      expect(partyRulesExists("global", TEST_PROJECT_DIR)).toBe(false);
    });

    it("returns true when file exists", () => {
      savePartyRules({ fast: "openai/gpt-4o-mini" }, "local", TEST_PROJECT_DIR);
      expect(partyRulesExists("local", TEST_PROJECT_DIR)).toBe(true);
    });
  });

  describe("partyRulesPath", () => {
    it("returns correct local path", () => {
      const path = partyRulesPath("local", TEST_PROJECT_DIR);
      expect(path).toBe(join(TEST_PROJECT_DIR, ".pi", "party.rules.json"));
    });

    it("returns correct global path", () => {
      const path = partyRulesPath("global", TEST_PROJECT_DIR);
      expect(path).toBe(join(TEST_GLOBAL_DIR, "party.rules.json"));
    });
  });

  describe("describePartyRulesSources", () => {
    it("says no rules when none exist", () => {
      const desc = describePartyRulesSources(TEST_PROJECT_DIR);
      expect(desc).toContain("No party.rules.json found");
      expect(desc).toContain("/party-rules");
    });

    it("detects local rules", () => {
      savePartyRules({ fast: "openai/gpt-4o-mini" }, "local", TEST_PROJECT_DIR);
      const desc = describePartyRulesSources(TEST_PROJECT_DIR);
      expect(desc).toContain("local");
    });

    it("detects global rules", () => {
      savePartyRules({ general: "openai/gpt-4o" }, "global", TEST_PROJECT_DIR);
      const desc = describePartyRulesSources(TEST_PROJECT_DIR);
      expect(desc).toContain("global");
    });

    it("detects both", () => {
      savePartyRules({ fast: "openai/gpt-4o-mini" }, "global", TEST_PROJECT_DIR);
      savePartyRules({ general: "openai/gpt-4o" }, "local", TEST_PROJECT_DIR);
      const desc = describePartyRulesSources(TEST_PROJECT_DIR);
      expect(desc).toContain("global");
      expect(desc).toContain("local");
    });
  });
});
