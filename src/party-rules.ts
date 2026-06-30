/**
 * party-rules.ts — Party rules config for model assignment.
 *
 * party.rules.json stores user-configured model assignments for fast, general,
 * and thinking agent preferences. Two locations:
 *   - Global:  ~/.pi/agent/party.rules.json — applies to all projects
 *   - Local:   <cwd>/.pi/party.rules.json   — overrides global for this project
 *
 * Local overrides global on a per-key basis. If neither file exists, the config
 * is empty and selectModel() will instruct the user to run /party-rules.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface PartyRules {
  /** Model for fast/cheap agents (e.g. Scout). Format: "provider/modelId". */
  fast?: string;
  /** Model for general-purpose agents. Format: "provider/modelId". */
  general?: string;
  /** Model for thinking/reasoning agents (e.g. Plan, Gatekeeper). Format: "provider/modelId". */
  thinking?: string;
}

/** Which scope to save/load from. */
export type PartyRulesScope = "local" | "global";

function globalPath(): string {
  return join(getAgentDir(), "party.rules.json");
}

function localPath(cwd: string): string {
  return join(cwd, ".pi", "party.rules.json");
}

/** Get the filesystem path for a given scope. */
export function partyRulesPath(scope: PartyRulesScope, cwd: string = process.cwd()): string {
  return scope === "global" ? globalPath() : localPath(cwd);
}

function readRulesFile(path: string): PartyRules {
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: PartyRules = {};
    if (typeof raw.fast === "string" && raw.fast.includes("/")) out.fast = raw.fast;
    if (typeof raw.general === "string" && raw.general.includes("/")) out.general = raw.general;
    if (typeof raw.thinking === "string" && raw.thinking.includes("/")) out.thinking = raw.thinking;
    return out;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[pi-party] Ignoring malformed party rules at ${path}: ${reason}`);
    return {};
  }
}

/**
 * Load merged party rules. Global provides defaults, local overrides per-key.
 * Returns empty object if neither file exists.
 */
export function loadPartyRules(cwd: string = process.cwd()): PartyRules {
  const global = readRulesFile(globalPath());
  const local = readRulesFile(localPath(cwd));
  return { ...global, ...local };
}

/**
 * Save party rules to the specified scope. Creates parent directories if needed.
 * Returns true on success, false if the write failed.
 */
export function savePartyRules(
  rules: PartyRules,
  scope: PartyRulesScope,
  cwd: string = process.cwd(),
): boolean {
  const path = partyRulesPath(scope, cwd);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(rules, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a party rules file exists at the given scope.
 */
export function partyRulesExists(scope: PartyRulesScope, cwd: string = process.cwd()): boolean {
  return existsSync(partyRulesPath(scope, cwd));
}

/**
 * Build a human-readable description of where rules are loaded from.
 */
export function describePartyRulesSources(cwd: string = process.cwd()): string {
  const globalExists = existsSync(globalPath());
  const localExists = existsSync(localPath(cwd));
  const parts: string[] = [];
  if (globalExists) parts.push(`global (${globalPath()})`);
  if (localExists) parts.push(`local (${localPath(cwd)})`);
  if (parts.length === 0) return "No party.rules.json found (global or local). Run /party-rules to create one.";
  return `Loaded from: ${parts.join(", ")}`;
}
