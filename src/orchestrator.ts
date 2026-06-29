/**
 * orchestrator.ts — Event-driven pipeline orchestrator.
 *
 * Drives Scout → Plan → approval → concurrent Crafter dispatch → Gatekeeper →
 * fix loop without any single blocking call. Reacts to subagents:* lifecycle
 * events to advance a state machine through pipeline phases.
 *
 * Main Agent stays free to respond to side-questions and relay steering
 * messages throughout — no method holds a blocking promise.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentManager } from "./agent-manager.js";
import { parseChecklist, readPlan, writePlan, unblockedSteps, checkOffStep, archive } from "./plan-file.js";
import { Ledger } from "./ledger.js";
import type { AgentWidget } from "./ui/agent-widget.js";
import type { FleetList } from "./ui/fleet-list.js";

// ---- Types ----

export type PipelinePhase =
  | "idle"
  | "scout"
  | "plan"
  | "awaiting-approval"
  | "crafting"
  | "gatekeeping"
  | "complete";

export interface StepState {
  slug: string;
  description: string;
  agentId?: string;
  completed: boolean;
  failed: boolean;
  steered: boolean;
  files: string[];
  dispatched: boolean;
}

export interface PipelineTask {
  planPath: string;
  title: string;
  phase: PipelinePhase;
  approved: boolean;
  trustMode: boolean;
  stepStates: Map<string, StepState>;
  gatekeeperRounds: number;
  maxGatekeeperRounds: number;
  cwd: string;
  createdAt: number;
  completedAt?: number;
  /** Agent ID → slug mapping for in-flight agents. */
  agentToStep: Map<string, string>;
}

export interface OrchestratorDeps {
  pi: ExtensionAPI;
  manager: AgentManager;
  ledger: Ledger;
  widget: AgentWidget;
  fleet: FleetList;
  /** Lazy context getter — ctx varies per turn. */
  getCtx: () => ExtensionContext | undefined;
}

export interface StartPipelineConfig {
  task: string;
  title: string;
  content: string;
  needsScout: boolean;
  /** Optional path to an external plan/spec file (spec-driven dev path). */
  planPath?: string;
  cwd?: string;
}

export interface PipelineCompletionSummary {
  planPath: string;
  archivePath: string;
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  gatekeeperRounds: number;
  unresolvedIssues: string[];
}

// ---- Orchestrator ----

export class Orchestrator {
  private pi: ExtensionAPI;
  private manager: AgentManager;
  private ledger: Ledger;
  private widget: AgentWidget;
  private fleet: FleetList;
  private getCtx: () => ExtensionContext | undefined;

  private currentTask: PipelineTask | null = null;
  private listeners: Array<() => void> = [];
  private listenersRegistered = false;

  /** Agents dispatched by the orchestrator — used to filter events. */
  private pipelineAgentIds = new Set<string>();

  constructor(deps: OrchestratorDeps) {
    this.pi = deps.pi;
    this.manager = deps.manager;
    this.ledger = deps.ledger;
    this.widget = deps.widget;
    this.fleet = deps.fleet;
    this.getCtx = deps.getCtx;
  }

  // ========================================================================
  // Event Listener Infrastructure
  // ========================================================================

  /**
   * Register listeners for subagents lifecycle events.
   * Idempotent — safe to call multiple times.
   */
  private registerListeners(): void {
    if (this.listenersRegistered) return;
    this.listenersRegistered = true;

    const events = this.pi.events as unknown as {
      on(event: string, handler: (data: any) => void): () => void;
    };

    this.listeners.push(
      events.on("subagents:completed", (data) => this.onAgentCompleted(data)),
      events.on("subagents:failed", (data) => this.onAgentFailed(data)),
      events.on("subagents:started", (data) => this.onAgentStarted(data)),
      events.on("subagents:steered", (data) => this.onAgentSteered(data)),
    );
  }

  /**
   * Remove all event listeners and abort any active pipeline.
   * Safe to call multiple times.
   */
  dispose(): void {
    for (const unsub of this.listeners) {
      try { unsub(); } catch { /* ignore */ }
    }
    this.listeners = [];
    this.listenersRegistered = false;

    if (this.currentTask) {
      this.abort();
    }

    this.currentTask = null;
    this.pipelineAgentIds.clear();
  }

