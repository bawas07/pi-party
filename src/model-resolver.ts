/**
 * Model resolution: exact match ("provider/modelId") with fuzzy fallback.
 * Also provides dynamic model selection by role preference.
 */

export interface ModelEntry {
  id: string;
  name: string;
  provider: string;
}

export interface ModelRegistry {
  find(provider: string, modelId: string): any;
  getAll(): any[];
  getAvailable?(): any[];
}

/**
 * Resolve a model string to a Model instance.
 * Tries exact match first ("provider/modelId"), then fuzzy match against all available models.
 * Returns the Model on success, or an error message string on failure.
 */
export function resolveModel(
  input: string,
  registry: ModelRegistry,
): any | string {
  // Available models (those with auth configured)
  const all = (registry.getAvailable?.() ?? registry.getAll()) as ModelEntry[];
  const availableSet = new Set(all.map(m => `${m.provider}/${m.id}`.toLowerCase()));

  // 1. Exact match: "provider/modelId" — only if available (has auth)
  const slashIdx = input.indexOf("/");
  if (slashIdx !== -1) {
    const provider = input.slice(0, slashIdx);
    const modelId = input.slice(slashIdx + 1);
    if (availableSet.has(input.toLowerCase())) {
      const found = registry.find(provider, modelId);
      if (found) return found;
    }
  }

  // 2. Fuzzy match against available models
  const query = input.toLowerCase();

  // Score each model: prefer exact id match > id contains > name contains > provider+id contains
  let bestMatch: ModelEntry | undefined;
  let bestScore = 0;

  for (const m of all) {
    const id = m.id.toLowerCase();
    const name = m.name.toLowerCase();
    const full = `${m.provider}/${m.id}`.toLowerCase();

    let score = 0;
    if (id === query || full === query) {
      score = 100; // exact
    } else if (id.includes(query) || full.includes(query)) {
      score = 60 + (query.length / id.length) * 30; // substring, prefer tighter matches
    } else if (name.includes(query)) {
      score = 40 + (query.length / name.length) * 20;
    } else if (query.split(/[\s\-/]+/).every(part => id.includes(part) || name.includes(part) || m.provider.toLowerCase().includes(part))) {
      score = 20; // all parts present somewhere
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = m;
    }
  }

  if (bestMatch && bestScore >= 20) {
    const found = registry.find(bestMatch.provider, bestMatch.id);
    if (found) return found;
  }

  // 3. No match — list available models
  const modelList = all
    .map(m => `  ${m.provider}/${m.id}`)
    .sort()
    .join("\n");
  return `Model not found: "${input}".\n\nAvailable models:\n${modelList}`;
}

/**
 * Party rules for model assignment. Keys map to ModelPreference values.
 * Loaded from party.rules.json (global and/or local).
 */
export interface PartyRulesConfig {
  fast?: string;
  general?: string;
  thinking?: string;
}

/**
 * Select a model by role preference. Config-driven — requires party.rules.json.
 *
 * @param preference - "fast" | "general" | "thinking" | "inherit"
 * @param registry - Model registry to query
 * @param parentModel - Parent session's model (required for "inherit")
 * @param rules - Party rules from party.rules.json (required for non-inherit)
 */
export function selectModel(
  preference: "fast" | "general" | "thinking" | "inherit",
  registry: ModelRegistry,
  parentModel?: any,
  rules?: PartyRulesConfig,
): any {
  const available = (registry.getAvailable?.() ?? registry.getAll()) as ModelEntry[];

  if (available.length === 0) {
    throw new Error(`selectModel: no models available for preference "${preference}". Ensure at least one model is configured with valid credentials.`);
  }

  // 1. "inherit" — return parent model, fall back to configured thinking
  if (preference === "inherit") {
    if (parentModel) {
      const parentId = typeof parentModel === "string" ? parentModel : `${parentModel.provider}/${parentModel.id}`;
      const availableSet = new Set(available.map(m => `${m.provider}/${m.id}`));
      if (availableSet.has(parentId)) return parentModel;
      console.warn(`[pi-party] Parent model "${parentId}" not in available registry, falling back to thinking preference.`);
    }
    return selectModel("thinking", registry, undefined, rules);
  }

  // 2. Config-driven — party.rules.json
  const configKey = preference as string; // "fast", "general", or "thinking"
  const configuredModel = rules?.[configKey as keyof PartyRulesConfig];
  if (configuredModel) {
    const slashIdx = configuredModel.indexOf("/");
    if (slashIdx !== -1) {
      const provider = configuredModel.slice(0, slashIdx);
      const modelId = configuredModel.slice(slashIdx + 1);
      const found = registry.find(provider, modelId);
      if (found) return found;
      console.warn(`[pi-party] Configured ${configKey} model "${configuredModel}" not in available registry.`);
    }
  }

  // 3. No config — error with guidance
  throw new Error(
    `No model configured for "${preference}" preference. ` +
    `Create a party.rules.json with a "${configKey}" entry, or run /party-rules to set one up interactively.`,
  );
}
