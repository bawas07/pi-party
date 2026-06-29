/**
 * planning-gate.ts — Structural gate: blocks write-capable Agent spawns
 * without an approved plan.
 *
 * The ONLY bypass: noPlanIntent = true (user explicitly said no plan needed).
 * Read-only agents (Scout, Plan, Gatekeeper) are never blocked.
 */

import { getToolNamesForType } from "./agent-types.js";

// ---- Types ----

export interface PlanningGateInput {
  /** Resolved agent type name. */
  subagentType: string;
  /** Does an approved plan exist for this task? */
  hasApprovedPlan: boolean;
  /** Did the user explicitly say no plan needed? */
  noPlanIntent: boolean;
}

export interface PlanningGateResult {
  allowed: boolean;
  /** Rejection reason (only set when allowed is false). */
  message?: string;
}

// ----

/**
 * Check whether a given agent type has write or edit capability.
 * Uses the existing getToolNamesForType() from agent-types.ts
 * which handles user overrides and defaults.
 */
export function isWriteCapable(typeName: string): boolean {
  const tools = getToolNamesForType(typeName);
  return tools.includes("write") || tools.includes("edit");
}

/**
 * Check the planning gate.
 *
 * Logic:
 *   1. noPlanIntent → allowed (user explicitly said skip planning)
 *   2. Not write-capable → allowed (read-only agents don't need a plan)
 *   3. hasApprovedPlan → allowed
 *   4. Otherwise → rejected
 */
export function checkPlanningGate(input: PlanningGateInput): PlanningGateResult {
  // Bypass: user explicitly said no plan needed
  if (input.noPlanIntent) {
    return { allowed: true };
  }

  // Read-only agents are always allowed
  if (!isWriteCapable(input.subagentType)) {
    return { allowed: true };
  }

  // Write-capable with approved plan
  if (input.hasApprovedPlan) {
    return { allowed: true };
  }

  // Write-capable without approved plan → rejected
  return {
    allowed: false,
    message:
      `No approved plan exists for this task. The "${input.subagentType}" agent has write/edit capability and requires an approved plan before spawning. ` +
      "Run Plan first to create one, or explicitly tell me to skip planning (e.g., \"no need to plan, just implement it directly\").",
  };
}