  // ========================================================================
  // Pipeline Control
  // ========================================================================

  /**
   * Whether a pipeline is currently active (any phase except idle/complete).
   */
  isActive(): boolean {
    return this.currentTask !== null && this.currentTask.phase !== "complete";
  }

  /** Whether the current pipeline task has an approved plan. */
  hasApprovedPlan(): boolean {
    return this.currentTask?.approved === true;
  }

  /**
   * Start the pipeline. Aborts any active pipeline first.
   *
   * Non-blocking: all agent dispatch uses `isBackground: true`.
   * Main Agent remains free to respond to unrelated turns throughout.
   */
  startPipeline(config: StartPipelineConfig): void {
    try {
      // Abort any existing pipeline
      if (this.currentTask) {
        this.abort();
      }

      // Register listeners on first call
      this.registerListeners();

      const cwd = config.cwd ?? process.cwd();

      // Write plan file if no external path provided
      let planPath: string;
      if (config.planPath) {
        planPath = config.planPath;
      } else {
        planPath = writePlan(config.task, config.title, config.content, cwd);
      }

      this.currentTask = {
        planPath,
        title: config.title,
        phase: "idle",
        approved: false,
        trustMode: false,
        stepStates: new Map(),
        gatekeeperRounds: 0,
        maxGatekeeperRounds: 3,
        cwd,
        createdAt: Date.now(),
        agentToStep: new Map(),
      };

      this.updateWidget();

      // Enter Scout or Plan phase
      if (config.needsScout) {
        this.dispatchScout();
      } else {
        this.dispatchPlan();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.pi.sendMessage({
        customType: "text",
        content: `Pipeline failed to start: ${msg}`,
        display: true,
      } as any);
      this.currentTask = null;
    }
  }

  /**
   * Abort the current pipeline: stop all in-flight agents,
   * release Ledger claims, reset state.
   */
  abort(): void {
    if (!this.currentTask) return;

    // Stop all pipeline agents
    for (const agentId of this.pipelineAgentIds) {
      this.manager.abort(agentId);
    }

    // Release all Ledger claims
    for (const agentId of this.pipelineAgentIds) {
      this.ledger.release(agentId);
    }

    this.pipelineAgentIds.clear();
    this.currentTask = null;
    this.updateWidget();
  }

  // ========================================================================
  // Scout Phase
  // ========================================================================

  private dispatchScout(): void {
    if (!this.currentTask) return;

    const ctx = this.getCtx();
    if (!ctx) {
      this.pi.sendMessage({
        customType: "text",
        content: "Pipeline: Cannot dispatch Scout — no active session context.",
        display: true,
      } as any);
      return;
    }

    this.currentTask.phase = "scout";
    this.updateWidget();

    const prompt = `Explore the codebase for: ${this.currentTask!.title}\n\nTask: ${this.currentTask!.planPath}\n\nFind relevant files, existing patterns, and integration points. Report file paths, dependencies, and architecture notes.`;

    const agentId = this.manager.spawn(
      this.pi as any,
      ctx as any,
      "Scout",
      prompt,
      {
        description: `Scout: ${this.currentTask.title}`,
        isBackground: true,
        cwd: this.currentTask.cwd,
      },
    );

    this.pipelineAgentIds.add(agentId);
  }

  // ========================================================================
  // Plan Phase
  // ========================================================================

  private dispatchPlan(scoutFindings?: string): void {
    if (!this.currentTask) return;

    const ctx = this.getCtx();
    if (!ctx) {
      this.pi.sendMessage({
        customType: "text",
        content: "Pipeline: Cannot dispatch Plan — no active session context.",
        display: true,
      } as any);
      return;
    }

    this.currentTask.phase = "plan";
    this.updateWidget();

    let prompt = `Create an implementation plan for: ${this.currentTask!.title}\n\nWrite the plan to docs/tasks/ using the standard format (goal, non-goals, approach, checklist with {#slug} identifiers and (depends on: slug) declarations).`;

    if (scoutFindings) {
      prompt += `\n\n## Scout Findings\n${scoutFindings.slice(0, 4000)}`;
    }

    const agentId = this.manager.spawn(
      this.pi as any,
      ctx as any,
      "Plan",
      prompt,
      {
        description: `Plan: ${this.currentTask.title}`,
        isBackground: true,
        cwd: this.currentTask.cwd,
      },
    );

    this.pipelineAgentIds.add(agentId);
  }

  private extractPlanPath(result: string): string | null {
    // Scan for docs/tasks/ path pattern
    const match = result.match(/(?:docs\/tasks\/[^\s\)]+?\.md)/);
    if (match) {
      const relativePath = match[1] || match[0];
      const fullPath = join(this.currentTask?.cwd ?? process.cwd(), relativePath);
      if (existsSync(fullPath)) return fullPath;
    }
    return null;
  }

