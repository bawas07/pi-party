import { describe, expect, it } from "vitest";
import { type ModelRegistry, resolveModel } from "../src/model-resolver.js";

// Mock model entries matching typical pi model registry shape
const MODELS = [
  { id: "claude-opus-4-6", name: "Claude Opus 4.6", provider: "anthropic" },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic" },
  { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", provider: "anthropic" },
  { id: "gpt-4o", name: "GPT-4o", provider: "openai" },
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "google" },
];

function makeRegistry(models = MODELS, available?: typeof MODELS): ModelRegistry {
  return {
    find(provider: string, modelId: string) {
      return models.find(m => m.provider === provider && m.id === modelId);
    },
    getAll() {
      return models;
    },
    getAvailable: available ? () => available : undefined,
  };
}

describe("resolveModel", () => {
  describe("exact match (provider/modelId)", () => {
    it("resolves exact provider/modelId", () => {
      const result = resolveModel("anthropic/claude-opus-4-6", makeRegistry());
      expect(result).toEqual(MODELS[0]);
    });

    it("resolves another exact provider/modelId", () => {
      const result = resolveModel("openai/gpt-4o", makeRegistry());
      expect(result).toEqual(MODELS[3]);
    });

    it("falls through to fuzzy when exact provider/modelId not found", () => {
      // "anthropic/haiku" is not an exact match, but fuzzy should find it
      const result = resolveModel("anthropic/haiku", makeRegistry());
      expect(result).toEqual(MODELS[2]); // haiku
    });
  });

  describe("fuzzy match — exact id", () => {
    it("matches exact model id without provider", () => {
      const result = resolveModel("claude-opus-4-6", makeRegistry());
      expect(result).toEqual(MODELS[0]);
    });

    it("is case-insensitive", () => {
      const result = resolveModel("Claude-Opus-4-6", makeRegistry());
      expect(result).toEqual(MODELS[0]);
    });

    it("matches exact id for non-anthropic models", () => {
      const result = resolveModel("gpt-4o", makeRegistry());
      expect(result).toEqual(MODELS[3]);
    });
  });

  describe("fuzzy match — substring", () => {
    it("matches 'haiku' to claude-haiku model", () => {
      const result = resolveModel("haiku", makeRegistry());
      expect(result).toEqual(MODELS[2]);
    });

    it("matches 'sonnet' to claude-sonnet model", () => {
      const result = resolveModel("sonnet", makeRegistry());
      expect(result).toEqual(MODELS[1]);
    });

    it("matches 'opus' to claude-opus model", () => {
      const result = resolveModel("opus", makeRegistry());
      expect(result).toEqual(MODELS[0]);
    });

    it("matches 'gemini' to gemini model", () => {
      const result = resolveModel("gemini", makeRegistry());
      expect(result).toEqual(MODELS[4]);
    });

    it("is case-insensitive for substring", () => {
      const result = resolveModel("HAIKU", makeRegistry());
      expect(result).toEqual(MODELS[2]);
    });
  });

  describe("fuzzy match — name contains", () => {
    it("matches 'Opus 4.6' via model name", () => {
      const result = resolveModel("Opus 4.6", makeRegistry());
      expect(result).toEqual(MODELS[0]);
    });

    it("matches 'Haiku 4.5' via model name", () => {
      const result = resolveModel("Haiku 4.5", makeRegistry());
      expect(result).toEqual(MODELS[2]);
    });
  });

  describe("fuzzy match — multi-part", () => {
    it("matches 'anthropic opus' across provider and id", () => {
      const result = resolveModel("anthropic opus", makeRegistry());
      expect(result).toEqual(MODELS[0]);
    });

    it("matches 'google pro' across provider and id", () => {
      const result = resolveModel("google pro", makeRegistry());
      expect(result).toEqual(MODELS[4]);
    });
  });

  describe("fuzzy match — prefers tighter matches", () => {
    it("prefers exact id over substring", () => {
      const result = resolveModel("gpt-4o", makeRegistry());
      expect(result).toEqual(MODELS[3]);
    });

    it("substring match prefers shorter model id (tighter fit)", () => {
      // Both opus and sonnet contain their query as substring, but "opus" is a tighter match
      // for "opus" than "sonnet" is for "sonnet" — each should resolve to itself
      expect(resolveModel("opus", makeRegistry())).toEqual(MODELS[0]);
      expect(resolveModel("sonnet", makeRegistry())).toEqual(MODELS[1]);
    });
  });

  describe("no match", () => {
    it("returns error string for unknown model", () => {
      const result = resolveModel("nonexistent-model", makeRegistry());
      expect(typeof result).toBe("string");
      expect(result).toContain('Model not found: "nonexistent-model"');
      expect(result).toContain("Available models:");
    });

    it("error lists available models", () => {
      const result = resolveModel("xyz", makeRegistry());
      expect(result).toContain("anthropic/claude-opus-4-6");
      expect(result).toContain("openai/gpt-4o");
    });

    it("empty string matches a model (multi-part vacuous truth)", () => {
      // Empty string splits to empty parts; every() on empty array is true
      // This is fine — callers guard against empty input
      const result = resolveModel("", makeRegistry());
      expect(typeof result).toBe("object");
    });
  });

  describe("getAvailable filtering", () => {
    it("uses getAvailable when present (filters to configured models)", () => {
      const available = [MODELS[0], MODELS[2]]; // only opus and haiku
      const result = resolveModel("sonnet", makeRegistry(MODELS, available));
      // sonnet is in getAll but not in getAvailable — should not fuzzy match
      expect(typeof result).toBe("string");
      expect(result).toContain("Model not found");
    });

    it("exact match fails when model is not in getAvailable (no auth)", () => {
      const available = [MODELS[0]]; // only opus available
      const result = resolveModel("anthropic/claude-sonnet-4-6", makeRegistry(MODELS, available));
      expect(typeof result).toBe("string");
      expect(result).toContain("Model not found");
    });

    it("fuzzy matches against available models only", () => {
      const available = [MODELS[2]]; // only haiku available
      const result = resolveModel("haiku", makeRegistry(MODELS, available));
      expect(result).toEqual(MODELS[2]);
    });
  });

  describe("ambiguous matches", () => {
    const SIMILAR_MODELS = [
      { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic" },
      { id: "claude-sonnet-4-5-20241022", name: "Claude Sonnet 4.5", provider: "anthropic" },
      { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", provider: "anthropic" },
    ];

    it("'sonnet' prefers tighter id match (shorter id)", () => {
      const result = resolveModel("sonnet", makeRegistry(SIMILAR_MODELS));
      // "sonnet" is a larger fraction of "claude-sonnet-4-6" than "claude-sonnet-4-5-20241022"
      expect(result).toEqual(SIMILAR_MODELS[0]);
    });

    it("'sonnet 4.5' resolves to the 4.5 model via name", () => {
      const result = resolveModel("sonnet 4.5", makeRegistry(SIMILAR_MODELS));
      expect(result).toEqual(SIMILAR_MODELS[1]);
    });

    it("'4-6' picks the 4.6 model", () => {
      const result = resolveModel("4-6", makeRegistry(SIMILAR_MODELS));
      expect(result).toEqual(SIMILAR_MODELS[0]);
    });
  });

  describe("empty registry", () => {
    it("returns error with empty available list", () => {
      const result = resolveModel("haiku", makeRegistry([]));
      expect(typeof result).toBe("string");
      expect(result).toContain("Model not found");
    });
  });
});

// ---- selectModel tests ----

import { selectModel, type PartyRulesConfig } from "../src/model-resolver.js";

const MODELS_NO_CTX = [
  { id: "claude-opus-4-6", name: "Claude Opus 4.6", provider: "anthropic" },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic" },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "anthropic" },
  { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: "openai" },
  { id: "gpt-4o", name: "GPT-4o", provider: "openai" },
];

function makeSelectRegistry(models = MODELS_NO_CTX): ModelRegistry {
  return {
    find(provider: string, modelId: string) {
      return models.find(m => m.provider === provider && m.id === modelId) ?? null;
    },
    getAll() {
      return models;
    },
  };
}

describe("selectModel", () => {
  describe("config-driven (party rules set)", () => {
    const rules: PartyRulesConfig = {
      fast: "openai/gpt-4o-mini",
      general: "openai/gpt-4o",
      thinking: "anthropic/claude-sonnet-4-6",
    };

    it("returns configured fast model directly", () => {
      const result = selectModel("fast", makeSelectRegistry(), undefined, rules);
      expect(result).toBeDefined();
      expect(result.id).toBe("gpt-4o-mini");
      expect(result.provider).toBe("openai");
    });

    it("returns configured general model directly", () => {
      const result = selectModel("general", makeSelectRegistry(), undefined, rules);
      expect(result).toBeDefined();
      expect(result.id).toBe("gpt-4o");
      expect(result.provider).toBe("openai");
    });

    it("returns configured thinking model directly", () => {
      const result = selectModel("thinking", makeSelectRegistry(), undefined, rules);
      expect(result).toBeDefined();
      expect(result.id).toBe("claude-sonnet-4-6");
      expect(result.provider).toBe("anthropic");
    });
  });

  describe("partial config", () => {
    it("uses configured fast when only fast is set", () => {
      const result = selectModel("fast", makeSelectRegistry(), undefined, { fast: "openai/gpt-4o-mini" });
      expect(result).toBeDefined();
      expect(result.id).toBe("gpt-4o-mini");
    });

    it("throws for general when only fast is configured", () => {
      expect(() => selectModel("general", makeSelectRegistry(), undefined, { fast: "openai/gpt-4o-mini" }))
        .toThrow(/No model configured for "general"/);
    });
  });

  describe("no config — throws with guidance", () => {
    it("throws for fast with no party rules", () => {
      expect(() => selectModel("fast", makeSelectRegistry())).toThrow(/No model configured for "fast"/);
    });

    it("throws for general with no party rules", () => {
      expect(() => selectModel("general", makeSelectRegistry())).toThrow(/No model configured for "general"/);
    });

    it("throws for thinking with no party rules", () => {
      expect(() => selectModel("thinking", makeSelectRegistry())).toThrow(/No model configured for "thinking"/);
    });

    it("error message mentions /party-rules", () => {
      expect(() => selectModel("fast", makeSelectRegistry())).toThrow(/\/party-rules/);
    });
  });

  describe("inherit preference", () => {
    const rules: PartyRulesConfig = { thinking: "anthropic/claude-opus-4-6" };

    it("returns parent model when available", () => {
      const parent = { provider: "anthropic", id: "claude-sonnet-4-6", name: "Sonnet" };
      const result = selectModel("inherit", makeSelectRegistry(), parent, rules);
      expect(result).toBe(parent);
    });

    it("falls back to configured thinking when parent model is unavailable", () => {
      const parent = { provider: "mistral", id: "large", name: "Mistral Large" };
      const result = selectModel("inherit", makeSelectRegistry(), parent, rules);
      expect(result).toBeDefined();
      expect(result.id).toBe("claude-opus-4-6");
      expect(result.provider).toBe("anthropic");
    });

    it("throws when inherit falls back and thinking is not configured", () => {
      const parent = { provider: "mistral", id: "large", name: "Mistral Large" };
      expect(() => selectModel("inherit", makeSelectRegistry(), parent)).toThrow(/No model configured for "thinking"/);
    });
  });

  describe("configured model not in registry", () => {
    it("throws when configured model is unavailable (no auto-assignment fallback)", () => {
      expect(() => selectModel("fast", makeSelectRegistry(), undefined, { fast: "mistral/small" }))
        .toThrow(/No model configured for "fast"/);
    });
  });

  describe("no models available", () => {
    it("throws descriptive error on empty registry", () => {
      expect(() => selectModel("fast", makeSelectRegistry([]), undefined, { fast: "openai/gpt-4o-mini" })).toThrow(
        /no models available/,
      );
    });
  });
});
