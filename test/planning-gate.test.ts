import { beforeEach, describe, expect, it } from "vitest";
import { registerAgents } from "../src/agent-types.js";
import { checkPlanningGate, isWriteCapable } from "../src/planning-gate.js";

// The planning gate depends on agent-types.ts registry being initialized.
// Register the default agents before tests.
beforeEach(() => {
  // Register default agents (they include Scout, Plan, Crafter, Gatekeeper, general-purpose)
  registerAgents(new Map());
});

describe("isWriteCapable", () => {
  it("Crafter is write-capable (task 4.5)", () => {
    expect(isWriteCapable("Crafter")).toBe(true);
  });

  it("Scout is not write-capable (task 4.7)", () => {
    expect(isWriteCapable("Scout")).toBe(false);
  });

  it("Gatekeeper is not write-capable (task 4.8)", () => {
    expect(isWriteCapable("Gatekeeper")).toBe(false);
  });

  it("general-purpose is write-capable (task 4.9)", () => {
    expect(isWriteCapable("general-purpose")).toBe(true);
  });

  it("Plan is not write-capable", () => {
    expect(isWriteCapable("Plan")).toBe(false);
  });
});

describe("checkPlanningGate", () => {
  it("Crafter without plan → rejected (task 4.5)", () => {
    const result = checkPlanningGate({
      subagentType: "Crafter",
      hasApprovedPlan: false,
      noPlanIntent: false,
    });
    expect(result.allowed).toBe(false);
    expect(result.message).toContain("No approved plan exists");
  });

  it("Crafter with approved plan → allowed (task 4.6)", () => {
    const result = checkPlanningGate({
      subagentType: "Crafter",
      hasApprovedPlan: true,
      noPlanIntent: false,
    });
    expect(result.allowed).toBe(true);
  });

  it("Scout without plan → allowed (task 4.7)", () => {
    const result = checkPlanningGate({
      subagentType: "Scout",
      hasApprovedPlan: false,
      noPlanIntent: false,
    });
    expect(result.allowed).toBe(true);
  });

  it("Gatekeeper without plan → allowed (task 4.8)", () => {
    const result = checkPlanningGate({
      subagentType: "Gatekeeper",
      hasApprovedPlan: false,
      noPlanIntent: false,
    });
    expect(result.allowed).toBe(true);
  });

  it("general-purpose without plan → rejected (task 4.9)", () => {
    const result = checkPlanningGate({
      subagentType: "general-purpose",
      hasApprovedPlan: false,
      noPlanIntent: false,
    });
    expect(result.allowed).toBe(false);
  });

  it("noPlanIntent bypasses gate for write-capable (task 4.10)", () => {
    const result = checkPlanningGate({
      subagentType: "Crafter",
      hasApprovedPlan: false,
      noPlanIntent: true,
    });
    expect(result.allowed).toBe(true);
  });

  it("noPlanIntent bypass for read-only is still allowed (no-op)", () => {
    const result = checkPlanningGate({
      subagentType: "Scout",
      hasApprovedPlan: false,
      noPlanIntent: true,
    });
    expect(result.allowed).toBe(true);
  });
});