  private findMostRecentPlan(cwd: string): string | null {
    const dir = join(cwd, "docs", "tasks");
    if (!existsSync(dir)) return null;

    let newest: { path: string; mtime: number } | null = null;
    try {
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".md")) continue;
        const fullPath = join(dir, file);
        const stat = statSync(fullPath);
        if (!newest || stat.mtimeMs > newest.mtime) {
          newest = { path: fullPath, mtime: stat.mtimeMs };
        }
      }
    } catch {
      return null;
    }
    return newest?.path ?? null;
  }

  // ========================================================================
  // Approval Phase
  // ========================================================================

  private presentApprovalUI(): void {
    if (!this.currentTask) return;

    this.currentTask.phase = "awaiting-approval";
    this.updateWidget();

    let planContent: string;
    try {
      planContent = readPlan(this.currentTask.planPath);
    } catch {
      planContent = "(unable to read plan file)";
    }

    // Truncate for display
    const preview = planContent.length > 2000
      ? planContent.slice(0, 2000) + "\n\n...(truncated, see full plan at " + this.currentTask.planPath + ")"
      : planContent;

    this.pi.sendMessage({
      customType: "text",
      content: `## Pipeline Plan: ${this.currentTask.title}\n\n${preview}\n\n---\nReply **approve** to proceed with implementation, or **reject** to cancel.`,
      display: true,
    } as any);
  }

  // ========================================================================
  // Crafter Phase
  // ========================================================================

  /**
   * Extract likely file paths from a step description.
   * Looks for backtick-quoted paths, src/..., test/..., and absolute paths.
   */
  private inferTargetFiles(description: string): string[] {
    const files: string[] = [];

    // Backtick-quoted paths: `src/foo.ts`
    const backtickRe = /`([^`]+?)`/g;
    let match: RegExpExecArray | null;
    while ((match = backtickRe.exec(description)) !== null) {
      const candidate = match[1].trim();
      if (/\.(ts|js|tsx|jsx|json|md|css|html|yaml|yml|toml)$/.test(candidate) ||
          candidate.includes("/") || candidate.includes("\\")) {
        // Strip trailing punctuation and backticks that may have been captured
        const clean = candidate.replace(/[.,;:!?'")\`]+$/, "");
        if (clean) files.push(clean);
      }
    }

    // src/... and test/... patterns (exclude backtick from captures)
    const pathRe = /\b((?:src|test|lib|app|dist|public|config|docs|scripts)\/[^\s,;)\\`]+)/gi;
    while ((match = pathRe.exec(description)) !== null) {
      files.push(match[1]);
    }

    return [...new Set(files)]; // dedupe
  }

  /**
   * Dispatch Crafters for all unblocked, non-conflicting steps.
   * Thread-safe: called from both start and completion paths.
   */
  private dispatchCrafters(): void {
    if (!this.currentTask || this.currentTask.phase === "gatekeeping") return;

    this.currentTask.phase = "crafting";

    const ctx = this.getCtx();
    if (!ctx) return;

    // Read plan content for step descriptions
    let planContent: string;
    try {
      planContent = readPlan(this.currentTask.planPath);
    } catch {
      return;
    }

    const steps = parseChecklist(planContent);

    // Build step description map
    const stepDescs = new Map<string, string>();
    for (const s of steps) {
      stepDescs.set(s.slug, s.description);
    }

    // Early exit: empty checklist
    if (steps.length === 0) {
      this.pi.sendMessage({
        customType: "text",
        content: `Pipeline: Plan "${this.currentTask.title}" has no implementation steps. Nothing to build.`,
        display: true,
      } as any);
      this.currentTask = null;
      return;
    }

    // Get unblocked step slugs
    const candidateSlugs = unblockedSteps(this.currentTask.planPath);

    // Initialize step states for any new slugs
    for (const slug of candidateSlugs) {
      if (!this.currentTask.stepStates.has(slug)) {
        this.currentTask.stepStates.set(slug, {
          slug,
          description: stepDescs.get(slug) ?? "",
          completed: false,
          failed: false,
          steered: false,
          files: [],
          dispatched: false,
        });
      }
    }

    // Check if all steps are already done (either in stepStates or checked in plan)
    const allSteps = steps.map(s => s.slug);
    const allDone = allSteps.every(slug => {
      const state = this.currentTask!.stepStates.get(slug);
      if (state?.completed || state?.failed) return true;
      // Also check the plan file directly
      const planStep = steps.find(s => s.slug === slug);
      return planStep?.checked === true;
    });

    if (allDone || (candidateSlugs.length === 0 && allSteps.length > 0)) {
      // Check if any Crafters still in flight
      const inFlight = [...this.currentTask.agentToStep.values()].some(
        agentId => this.pipelineAgentIds.has(agentId),
      );
      if (!inFlight) {
        this.dispatchGatekeeper();
      }
      return;
    }

    // Dispatch each unblocked, not-yet-dispatched, non-conflicting step
    for (const slug of candidateSlugs) {
      const state = this.currentTask.stepStates.get(slug);
      if (!state || state.dispatched || state.completed || state.failed) continue;

      const desc = stepDescs.get(slug) ?? "";
      const rawFiles = this.inferTargetFiles(desc);

      // Resolve relative paths against the task's cwd for Ledger matching
      const files = rawFiles.map(f => resolvePath(this.currentTask!.cwd, f));
      state.files = files;

      // Check Ledger for conflicts
      if (files.length > 0) {
        const conflicts = this.ledger.getConflictingFiles(files);
        if (conflicts.length > 0) {
          // Step waits — don't dispatch yet
          continue;
        }
      }

      // Step is clear to dispatch
      state.dispatched = true;

      const agentId = this.manager.spawn(
        this.pi as any,
        ctx as any,
        "Crafter",
        `Implement this step from the plan:\n\n**Step**: ${desc}\n**Plan**: ${this.currentTask.planPath}\n\nFollow existing patterns. Self-review before reporting done. Report: files changed, why, decisions, and anything to watch.`,
        {
          description: `Crafter: ${desc.slice(0, 60)}`,
          isBackground: true,
          isolation: "worktree",
          cwd: this.currentTask.cwd,
        },
      );

      state.agentId = agentId;
      this.currentTask.agentToStep.set(agentId, slug);
      this.pipelineAgentIds.add(agentId);

      // Register Ledger claim
      if (files.length > 0) {
        this.ledger.claim(agentId, files, "edit");
      }
    }

    this.updateWidget();
  }

  // ========================================================================
  // Gatekeeper Phase
  // ========================================================================

  private dispatchGatekeeper(): void {
    if (!this.currentTask) return;

    const ctx = this.getCtx();
    if (!ctx) return;

    this.currentTask.phase = "gatekeeping";
    this.updateWidget();

    const agentId = this.manager.spawn(
      this.pi as any,
      ctx as any,
      "Gatekeeper",
      `Review all changes against the plan at: ${this.currentTask.planPath}\n\nRun the test suite. Verify implementation matches plan. Classify findings as in-scope (auto-fix) or out-of-scope (ask user).`,
      {
        description: `Gatekeeper: ${this.currentTask.title}`,
        isBackground: true,
        cwd: this.currentTask.cwd,
      },
    );

    this.pipelineAgentIds.add(agentId);
  }

  /**
   * Parse Gatekeeper's structured output into in-scope / out-of-scope lists.
   */
  private parseGatekeeperFindings(result: string): { inScope: string[]; outOfScope: string[] } {
    const inScope: string[] = [];
    const outOfScope: string[] = [];

    // Try to find In-Scope section (matches "In-Scope", "In Scope", case-insensitive)
    const inScopeMatch = result.match(/####\s*In[ -]Scope[\s\S]*?(?=####\s*Out[ -].*Scope|$)/i);
    if (inScopeMatch) {
      const items = inScopeMatch[0].match(/^\d+\.\s+(.+)$/gm);
      if (items) {
        inScope.push(...items.map(i => i.replace(/^\d+\.\s+/, "").trim()).filter(Boolean));
      }
    }

    // Try Out-of-Scope section (matches "Out-of-Scope", "Out of Scope", etc.)
    const outScopeMatch = result.match(/####\s*Out[ -].*Scope[\s\S]*?(?=####|$)/i);
    if (outScopeMatch) {
      const items = outScopeMatch[0].match(/^\d+\.\s+(.+)$/gm);
      if (items) {
        outOfScope.push(...items.map(i => i.replace(/^\d+\.\s+/, "").trim()).filter(Boolean));
      }
    }

    return { inScope, outOfScope };
  }

  // ========================================================================
  // Completion & Archive
  // ========================================================================

  private archiveAndComplete(): void {
    if (!this.currentTask) return;

    const task = this.currentTask;
    const planPath = task.planPath;

    // Archive plan
    try {
      archive(planPath, task.cwd);
    } catch {
      // Continue even if archive fails
    }

    // Build summary
    let totalSteps = 0;
    let completedSteps = 0;
    let failedSteps = 0;
    for (const state of task.stepStates.values()) {
      totalSteps++;
      if (state.completed) completedSteps++;
      if (state.failed) failedSteps++;
    }

    task.completedAt = Date.now();
    task.phase = "complete";

    const summary = [
      `## Pipeline Complete: ${task.title}`,
      `**Plan**: ${planPath} (archived)`,
      `**Steps**: ${completedSteps}/${totalSteps} completed`,
      failedSteps > 0 ? `**Failed**: ${failedSteps} step(s) failed` : "",
      `**Gatekeeper rounds**: ${task.gatekeeperRounds}`,
      "",
      "### Steps",
      ...[...task.stepStates.entries()].map(([slug, s]) =>
        `- ${s.completed ? "✅" : s.failed ? "❌" : "⏭️"} ${slug}: ${s.description.slice(0, 80)}`,
      ),
    ].filter(Boolean).join("\n");

    this.pi.sendMessage({
      customType: "text",
      content: summary,
      display: true,
    } as any);

    this.currentTask = null;
    this.pipelineAgentIds.clear();
    this.updateWidget();
  }

  // ========================================================================
  // Event Handlers
  // ========================================================================

  private onAgentCompleted(data: any): void {
    if (!this.currentTask) return;

    // Only process events for agents WE dispatched
    if (!this.pipelineAgentIds.has(data.id)) return;

    const type = data.type as string;
    const task = this.currentTask;

    // ---- Scout completed ----
    if (type === "Scout" && task.phase === "scout") {
      const findings = data.result ?? "";
      this.pipelineAgentIds.delete(data.id);
      this.dispatchPlan(findings);
      return;
    }

    // ---- Plan completed ----
    if (type === "Plan" && task.phase === "plan") {
      this.pipelineAgentIds.delete(data.id);

      const planPath = this.extractPlanPath(data.result ?? "")
        ?? this.findMostRecentPlan(task.cwd);

      if (planPath && existsSync(planPath)) {
        task.planPath = planPath;
        this.presentApprovalUI();
      } else {
        // Retry Plan once
        if (!(task as any)._planRetried) {
          (task as any)._planRetried = true;
          this.dispatchPlan("Previous attempt failed to create a plan file. You MUST create the plan file at docs/tasks/ using the write tool.");
        } else {
          this.pi.sendMessage({
            customType: "text",
            content: `Pipeline: Plan agent failed to create a plan file for "${task.title}". Pipeline stopped.`,
            display: true,
          } as any);
          this.currentTask = null;
          this.pipelineAgentIds.clear();
        }
      }
      return;
    }

    // ---- Crafter completed ----
    if (type === "Crafter" && (task.phase === "crafting" || task.phase === "gatekeeping")) {
      this.pipelineAgentIds.delete(data.id);

      const slug = task.agentToStep.get(data.id);
      if (slug) {
        const state = task.stepStates.get(slug);
        if (state) {
          // Re-validate if steered
          if (state.steered) {
            try {
              const content = readPlan(task.planPath);
              const steps = parseChecklist(content);
              const step = steps.find(s => s.slug === slug);
              if (!step?.checked) {
                // Step wasn't actually completed — mark as failed
                state.failed = true;
                state.completed = false;
              } else {
                state.completed = true;
              }
            } catch {
              state.failed = true;
            }
          } else {
            state.completed = true;
          }

          // Check off step in plan file
          try {
            checkOffStep(task.planPath, slug);
          } catch { /* plan file I/O — non-critical */ }

          // Release Ledger claim
          this.ledger.release(data.id);
          task.agentToStep.delete(data.id);
        }
      }

      // If we're in a Gatekeeper fix loop, re-dispatch Gatekeeper
      if (task.phase === "gatekeeping") {
        this.dispatchGatekeeper();
        return;
      }

      // Otherwise, dispatch next Crafters
      this.dispatchCrafters();
      return;
    }

    // ---- Gatekeeper completed ----
    if (type === "Gatekeeper" && task.phase === "gatekeeping") {
      this.pipelineAgentIds.delete(data.id);

      const findings = this.parseGatekeeperFindings(data.result ?? "");

      // No issues → done
      if (findings.inScope.length === 0 && findings.outOfScope.length === 0) {
        this.archiveAndComplete();
        return;
      }

      // Out-of-scope issues → ask user
      if (findings.outOfScope.length > 0) {
        this.pi.sendMessage({
          customType: "text",
          content: `## Gatekeeper: Out-of-Scope Findings\n\n${findings.outOfScope.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n\nShould I fix these, or leave them?`,
          display: true,
        } as any);
      }

      // In-scope issues → fix loop
      if (findings.inScope.length > 0) {
        task.gatekeeperRounds++;

        if (task.gatekeeperRounds >= task.maxGatekeeperRounds) {
          // Max rounds exceeded
          this.pi.sendMessage({
            customType: "text",
            content: `## Gatekeeper: Max Rounds Exceeded\n\nAfter ${task.gatekeeperRounds} rounds, the following in-scope issues remain unresolved:\n\n${findings.inScope.map((f, i) => `${i + 1}. ${f}`).join("\n")}`,
            display: true,
          } as any);
          this.archiveAndComplete();
          return;
        }

        // Dispatch Crafter to fix in-scope issues
        const ctx = this.getCtx();
        if (ctx) {
          const agentId = this.manager.spawn(
            this.pi as any,
            ctx as any,
            "Crafter",
            `Fix the following in-scope Gatekeeper findings:\n\n${findings.inScope.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n\nPlan: ${task.planPath}`,
            {
              description: `Gatekeeper fix (round ${task.gatekeeperRounds})`,
              isBackground: true,
              isolation: "worktree",
              cwd: task.cwd,
            },
          );

          this.pipelineAgentIds.add(agentId);
        }
      } else if (findings.outOfScope.length > 0) {
        // Only out-of-scope, no in-scope → pause for user decision but don't archive yet
        // Keep pipeline in gatekeeping phase
      } else {
        this.archiveAndComplete();
      }
      return;
    }
  }

  private onAgentFailed(data: any): void {
    if (!this.currentTask) return;
    if (!this.pipelineAgentIds.has(data.id)) return;

    const type = data.type as string;
    const task = this.currentTask;

    this.pipelineAgentIds.delete(data.id);

    // ---- Scout failed ----
    if (type === "Scout" && task.phase === "scout") {
      this.pi.sendMessage({
        customType: "text",
        content: `Scout failed while exploring for "${task.title}". Proceeding without Scout findings.`,
        display: true,
      } as any);
      this.dispatchPlan();
      return;
    }

    // ---- Plan failed ----
    if (type === "Plan" && task.phase === "plan") {
      const error = data.error ?? "unknown";
      this.pi.sendMessage({
        customType: "text",
        content: `Pipeline: Plan agent failed for "${task.title}": ${error}. Pipeline stopped.`,
        display: true,
      } as any);
      this.currentTask = null;
      this.pipelineAgentIds.clear();
      return;
    }

    // ---- Crafter failed ----
    if (type === "Crafter") {
      this.ledger.release(data.id);

      const slug = task.agentToStep.get(data.id);
      if (slug) {
        const state = task.stepStates.get(slug);
        if (state) {
          state.failed = true;
          state.completed = false;
        }
        task.agentToStep.delete(data.id);
      }

      // Continue with remaining steps (if in crafting phase)
      if (task.phase === "crafting") {
        this.dispatchCrafters();
      } else if (task.phase === "gatekeeping") {
        // Fix-loop Crafter failed — re-dispatch Gatekeeper
        this.dispatchGatekeeper();
      }
      return;
    }

    // ---- Gatekeeper failed ----
    if (type === "Gatekeeper" && task.phase === "gatekeeping") {
      this.pi.sendMessage({
        customType: "text",
        content: `Gatekeeper review failed for "${task.title}". Pipeline stopped. Plan file left at ${task.planPath} for manual review.`,
        display: true,
      } as any);
      this.currentTask = null;
      this.pipelineAgentIds.clear();
      return;
    }
  }

  private onAgentStarted(_data: any): void {
    // Widget update only — no state transition needed
    if (this.currentTask) {
      this.updateWidget();
    }
  }

  private onAgentSteered(data: any): void {
    if (!this.currentTask) return;
    if (!this.pipelineAgentIds.has(data.id)) return;

    // Mark the steered agent's step as steered (stale state)
    const slug = this.currentTask.agentToStep.get(data.id);
    if (slug) {
      const state = this.currentTask.stepStates.get(slug);
      if (state) {
        state.steered = true;
      }
    }
  }

  // ========================================================================
  // Widget
  // ========================================================================

  /**
   * Update the pipeline progress widget via ctx.ui.setWidget.
   * Shows per-phase progress with 🟢🟡✅❌ indicators.
   */
  private updateWidget(): void {
    const ctx = this.getCtx();
    if (!ctx) return;

    const task = this.currentTask;
    if (!task) {
      try { (ctx.ui as any).setWidget?.("pipeline", undefined); } catch { /* ignore */ }
      return;
    }

    const rows: string[] = [];
    const phaseIcons: Record<PipelinePhase, string> = {
      idle: "⏳", scout: "🔍", plan: "📋",
      "awaiting-approval": "⏸️", crafting: "🔨", gatekeeping: "🛡️", complete: "✅",
    };

    const phaseIcon = phaseIcons[task.phase] ?? "❓";
    rows.push(`${phaseIcon} Pipeline: ${task.title} [${task.phase}]`);

    // Per-step status
    for (const [slug, state] of task.stepStates) {
      const icon = state.completed ? "✅" : state.failed ? "❌" : state.dispatched ? "🟢" : "🟡";
      const label = state.description.slice(0, 60);
      rows.push(`  ${icon} ${slug}: ${label}${state.steered ? " (steered)" : ""}`);
    }

    if (task.stepStates.size === 0) {
      rows.push("  (no steps yet)");
    }

    // Gatekeeper rounds
    if (task.phase === "gatekeeping" && task.gatekeeperRounds > 0) {
      rows.push(`  Gatekeeper round: ${task.gatekeeperRounds}/${task.maxGatekeeperRounds}`);
    }

    try {
      (ctx.ui as any).setWidget?.("pipeline", rows.join("\n"));
    } catch { /* ignore widget errors */ }
  }
}
