/**
 * trigger.ts — Per-turn intent detection hooks.
 *
 * Three independent, rule-based evaluations:
 *   1. noPlanIntent — user explicitly said no plan needed (checked first)
 *   2. implementIntent — how strong is implementation intent (high/medium/low)
 *   3. needsScout — does the main agent need codebase knowledge?
 *
 * Rule-based classification — no LLM calls, cheap and deterministic.
 */

// ---- Types ----

export interface TurnContext {
  /** The user's latest message text. */
  userMessage: string;
  /** Optional: recent conversation context summary. */
  conversationSummary?: string;
  /** Whether the main agent already has up-to-date codebase knowledge. */
  agentHasCodebaseKnowledge?: boolean;
  /** Current working directory. */
  workingDirectory?: string;
}

export interface TriggerResult {
  noPlanIntent: boolean;
  implementIntent: "high" | "medium" | "low";
  needsScout: boolean;
}

// ---- noPlanIntent ----

const NO_PLAN_PATTERNS = [
  /\bno need to plan\b/i,
  /\bskip the plan\b/i,
  /\bdon'?t plan\b/i,
  /\bwithout (a|any) plan\b/i,
  /\bno planning (needed|required|necessary)\b/i,
  /\bjust (implement|do|code) it\s+directly\b/i,
  /\bimplement directly\b/i,
  /\bdon'?t (bother|worry about) (planning|a plan)\b/i,
  /\bgo ahead (and|&) (implement|code|build|do) it\b/i,
];

/**
 * Detect explicit no-plan intent.
 * Returns true ONLY when the user's message contains explicit language
 * stating that planning should be skipped.
 * Deliberately conservative — never inferred from casual/brief phrasing.
 */
export function noPlanIntent(ctx: TurnContext): boolean {
  for (const pattern of NO_PLAN_PATTERNS) {
    if (pattern.test(ctx.userMessage)) return true;
  }
  return false;
}

// ---- implementIntent ----

