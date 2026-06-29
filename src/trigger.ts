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
  /\b(build|create|implement|develop)\b.+\b(feature|system|module|api|endpoint|service|component|page|route)\b/i,
  /\b(add|write|code) (a |the |some )?.*\b(feature|function|method|class|module|test|endpoint)\b/i,
  /\brefactor\b.+\b(to|use|into|with)\b/i,
  /\bmigrate\b.+\b(from|to)\b/i,
  /\b(set up|scaffold|bootstrap|initialize)\b/i,
  /\b(rewrite|rework|overhaul)\b/i,
  /\bupgrade\b.+\b(to|version)\b/i,
  /\bfix\b.+\b(bug|issue|error|problem)\b.+\b(in|with|on)\b.+\b(file|code|module|function)\b/i,
  /\bconvert\b.+\b(to|from)\b/i,
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
  /\b(find|locate|search for|look for)\b.+\b(file|code|function|class|module|definition|implementation|pattern|codebase)\b/i,
  /\bwhere (is|are)\b.+\b(defined|located|implemented|used|referenced|called)\b/i,
  /\bwhich (file|module|package)\b.+\b(contains|has|defines|exports)\b/i,
  /\bexplore\b.+\b(codebase|code|project|structure|architecture)\b/i,
  /\bhow (is|are)\b.+\b(structured|organized|connected|wired|implemented)\b/i,
  /\bwhat (pattern|approach|library|framework)\b.+\b(use|using|used)\b/i,
  /\b(dependency|depend|import)\b.+\b(map|graph|tree|chain)\b/i,
  /\bgrep\b.+\b(for|across|through)\b/i,
  /\bscan\b.+\b(for|the|all)\b/i,
];

// Excluded: file-tree lookups, config/doc files, already-known paths
const SCOUT_NEGATIVE_PATTERNS = [
  /\b(list|ls|show)\b.+\b(files?|director(y|ies)|folder)\b/i,
  /\bread\b.+\b(package\.json|tsconfig\.json|\.md|README|CHANGELOG|\.env|\.gitignore|config)\b/i,
  /\b(what does|explain|describe)\b.+\b(error|message|output|result)\b/i,
  /\b(what is|tell me about|how does)\b.+\b(this|that|it)\b/i,
];

/**
 * Binary: does answering/proceeding require codebase knowledge the
 * main agent doesn't already have? Returns false for file-tree lookups,
 * config/doc files, general Q&A, and already-known paths.
 */
export function needsScout(ctx: TurnContext): boolean {
  if (ctx.agentHasCodebaseKnowledge) return false;

  const msg = ctx.userMessage;

  // Check negative (exclusion) patterns first
  for (const pattern of SCOUT_NEGATIVE_PATTERNS) {
    if (pattern.test(msg)) return false;
  }

  // Check positive patterns
  for (const pattern of SCOUT_POSITIVE_PATTERNS) {
    if (pattern.test(msg)) return true;
  }

  return false;
}

// ---- Combined evaluation ----

/**
 * Run all three hooks and return a combined result.
 * noPlanIntent is checked first; if true, implementIntent is not evaluated.
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
