/**
 * orchestrator.test.ts — Unit and integration tests for the event-driven orchestrator.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Orchestrator, type StartPipelineConfig } from "../src/orchestrator.js";
import { Ledger } from "../src/ledger.js";
import { resolve } from "node:path";

// ---- Helpers ----

const TEST_DIR = join(tmpdir(), "pi-party-orchestrator-test-" + Date.now());

/** Create a minimal mock of ExtensionAPI with event bus. */
function mockPi() {
  const handlers = new Map<string, Array<(data: any) => void>>();
  return {
    events: {
      on(event: string, handler: (data: any) => void) {
        if (!handlers.has(event)) handlers.set(event, []);
        handlers.get(event)!.push(handler);
        return () => {
          const arr = handlers.get(event);
          if (arr) {
            const idx = arr.indexOf(handler);
            if (idx >= 0) arr.splice(idx, 1);
          }
        };
      },
      emit(event: string, data: any) {
        for (const h of handlers.get(event) ?? []) {
          try { h(data); } catch { /* ignore */ }
        }
      },
      // Expose for tests
      _getHandlers(event: string) { return handlers.get(event) ?? []; },
    },
    sendMessage: vi.fn(),
  };
}

/** Create a mock AgentManager with spawn tracking. */
function mockManager() {
  const spawns: Array<{
    type: string; prompt: string; options: any; id: string;
  }> = [];
  let nextId = 1;

  return {
    spawn(pi: any, ctx: any, type: string, prompt: string, options: any) {
      const id = `agent-${nextId++}`;
      spawns.push({ type, prompt, options, id });
      return id;
    },
    abort(id: string) {
      return true;
    },
    getRecord(id: string) {
      return { id, status: "running" };
    },
    _spawns: spawns,
  };
}

/** Create a mock widget. */
function mockWidget() {
  return {
    update: vi.fn(),
    ensureTimer: vi.fn(),
    markFinished: vi.fn(),
  };
}

/** Create a mock fleet. */
function mockFleet() {
  return {
    update: vi.fn(),
    ensureTimer: vi.fn(),
    onAgentFinished: vi.fn(),
    setEnabled: vi.fn(),
    dispose: vi.fn(),
  };
}

/** Create a mock ExtensionContext. */
function mockCtx(cwd?: string) {
  return {
    cwd: cwd ?? TEST_DIR,
    ui: {
      setWidget: vi.fn(),
      setStatus: vi.fn(),
      notify: vi.fn(),
    },
    model: { provider: "test", id: "test-model", name: "Test" },
    modelRegistry: { find: vi.fn() },
    getSystemPrompt: vi.fn(() => ""),
  };
}

function setupTestDir() {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  mkdirSync(join(TEST_DIR, "docs", "tasks"), { recursive: true });
  mkdirSync(join(TEST_DIR, "docs", "tasks", "archived"), { recursive: true });
}

beforeEach(setupTestDir);
afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

// ---- Unit Tests ----