const HIGH_INTENT_PATTERNS = [
  // Build/create/implement + common dev targets
  /\b(build|create|implement|develop|make|add|write|code)\b.*\b(feature|system|module|api|endpoint|service|component|page|route|screen|view|widget|dashboard|chart|table|form|modal|dialog|button|layout|nav|header|footer|sidebar|panel|card|list|grid|filter|search|upload|download|auth|login|signup|profile|settings|notification|alert|badge|tooltip|dropdown|menu|drawer|wizard|stepper|carousel|gallery|calendar|timeline|map)\b/i,
  // Refactor / migrate / upgrade
  /\brefactor\b.+\b(to|use|into|with)\b/i,
  /\bmigrate\b.+\b(from|to)\b/i,
  /\b(set up|scaffold|bootstrap|initialize)\b/i,
  /\b(rewrite|rework|overhaul|redesign|revamp)\b/i,
  /\bupgrade\b.+\b(to|version)\b/i,
  // Fix patterns
  /\bfix\b.+\b(bug|issue|error|problem|crash|break|broken|wrong|typo|glitch)\b/i,
  /\bfix\b.+\b(in|with|on)\b.+\b(file|code|module|function|component|page|layout|style|css)\b/i,
  /\b(fix|resolve|address|patch)\b.+\b(the|this|that)\b/i,
  // Change / update / modify
  /\b(change|update|modify|replace|remove|delete|rename)\b.+\b(to|from|with|the|this)\b/i,
  /\bconvert\b.+\b(to|from)\b/i,
  // Broader imperative implementation patterns
  /\b(need|want|would like) (to|you to) (build|create|add|implement|make|write|code|develop)\b/i,
  /\b(can|could) you (build|create|add|implement|make|write|code|develop)\b/i,
  /\bplease (build|create|add|implement|make|write|code|develop)\b/i,
  /\b(let'?s|go ahead and) (build|create|add|implement|make|write)\b/i,
];

const MEDIUM_INTENT_PATTERNS = [
  /\bhow (would|should|can|do) (I|we|you)\b/i,
  /\bwhat('s| is) the best way\b/i,
  /\b(is it better to|should I|what do you think about)\b/i,
  /\bcan (you|we) help (me )?(figure out|understand|decide)\b/i,
  /\b(do you think|what about|how about)\b/i,
  /\b(recommend|suggest)\b.+\b(approach|way|method|library|tool|pattern)\b/i,
];

/**
 * Three-tier implement-intent classification.
 * Only called when noPlanIntent() returns false.
 */
export function implementIntent(ctx: TurnContext): "high" | "medium" | "low" {
  const msg = ctx.userMessage;
  const isQuestion = msg.trim().endsWith("?");

  // Check medium-intent patterns first — questions about implementation are medium,
  // not high, even if they contain implementation verbs.
  for (const pattern of MEDIUM_INTENT_PATTERNS) {
    if (pattern.test(msg)) {
      return "medium";
    }
  }

  // Questions with implementation verbs → medium
  if (isQuestion && /\b(implement|build|code|refactor|add|change|fix|migrate|create)\b/i.test(msg)) {
    return "medium";
  }

  // Check high-intent patterns
  for (const pattern of HIGH_INTENT_PATTERNS) {
    if (pattern.test(msg)) return "high";
  }

  // Additional high-intent checks: imperative with file references
  if (/\b(update|change|modify|delete|remove|rename)\b.*\b(file|function|class|module|code)\b/i.test(msg)) {
    return "high";
  }

  return "low";
}

// ---- needsScout ----

const SCOUT_POSITIVE_PATTERNS = [
  // Direct codebase exploration verbs + target
  /\b(find|locate|search for|look for|look (?:at|into|through)|check|inspect|review|scan|grep|explore)\b.+\b(file|code|module|function|class|definition|implementation|pattern|code\s*base|codebase)\b/i,
  /\bwhere (?:is|are)\b.+\b(defined|located|implemented|used|referenced|called|stored)\b/i,
  /\bwhich (?:file|module|package)\b.+\b(contains|has|defines|exports|handles|owns)\b/i,
  // Broader codebase/project exploration
  /\b(?:check|inspect|review|explore|look (?:at|into|through))\b.+\b(?:code\s*base|codebase|project|repo|repository|code)\b/i,
  /\b(?:tell me|show me|what'?s|what is)\b.+\b(?:code\s*base|codebase|project)\b(?!.*\b(?:this|that|it)\s*$)/i,
  /\bhow (?:is|are)\b.+\b(structured|organized|connected|wired|implemented|architected)\b/i,
  /\bwhat (?:pattern|approach|library|framework)\b.+\b(?:use|using|used)\b/i,
  /\b(?:dependency|depend|import)\b.+\b(?:map|graph|tree|chain)\b/i,
  /\bgrep\b.+\b(?:for|across|through)\b/i,
  /\bscan\b.+\b(?:for|the|all)\b/i,
];

// Excluded: file-tree lookups, config/doc files, already-known paths
const SCOUT_NEGATIVE_PATTERNS = [
  /\b(list|ls|show)\b.+\b(files?|director(?:y|ies)|folder)\b/i,
  /\b(read|check|look at|open|view)\b.+\b(package\.json|tsconfig\.json|\.md|README|CHANGELOG|\.env|\.gitignore|config)\b/i,
  /\b(what does|explain|describe)\b.+\b(error|message|output|result)\b/i,
  /\b(what is|tell me about|how does)\b.+\b(this|that|it)\b/i,
  // Pure doc-reference queries: "based on @file.md" or "according to docs/foo.md" without codebase verbs
  /^\s*(?:(?:hi|hey|hello)[,\.!]?\s*)?(?:please\s+)?(?:check|read|look at|tell me about)\s+.*@[a-z]+\.md/i,
];

/**
 * Binary: does answering/proceeding require codebase knowledge the
 * main agent doesn't already have? Returns false for file-tree lookups,
 * config/doc files, general Q&A, and already-known paths.
 */
export function needsScout(ctx: TurnContext): boolean {
  if (ctx.agentHasCodebaseKnowledge) return false;

  const msg = ctx.userMessage;

  // Check positive patterns first — if any match, Scout fires regardless of negatives.
  // This ensures combined queries (e.g. "check the codebase and read foo.md")
  // still dispatch Scout for the codebase-exploration part.
  for (const pattern of SCOUT_POSITIVE_PATTERNS) {
    if (pattern.test(msg)) return true;
  }

  // Negative patterns only apply when no positive matched — they block
  // pure file-tree lookups, doc reads, or vague Q&A from wasting a Scout.
  for (const pattern of SCOUT_NEGATIVE_PATTERNS) {
    if (pattern.test(msg)) return false;
  }

  return false;
}

// ---- Combined evaluation ----

const CLASSIFY_SYSTEM_PROMPT = `You are an intent classifier. Classify user messages into structured outputs.

Rules:
- noPlanIntent: true ONLY if the user EXPLICITLY says to skip planning. Examples: "no need to plan", "just implement it directly", "don't plan this", "skip the plan", "go ahead and build it". Be conservative — casual or brief phrasing is NOT a skip-plan signal. Only return true when the user literally says not to plan.
- implementIntent: "high" if the user wants code written/built/refactored/added NOW. "medium" if they're asking about implementation approach, seeking recommendations, or exploring options. "low" for general discussion, questions, or anything else.

Return ONLY a JSON object, no other text:
{"noPlanIntent": true|false, "implementIntent": "high"|"medium"|"low"}`;

/**
 * Classify user intent using an LLM call (haiku for speed/cost).
 * Falls back to regex if the LLM call fails.
 */
export async function classifyWithLLM(
  ctx: TurnContext,
  modelInfo: { provider: string; apiKey: string; baseUrl?: string; modelId?: string },
): Promise<TriggerResult> {
  const prompt = `Message: "${ctx.userMessage.replace(/"/g, '\\"')}"`;

  try {
    const result = await callProviderAPI(modelInfo, CLASSIFY_SYSTEM_PROMPT, prompt);
    const parsed = JSON.parse(result);
    return {
      noPlanIntent: parsed.noPlanIntent === true,
      implementIntent: ["high", "medium", "low"].includes(parsed.implementIntent)
        ? parsed.implementIntent
        : "low",
      needsScout: needsScout(ctx), // still regex-based, prompt-guided for standalone dispatch
    };
  } catch {
    // Fallback to regex on any LLM failure
    return evaluateAll(ctx);
  }
}

async function callProviderAPI(
  modelInfo: { provider: string; apiKey: string; baseUrl?: string; modelId?: string },
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  const modelId = modelInfo.modelId ?? "claude-haiku-4-5-20251001";

  if (modelInfo.provider === "anthropic") {
    const baseUrl = modelInfo.baseUrl ?? "https://api.anthropic.com";
    const resp = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": modelInfo.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 50,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
    });
    if (!resp.ok) throw new Error(`Anthropic API error: ${resp.status}`);
    const data = await resp.json() as any;
    return data?.content?.[0]?.text ?? "";
  }

  if (modelInfo.provider === "openai" || modelInfo.provider === "openai-codex") {
    const baseUrl = modelInfo.baseUrl ?? "https://api.openai.com";
    const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${modelInfo.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 50,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
      }),
    });
    if (!resp.ok) throw new Error(`OpenAI API error: ${resp.status}`);
    const data = await resp.json() as any;
    return data?.choices?.[0]?.message?.content ?? "";
  }

  throw new Error(`Unsupported provider: ${modelInfo.provider}`);
}

/**
 * Run all three hooks and return a combined result.
 * Prefer LLM classification for noPlanIntent and implementIntent;
 * fall back to regex if LLM info is unavailable.
 */
export function evaluateAll(ctx: TurnContext): TriggerResult {
  const noPlan = noPlanIntent(ctx);
  const intent = noPlan ? "low" : implementIntent(ctx);
  const scout = needsScout(ctx);

  return {
    noPlanIntent: noPlan,
    implementIntent: intent,
    needsScout: scout,
  };
}