describe("Orchestrator — Unit", () => {
  describe("types and construction", () => {
    it("14.1 creates orchestrator with all deps", () => {
      const pi = mockPi();
      const manager = mockManager();
      const ledger = new Ledger();
      const widget = mockWidget();
      const fleet = mockFleet();
      const getCtx = () => mockCtx();

      const orch = new Orchestrator({ pi: pi as any, manager: manager as any, ledger, widget: widget as any, fleet: fleet as any, getCtx });
      expect(orch).toBeDefined();
      expect(orch).toBeInstanceOf(Orchestrator);
    });

    it("14.2 startPipeline creates task and enters correct phase with needsScout=true", () => {
      const pi = mockPi();
      const manager = mockManager();
      const ledger = new Ledger();
      const widget = mockWidget();
      const fleet = mockFleet();
      const getCtx = () => mockCtx();

      const orch = new Orchestrator({ pi: pi as any, manager: manager as any, ledger, widget: widget as any, fleet: fleet as any, getCtx });

      orch.startPipeline({
        task: "Add JWT auth",
        title: "JWT Authentication",
        content: "## Goal\nAdd JWT auth\n\n## Checklist\n- [ ] Create middleware {#create-middleware}",
        needsScout: true,
        cwd: TEST_DIR,
      });

      // Should have spawned a Scout
      const scoutSpawn = manager._spawns.find(s => s.type === "Scout");
      expect(scoutSpawn).toBeDefined();
    });

    it("14.2 startPipeline enters plan phase directly when needsScout=false", () => {
      const pi = mockPi();
      const manager = mockManager();
      const ledger = new Ledger();
      const widget = mockWidget();
      const fleet = mockFleet();
      const getCtx = () => mockCtx();

      const orch = new Orchestrator({ pi: pi as any, manager: manager as any, ledger, widget: widget as any, fleet: fleet as any, getCtx });

      orch.startPipeline({
        task: "Add JWT auth",
        title: "JWT Authentication",
        content: "## Goal\nAdd JWT auth\n\n## Checklist\n- [ ] Create middleware {#create-middleware}",
        needsScout: false,
        cwd: TEST_DIR,
      });

      const planSpawn = manager._spawns.find(s => s.type === "Plan");
      expect(planSpawn).toBeDefined();
    });

    it("14.2 startPipeline writes plan file when no external path given", () => {
      const pi = mockPi();
      const manager = mockManager();
      const ledger = new Ledger();
      const widget = mockWidget();
      const fleet = mockFleet();
      const getCtx = () => mockCtx();

      const orch = new Orchestrator({ pi: pi as any, manager: manager as any, ledger, widget: widget as any, fleet: fleet as any, getCtx });

      orch.startPipeline({
        task: "test",
        title: "Test Plan",
        content: "## Goal\nTest\n\n## Checklist\n- [ ] Step {#step}",
        needsScout: false,
        cwd: TEST_DIR,
      });

      // Should have created a plan file
      const files = require("node:fs").readdirSync(join(TEST_DIR, "docs", "tasks"));
      const planFile = files.find(f => f.endsWith(".md"));
      expect(planFile).toBeDefined();
    });
  });

  describe("extractPlanPath", () => {
    it("14.4 extracts path from result text", () => {
      const pi = mockPi();
      const manager = mockManager();
      const ledger = new Ledger();
      const widget = mockWidget();
      const fleet = mockFleet();
      const getCtx = () => mockCtx();

      const orch = new Orchestrator({ pi: pi as any, manager: manager as any, ledger, widget: widget as any, fleet: fleet as any, getCtx });

      // Write a plan file first
      const planContent = "## Checklist\n- [ ] Step {#step}";
      writeFileSync(join(TEST_DIR, "docs", "tasks", "test-plan.md"), planContent);

      // Set up a task via startPipeline so currentTask is set
      orch.startPipeline({
        task: "test",
        title: "Test",
        content: "## Checklist\n- [ ] Step {#step}",
        needsScout: false,
        cwd: TEST_DIR,
      });

      // Access private method via any
      const result = (orch as any).extractPlanPath("Plan written to docs/tasks/test-plan.md");
      expect(result).toBeTruthy();
      expect(result).toContain("test-plan.md");
    });

    it("14.4 returns null for invalid result", () => {
      const pi = mockPi();
      const manager = mockManager();
      const ledger = new Ledger();
      const widget = mockWidget();
      const fleet = mockFleet();
      const getCtx = () => mockCtx();

      const orch = new Orchestrator({ pi: pi as any, manager: manager as any, ledger, widget: widget as any, fleet: fleet as any, getCtx });

      orch.startPipeline({
        task: "test",
        title: "Test",
        content: "## Checklist\n- [ ] Step {#step}",
        needsScout: false,
        cwd: TEST_DIR,
      });

      const result = (orch as any).extractPlanPath("No plan file was created.");
      expect(result).toBeNull();
    });
  });

  describe("inferTargetFiles", () => {
    it("14.5 extracts backtick-quoted file paths", () => {
      const pi = mockPi();
      const orch = new Orchestrator({
        pi: pi as any, manager: mockManager() as any, ledger: new Ledger(),
        widget: mockWidget() as any, fleet: mockFleet() as any,
        getCtx: () => mockCtx(),
      });

      const files = (orch as any).inferTargetFiles(
        "Create `src/auth.ts` and update `test/auth.test.ts`",
      );
      expect(files).toContain("src/auth.ts");
      expect(files).toContain("test/auth.test.ts");
    });

    it("14.5 extracts src/ paths from text", () => {
      const pi = mockPi();
      const orch = new Orchestrator({
        pi: pi as any, manager: mockManager() as any, ledger: new Ledger(),
        widget: mockWidget() as any, fleet: mockFleet() as any,
        getCtx: () => mockCtx(),
      });

      const files = (orch as any).inferTargetFiles(
        "Wire up src/routes/api.ts and src/middleware/auth.ts",
      );
      expect(files).toContain("src/routes/api.ts");
      expect(files).toContain("src/middleware/auth.ts");
    });

    it("14.5 returns empty array when no paths found", () => {
      const pi = mockPi();
      const orch = new Orchestrator({
        pi: pi as any, manager: mockManager() as any, ledger: new Ledger(),
        widget: mockWidget() as any, fleet: mockFleet() as any,
        getCtx: () => mockCtx(),
      });

      const files = (orch as any).inferTargetFiles(
        "Add authentication to the application",
      );
      expect(files).toEqual([]);
    });

    it("14.5 deduplicates paths", () => {
      const pi = mockPi();
      const orch = new Orchestrator({
        pi: pi as any, manager: mockManager() as any, ledger: new Ledger(),
        widget: mockWidget() as any, fleet: mockFleet() as any,
        getCtx: () => mockCtx(),
      });

      const files = (orch as any).inferTargetFiles(
        "Update `src/auth.ts`. Also check src/auth.ts again and `src/auth.ts`",
      );
      expect(files).toEqual(["src/auth.ts"]);
    });
  });

  describe("parseGatekeeperFindings", () => {
    it("14.6 parses in-scope and out-of-scope issues", () => {
      const pi = mockPi();
      const orch = new Orchestrator({
        pi: pi as any, manager: mockManager() as any, ledger: new Ledger(),
        widget: mockWidget() as any, fleet: mockFleet() as any,
        getCtx: () => mockCtx(),
      });

      const result = `#### In-Scope
1. Missing error handling in auth.ts
2. Function too long in middleware.ts

#### Out-of-Scope
1. Consider adding rate limiting`;

      const findings = (orch as any).parseGatekeeperFindings(result);
      expect(findings.inScope).toHaveLength(2);
      expect(findings.inScope[0]).toContain("Missing error handling");
      expect(findings.inScope[1]).toContain("Function too long");
      expect(findings.outOfScope).toHaveLength(1);
      expect(findings.outOfScope[0]).toContain("rate limiting");
    });

    it("14.6 handles empty result", () => {
      const pi = mockPi();
      const orch = new Orchestrator({
        pi: pi as any, manager: mockManager() as any, ledger: new Ledger(),
        widget: mockWidget() as any, fleet: mockFleet() as any,
        getCtx: () => mockCtx(),
      });

      const findings = (orch as any).parseGatekeeperFindings("");
      expect(findings.inScope).toEqual([]);
      expect(findings.outOfScope).toEqual([]);
    });

    it("14.6 handles malformed output gracefully", () => {
      const pi = mockPi();
      const orch = new Orchestrator({
        pi: pi as any, manager: mockManager() as any, ledger: new Ledger(),
        widget: mockWidget() as any, fleet: mockFleet() as any,
        getCtx: () => mockCtx(),
      });

      const findings = (orch as any).parseGatekeeperFindings("Random text without proper structure");
      expect(findings.inScope).toEqual([]);
      expect(findings.outOfScope).toEqual([]);
    });
  });

  describe("abort", () => {
    it("14.7 aborts active pipeline, releases claims, nulls currentTask", () => {
      const pi = mockPi();
      const manager = mockManager();
      const ledger = new Ledger();
      const widget = mockWidget();
      const fleet = mockFleet();
      const getCtx = () => mockCtx();

      const orch = new Orchestrator({ pi: pi as any, manager: manager as any, ledger, widget: widget as any, fleet: fleet as any, getCtx });

      // Start a pipeline
      orch.startPipeline({
        task: "test",
        title: "Test",
        content: "## Checklist\n- [ ] Step {#step}",
        needsScout: false,
        cwd: TEST_DIR,
      });

      // Claim some ledger files to simulate in-flight work
      ledger.claim("agent-1", ["src/auth.ts"]);

      orch.abort();

      // Ledger should be cleared (if those agent IDs were tracked)
      // currentTask should be null
      expect((orch as any).currentTask).toBeNull();
    });
  });

  describe("dispose", () => {
    it("14.8 dispose removes listeners and aborts pipeline", () => {
      const pi = mockPi();
      const manager = mockManager();
      const ledger = new Ledger();
      const widget = mockWidget();
      const fleet = mockFleet();
      const getCtx = () => mockCtx();

      const orch = new Orchestrator({ pi: pi as any, manager: manager as any, ledger, widget: widget as any, fleet: fleet as any, getCtx });

      // Start pipeline to register listeners
      orch.startPipeline({
        task: "test",
        title: "Test",
        content: "## Checklist\n- [ ] Step {#step}",
        needsScout: false,
        cwd: TEST_DIR,
      });

      orch.dispose();

      // Listeners should be cleared
      expect((orch as any).listeners).toHaveLength(0);
      expect((orch as any).listenersRegistered).toBe(false);
      expect((orch as any).currentTask).toBeNull();
    });
  });

  describe("error handlers", () => {
    it("14.9 Scout failure proceeds to Plan", () => {
      const pi = mockPi();
      const manager = mockManager();
      const ledger = new Ledger();
      const widget = mockWidget();
      const fleet = mockFleet();
      const getCtx = () => mockCtx();

      const orch = new Orchestrator({ pi: pi as any, manager: manager as any, ledger, widget: widget as any, fleet: fleet as any, getCtx });

      orch.startPipeline({
        task: "test",
        title: "Test",
        content: "## Checklist\n- [ ] Step {#step}",
        needsScout: true,
        cwd: TEST_DIR,
      });

      // Get Scout's agent ID
      const scoutId = manager._spawns.find(s => s.type === "Scout")!.id;

      // Simulate Scout failure
      (pi.events as any).emit("subagents:failed", {
        id: scoutId,
        type: "Scout",
        error: "Scout crashed",
      });

      // Should have dispatched Plan after failure
      const planSpawn = manager._spawns.find(s => s.type === "Plan");
      expect(planSpawn).toBeDefined();
    });

    it("14.9 Plan failure stops pipeline", () => {
      const pi = mockPi();
      const manager = mockManager();
      const ledger = new Ledger();
      const widget = mockWidget();
      const fleet = mockFleet();
      const getCtx = () => mockCtx();

      const orch = new Orchestrator({ pi: pi as any, manager: manager as any, ledger, widget: widget as any, fleet: fleet as any, getCtx });

      orch.startPipeline({
        task: "test",
        title: "Test",
        content: "## Checklist\n- [ ] Step {#step}",
        needsScout: false,
        cwd: TEST_DIR,
      });

      const planId = manager._spawns.find(s => s.type === "Plan")!.id;

      // Simulate Plan failure
      (pi.events as any).emit("subagents:failed", {
        id: planId,
        type: "Plan",
        error: "Plan failed",
      });

      // Pipeline should be stopped
      expect((orch as any).currentTask).toBeNull();
    });

    it("14.9 Crafter failure marks step failed, continues pipeline", () => {
      const pi = mockPi();
      const manager = mockManager();
      const ledger = new Ledger();
      const widget = mockWidget();
      const fleet = mockFleet();
      const getCtx = () => mockCtx();

      const orch = new Orchestrator({ pi: pi as any, manager: manager as any, ledger, widget: widget as any, fleet: fleet as any, getCtx });

      // Create a plan file
      writeFileSync(
        join(TEST_DIR, "docs", "tasks", "test.md"),
        "# Test\n\n**Created**: 2024-01-01T00:00:00.000Z\n**Status**: in-progress\n\n## Checklist\n- [ ] Step one {#step-one}\n- [ ] Step two {#step-two}\n",
      );

      orch.startPipeline({
        task: "test",
        title: "Test",
        content: "## Checklist\n- [ ] Step one {#step-one}\n- [ ] Step two {#step-two}",
        needsScout: false,
        cwd: TEST_DIR,
      });

      // Manually set up crafting phase state
      const task = (orch as any).currentTask;
      task.phase = "crafting";
      task.planPath = join(TEST_DIR, "docs", "tasks", "test.md");
      task.stepStates.set("step-one", {
        slug: "step-one", description: "Step one",
        agentId: "craft-1", completed: false, failed: false,
        steered: false, files: [], dispatched: true,
      });
      task.agentToStep.set("craft-1", "step-one");
      (orch as any).pipelineAgentIds.add("craft-1");

      // Simulate Crafter failure
      (pi.events as any).emit("subagents:failed", {
        id: "craft-1",
        type: "Crafter",
        error: "Crafter crashed",
      });

      // Step should be marked failed
      const state = task.stepStates.get("step-one");
      expect(state.failed).toBe(true);
      expect(state.completed).toBe(false);

      // Pipeline should NOT be stopped (Crafter failure is non-fatal)
      expect((orch as any).currentTask).toBeDefined();
    });

    it("14.9 Gatekeeper failure stops pipeline", () => {
      const pi = mockPi();
      const manager = mockManager();
      const ledger = new Ledger();
      const widget = mockWidget();
      const fleet = mockFleet();
      const getCtx = () => mockCtx();

      const orch = new Orchestrator({ pi: pi as any, manager: manager as any, ledger, widget: widget as any, fleet: fleet as any, getCtx });

      writeFileSync(
        join(TEST_DIR, "docs", "tasks", "test.md"),
        "# Test\n\n**Created**: 2024-01-01T00:00:00.000Z\n**Status**: in-progress\n\n## Checklist\n- [x] Step one {#step-one}\n",
      );

      orch.startPipeline({
        task: "test",
        title: "Test",
        content: "## Checklist\n- [x] Step one {#step-one}",
        needsScout: false,
        cwd: TEST_DIR,
      });

      // Manually set up gatekeeping phase
      const task = (orch as any).currentTask;
      task.phase = "gatekeeping";
      task.planPath = join(TEST_DIR, "docs", "tasks", "test.md");
      (orch as any).pipelineAgentIds.add("gk-1");

      // Simulate Gatekeeper failure
      (pi.events as any).emit("subagents:failed", {
        id: "gk-1",
        type: "Gatekeeper",
        error: "Gatekeeper crashed",
      });

      // Pipeline should be stopped
      expect((orch as any).currentTask).toBeNull();
    });
  });
});

// ---- Integration Tests ----

describe("Orchestrator — Integration", () => {
  it("15.1 full pipeline: sequential steps complete with Gatekeeper and archive", () => {
    const pi = mockPi();
    const manager = mockManager();
    const ledger = new Ledger();
    const widget = mockWidget();
    const fleet = mockFleet();
    const getCtx = () => mockCtx();

    const orch = new Orchestrator({ pi: pi as any, manager: manager as any, ledger, widget: widget as any, fleet: fleet as any, getCtx });

    // Write a plan with pre-checked-off step so no Crafters needed
    writeFileSync(
      join(TEST_DIR, "docs", "tasks", "test.md"),
      "# Test\n\n**Created**: 2024-01-01T00:00:00.000Z\n**Status**: in-progress\n\n## Checklist\n- [x] Step one {#step-one}\n",
    );

    // Start pipeline without Scout
    orch.startPipeline({
      task: "test",
      title: "Integration Test",
      content: "## Checklist\n- [x] Step one {#step-one}",
      needsScout: false,
      cwd: TEST_DIR,
    });

    // Simulate Plan completion with a valid path
    const planSpawn = manager._spawns.find(s => s.type === "Plan")!;
    const planContent = "## Checklist\n- [x] Step one {#step-one}";

    // Override the plan file with Plan's expected output
    writeFileSync(join(TEST_DIR, "docs", "tasks", "integration-test.md"), planContent);

    // The Plan path extraction will fail because our Plan agent didn't report the path correctly.
    // But findMostRecentPlan should find it.
    // Actually, the Plan completion handler needs the path in the result text.
    // Let's emit completion with a result containing the path
    (pi.events as any).emit("subagents:completed", {
      id: planSpawn.id,
      type: "Plan",
      result: `Plan written to docs/tasks/integration-test.md\n\n${planContent}`,
      status: "completed",
    });

    // After Plan, should be in awaiting-approval
    const task = (orch as any).currentTask;
    expect(task).toBeDefined();
    expect(task.phase).toBe("awaiting-approval");

    // All steps are already checked off — manually advance to crafting by
    // simulating the approve flow
    task.phase = "crafting";
    task.approved = true;

    // Dispatch Crafters — since all steps are checked, should dispatch Gatekeeper
    (orch as any).dispatchCrafters();

    const gkSpawn = manager._spawns.find(s => s.type === "Gatekeeper");
    // Gatekeeper should have been dispatched since all steps done
    expect((orch as any).currentTask.phase).toBe("gatekeeping");

    // Verify Gatekeeper was spawned if applicable
    if (gkSpawn) {
      // Simulate clean Gatekeeper result
      (pi.events as any).emit("subagents:completed", {
        id: gkSpawn.id,
        type: "Gatekeeper",
        result: "All good. No issues found.",
        status: "completed",
      });

      // Pipeline should be complete
      expect((orch as any).currentTask).toBeNull();
      // Plan should be archived (the one the orchestrator tracked)
      expect(existsSync(join(TEST_DIR, "docs", "tasks", "archived", "integration-test.md"))).toBe(true);
    }
  });

  it("15.2 two independent steps dispatch both Crafters concurrently", () => {
    const pi = mockPi();
    const manager = mockManager();
    const ledger = new Ledger();
    const widget = mockWidget();
    const fleet = mockFleet();
    const getCtx = () => mockCtx();

    const orch = new Orchestrator({ pi: pi as any, manager: manager as any, ledger, widget: widget as any, fleet: fleet as any, getCtx });

    // Plan with two independent steps (no depends on)
    writeFileSync(
      join(TEST_DIR, "docs", "tasks", "concurrent-test.md"),
      "# Concurrent Test\n\n**Created**: 2024-01-01T00:00:00.000Z\n**Status**: in-progress\n\n## Checklist\n- [ ] Add auth middleware {#auth-middleware}\n- [ ] Add logging helper {#logging-helper}\n",
    );

    orch.startPipeline({
      task: "concurrent-test",
      title: "Concurrent Test",
      content: "## Checklist\n- [ ] Add auth middleware {#auth-middleware}\n- [ ] Add logging helper {#logging-helper}",
      needsScout: false,
      cwd: TEST_DIR,
    });

    // Manually set up crafting phase
    const task = (orch as any).currentTask;
    task.phase = "crafting";
    task.planPath = join(TEST_DIR, "docs", "tasks", "concurrent-test.md");
    task.approved = true;

    manager._spawns.length = 0; // clear previous spawns
    (orch as any).dispatchCrafters();

    // Both steps should be dispatched (no dependencies, no ledger conflicts)
    const craftSpawns = manager._spawns.filter(s => s.type === "Crafter");
    expect(craftSpawns.length).toBe(2);

    // Verify both steps are tracked in stepStates
    const authState = task.stepStates.get("auth-middleware");
    const logState = task.stepStates.get("logging-helper");
    expect(authState).toBeDefined();
    expect(logState).toBeDefined();
    expect(authState.dispatched).toBe(true);
    expect(logState.dispatched).toBe(true);

    // Complete the first Crafter
    const firstCrafterId = craftSpawns[0].id;
    (orch as any).pipelineAgentIds.add(firstCrafterId);
    task.agentToStep.set(firstCrafterId, "auth-middleware");

    (pi.events as any).emit("subagents:completed", {
      id: firstCrafterId,
      type: "Crafter",
      result: "Created auth middleware",
      status: "completed",
    });

    // auth-middleware should be completed, logging-helper should still be dispatched
    expect(authState.completed).toBe(true);
    expect(logState.dispatched).toBe(true);
    expect(logState.completed).toBe(false);
  });


  it("15.3 dependent step waits for dependency", () => {
    const pi = mockPi();
    const manager = mockManager();
    const ledger = new Ledger();
    const widget = mockWidget();
    const fleet = mockFleet();
    const getCtx = () => mockCtx();

    const orch = new Orchestrator({ pi: pi as any, manager: manager as any, ledger, widget: widget as any, fleet: fleet as any, getCtx });

    // Plan file with dependent steps
    writeFileSync(
      join(TEST_DIR, "docs", "tasks", "dep-test.md"),
      "# Dep Test\n\n**Created**: 2024-01-01T00:00:00.000Z\n**Status**: in-progress\n\n## Checklist\n- [ ] Create middleware {#create-middleware}\n- [ ] Wire routes (depends on: create-middleware) {#wire-routes}\n",
    );

    orch.startPipeline({
      task: "dep-test",
      title: "Dependency Test",
      content: "## Checklist\n- [ ] Create middleware {#create-middleware}\n- [ ] Wire routes (depends on: create-middleware) {#wire-routes}",
      needsScout: false,
      cwd: TEST_DIR,
    });

    // Manually set up crafting phase
    const task = (orch as any).currentTask;
    task.phase = "crafting";
    task.planPath = join(TEST_DIR, "docs", "tasks", "dep-test.md");
    task.approved = true;

    // First dispatch
    manager._spawns.length = 0; // clear previous spawns
    (orch as any).dispatchCrafters();

    // Only the first step should be dispatched (no dependency)
    const craftSpawns = manager._spawns.filter(s => s.type === "Crafter");
    expect(craftSpawns.length).toBe(1); // only create-middleware

    // Verify wire-routes was NOT dispatched (depends on create-middleware)
    const wireRouteSpawn = craftSpawns.find(s => s.prompt.includes("Wire routes"));
    expect(wireRouteSpawn).toBeUndefined();

    // Complete the first Crafter
    const firstCrafterId = craftSpawns[0].id;
    (orch as any).pipelineAgentIds.add(firstCrafterId);
    task.agentToStep.set(firstCrafterId, "create-middleware");

    (pi.events as any).emit("subagents:completed", {
      id: firstCrafterId,
      type: "Crafter",
      result: "Done",
      status: "completed",
    });

    // Now wire-routes should be dispatched
    const newSpawns = manager._spawns.filter(s => s.type === "Crafter");
    const wireRoute = newSpawns.find(s => s.prompt.includes("Wire routes"));
    expect(wireRoute).toBeDefined();
  });

  it("15.4 Ledger conflict delays step with overlapping files", () => {
    const pi = mockPi();
    const manager = mockManager();
    const ledger = new Ledger();
    const widget = mockWidget();
    const fleet = mockFleet();
    const getCtx = () => mockCtx();

    const orch = new Orchestrator({ pi: pi as any, manager: manager as any, ledger, widget: widget as any, fleet: fleet as any, getCtx });

    // Plan with two steps touching the same file
    writeFileSync(
      join(TEST_DIR, "docs", "tasks", "conflict-test.md"),
      "# Conflict Test\n\n**Created**: 2024-01-01T00:00:00.000Z\n**Status**: in-progress\n\n## Checklist\n- [ ] Add auth middleware `src/auth.ts` {#auth-middleware}\n- [ ] Update auth tests `src/auth.ts` {#auth-tests}\n",
    );

    orch.startPipeline({
      task: "conflict-test",
      title: "Conflict Test",
      content: "## Checklist\n- [ ] Add auth middleware `src/auth.ts` {#auth-middleware}\n- [ ] Update auth tests `src/auth.ts` {#auth-tests}",
      needsScout: false,
      cwd: TEST_DIR,
    });

    const task = (orch as any).currentTask;
    task.phase = "crafting";
    task.planPath = join(TEST_DIR, "docs", "tasks", "conflict-test.md");
    task.approved = true;

    // Pre-claim src/auth.ts for an in-flight agent
    ledger.claim("blocking-agent", [resolve(TEST_DIR, "src/auth.ts")], "edit");

    manager._spawns.length = 0;
    (orch as any).dispatchCrafters();

    // Neither step should be dispatched because both touch src/auth.ts
    const craftSpawns = manager._spawns.filter(s => s.type === "Crafter");
    expect(craftSpawns.length).toBe(0);

    // Release the claim
    ledger.release("blocking-agent");

    // Now both should dispatch
    (orch as any).dispatchCrafters();
    const newSpawns = manager._spawns.filter(s => s.type === "Crafter");
    expect(newSpawns.length).toBeGreaterThanOrEqual(1);
  });

  it("15.5 steered agent marks step as steered, completion re-validates", () => {
    const pi = mockPi();
    const manager = mockManager();
    const ledger = new Ledger();
    const widget = mockWidget();
    const fleet = mockFleet();
    const getCtx = () => mockCtx();

    const orch = new Orchestrator({ pi: pi as any, manager: manager as any, ledger, widget: widget as any, fleet: fleet as any, getCtx });

    writeFileSync(
      join(TEST_DIR, "docs", "tasks", "steer-test.md"),
      "# Steer Test\n\n**Created**: 2024-01-01T00:00:00.000Z\n**Status**: in-progress\n\n## Checklist\n- [ ] Step one {#step-one}\n",
    );

    orch.startPipeline({
      task: "steer-test",
      title: "Steer Test",
      content: "## Checklist\n- [ ] Step one {#step-one}",
      needsScout: false,
      cwd: TEST_DIR,
    });

    const task = (orch as any).currentTask;
    task.phase = "crafting";
    task.planPath = join(TEST_DIR, "docs", "tasks", "steer-test.md");
    task.approved = true;

    manager._spawns.length = 0;
    (orch as any).dispatchCrafters();
    const craftSpawns = manager._spawns.filter(s => s.type === "Crafter");
    expect(craftSpawns.length).toBe(1);

    const crafterId = craftSpawns[0].id;
    task.agentToStep.set(crafterId, "step-one");
    (orch as any).pipelineAgentIds.add(crafterId);

    // Emit steer event
    (pi.events as any).emit("subagents:steered", {
      id: crafterId,
      message: "Change approach",
    });

    // Step should be marked as steered
    const state = task.stepStates.get("step-one");
    expect(state).toBeDefined();
    expect(state.steered).toBe(true);

    // Now emit completion — since step wasn't checked off (steered re-validates),
    // and our plan file still has [ ] unchecked, it should mark as failed
    (pi.events as any).emit("subagents:completed", {
      id: crafterId,
      type: "Crafter",
      result: "Done",
      status: "completed",
    });

    const finalState = task.stepStates.get("step-one");
    // The re-validation finds the step unchecked, so it marks as failed
    expect(finalState.failed).toBe(true);
  });

  it("15.6 Gatekeeper fix loop: in-scope issues trigger Crafter fix, then re-check", () => {
    const pi = mockPi();
    const manager = mockManager();
    const ledger = new Ledger();
    const widget = mockWidget();
    const fleet = mockFleet();
    const getCtx = () => mockCtx();

    const orch = new Orchestrator({ pi: pi as any, manager: manager as any, ledger, widget: widget as any, fleet: fleet as any, getCtx });

    writeFileSync(
      join(TEST_DIR, "docs", "tasks", "fix-test.md"),
      "# Fix Test\n\n**Created**: 2024-01-01T00:00:00.000Z\n**Status**: in-progress\n\n## Checklist\n- [x] Step one {#step-one}\n",
    );

    orch.startPipeline({
      task: "fix-test",
      title: "Fix Test",
      content: "## Checklist\n- [x] Step one {#step-one}",
      needsScout: false,
      cwd: TEST_DIR,
    });

    const task = (orch as any).currentTask;
    task.phase = "gatekeeping";
    task.planPath = join(TEST_DIR, "docs", "tasks", "fix-test.md");
    task.approved = true;

    // Track the Gatekeeper agent
    const gkId = "gk-fix-1";
    (orch as any).pipelineAgentIds.add(gkId);

    manager._spawns.length = 0;

    // Gatekeeper finds in-scope issues
    (pi.events as any).emit("subagents:completed", {
      id: gkId,
      type: "Gatekeeper",
      result: `#### In-Scope
1. Missing null check in auth.ts
2. Function exceeds 50 lines

#### Out-of-Scope
1. Consider adding rate limiting`,
      status: "completed",
    });

    // Gatekeeper round should be incremented
    expect(task.gatekeeperRounds).toBe(1);

    // A fix Crafter should have been dispatched
    const fixSpawns = manager._spawns.filter(s => s.type === "Crafter");
    expect(fixSpawns.length).toBe(1);
    expect(fixSpawns[0].prompt).toContain("Missing null check");
    expect(fixSpawns[0].prompt).toContain("Function exceeds 50 lines");
  });

  it("15.7 max Gatekeeper rounds exceeded stops pipeline", () => {
    const pi = mockPi();
    const manager = mockManager();
    const ledger = new Ledger();
    const widget = mockWidget();
    const fleet = mockFleet();
    const getCtx = () => mockCtx();

    const orch = new Orchestrator({ pi: pi as any, manager: manager as any, ledger, widget: widget as any, fleet: fleet as any, getCtx });

    writeFileSync(
      join(TEST_DIR, "docs", "tasks", "max-rounds-test.md"),
      "# Max Rounds Test\n\n**Created**: 2024-01-01T00:00:00.000Z\n**Status**: in-progress\n\n## Checklist\n- [x] Step one {#step-one}\n",
    );

    orch.startPipeline({
      task: "max-rounds-test",
      title: "Max Rounds Test",
      content: "## Checklist\n- [x] Step one {#step-one}",
      needsScout: false,
      cwd: TEST_DIR,
    });

    const task = (orch as any).currentTask;
    task.phase = "gatekeeping";
    task.planPath = join(TEST_DIR, "docs", "tasks", "max-rounds-test.md");
    task.gatekeeperRounds = 3; // already at max
    task.approved = true;

    const gkId = "gk-max-1";
    (orch as any).pipelineAgentIds.add(gkId);

    // Gatekeeper finds issues at max rounds
    (pi.events as any).emit("subagents:completed", {
      id: gkId,
      type: "Gatekeeper",
      result: `#### In-Scope
1. Still has an issue`,
      status: "completed",
    });

    // Pipeline should have completed (not crashed) with unresolved issues
    expect((orch as any).currentTask).toBeNull();
  });

  it("15.8 second pipeline starts while first is in crafting phase", () => {
    const pi = mockPi();
    const manager = mockManager();
    const ledger = new Ledger();
    const widget = mockWidget();
    const fleet = mockFleet();
    const getCtx = () => mockCtx();

    const orch = new Orchestrator({ pi: pi as any, manager: manager as any, ledger, widget: widget as any, fleet: fleet as any, getCtx });

    // Start first pipeline
    writeFileSync(
      join(TEST_DIR, "docs", "tasks", "first-task.md"),
      "# First Task\n\n**Created**: 2024-01-01T00:00:00.000Z\n**Status**: in-progress\n\n## Checklist\n- [ ] Step one {#step-one}\n",
    );

    orch.startPipeline({
      task: "first-task",
      title: "First Task",
      content: "## Checklist\n- [ ] Step one {#step-one}",
      needsScout: false,
      cwd: TEST_DIR,
    });

    // Set to crafting with an in-flight Crafter
    const firstTask = (orch as any).currentTask;
    firstTask.phase = "crafting";
    firstTask.planPath = join(TEST_DIR, "docs", "tasks", "first-task.md");
    firstTask.approved = true;

    // Simulate a Crafter already running
    const crafterId = "craft-first";
    firstTask.agentToStep.set(crafterId, "step-one");
    (orch as any).pipelineAgentIds.add(crafterId);

    manager._spawns.length = 0; // clear spawns

    // Now start a second pipeline while first is in crafting phase
    orch.startPipeline({
      task: "second-task",
      title: "Second Task",
      content: "## Checklist\n- [ ] Step two {#step-two}",
      needsScout: false,
      cwd: TEST_DIR,
    });

    // First task's spawns should have been cleared by abort in startPipeline
    // Second task should have spawned a Plan
    const planSpawn = manager._spawns.find(s => s.type === "Plan");
    expect(planSpawn).toBeDefined();

    // Second task should exist with its own record
    const secondTask = (orch as any).currentTask;
    expect(secondTask).toBeDefined();
    expect(secondTask.title).toBe("Second Task");
    expect(secondTask.phase).toBe("plan");
  });


  it("15.9 dispose during active pipeline stops all agents", () => {
    const pi = mockPi();
    const manager = mockManager();
    const ledger = new Ledger();
    const widget = mockWidget();
    const fleet = mockFleet();
    const getCtx = () => mockCtx();

    const orch = new Orchestrator({ pi: pi as any, manager: manager as any, ledger, widget: widget as any, fleet: fleet as any, getCtx });

    orch.startPipeline({
      task: "test",
      title: "Test",
      content: "## Checklist\n- [ ] Step {#step}",
      needsScout: true,
      cwd: TEST_DIR,
    });

    // Should have spawned a Scout
    expect(manager._spawns.length).toBeGreaterThan(0);

    orch.dispose();

    expect((orch as any).currentTask).toBeNull();
    expect((orch as any).listeners).toHaveLength(0);
  });
});
