import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  archive,
  checkOffStep,
  findExisting,
  parseChecklist,
  readPlan,
  translateExternalSpec,
  unblockedSteps,
  writePlan,
  type ParsedStep,
} from "../src/plan-file.js";

const TEST_DIR = join(tmpdir(), "pi-party-plan-file-test-" + Date.now());
const CWD = TEST_DIR;

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  // Create parent docs/tasks since the module creates relative to cwd
  mkdirSync(join(TEST_DIR, "docs", "tasks"), { recursive: true });
  mkdirSync(join(TEST_DIR, "docs", "tasks", "archived"), { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("writePlan + readPlan", () => {
  it("writePlan creates a file and returns its path (task 2.12)", () => {
    const path = writePlan("test", "JWT Auth", "## Goal\nAdd JWT auth\n\n## Checklist\n- [ ] First step {#first}", CWD);
    expect(existsSync(path)).toBe(true);
    expect(path).toContain("docs/tasks/");
    expect(path).toContain("jwt-auth");
    expect(path.endsWith(".md")).toBe(true);
  });

  it("readPlan returns file contents (task 2.12)", () => {
    const path = writePlan("test", "JWT Auth", "## Goal\nAdd JWT auth\n\n## Checklist\n- [ ] First step {#first}", CWD);
    const content = readPlan(path);
    expect(content).toContain("# JWT Auth");
    expect(content).toContain("## Goal");
    expect(content).toContain("## Checklist");
    expect(content).toContain("{#first}");
  });
});

describe("checkOffStep", () => {
  it("marks correct step as checked (task 2.13)", () => {
    const path = writePlan("test", "Test", "## Checklist\n- [ ] Step one {#step-one}\n- [ ] Step two {#step-two}", CWD);
    checkOffStep(path, "step-one");
    const content = readPlan(path);
    expect(content).toContain("- [x] Step one {#step-one}");
    expect(content).toContain("- [ ] Step two {#step-two}");
  });

  it("is idempotent on already-checked step (task 2.13)", () => {
    const path = writePlan("test", "Test", "## Checklist\n- [x] Step one {#step-one}", CWD);
    checkOffStep(path, "step-one");
    const content = readPlan(path);
    expect(content).toContain("- [x] Step one {#step-one}");
  });

  it("no-op when slug not found", () => {
    const path = writePlan("test", "Test", "## Checklist\n- [ ] Step one {#step-one}", CWD);
    const before = readPlan(path);
    checkOffStep(path, "nonexistent");
    const after = readPlan(path);
    expect(after).toBe(before);
  });
});

describe("unblockedSteps", () => {
  it("all steps unblocked when no dependencies (task 2.14)", () => {
    const path = writePlan("test", "Test", "## Checklist\n- [ ] A {#a}\n- [ ] B {#b}\n- [ ] C {#c}", CWD);
    const steps = unblockedSteps(path);
    expect(steps).toEqual(["a", "b", "c"]);
  });

  it("blocked by unsatisfied dependency (task 2.14)", () => {
    const path = writePlan("test", "Test", "## Checklist\n- [ ] A {#a}\n- [ ] B (depends on: a) {#b}", CWD);
    const steps = unblockedSteps(path);
    expect(steps).toEqual(["a"]); // only A is unblocked
  });

  it("unblocked when dependency is checked off (task 2.14)", () => {
    const path = writePlan("test", "Test", "## Checklist\n- [ ] A {#a}\n- [ ] B (depends on: a) {#b}", CWD);
    checkOffStep(path, "a");
    const steps = unblockedSteps(path);
    expect(steps).toEqual(["b"]);
  });

  it("unknown dependency slugs do not block (task 2.14)", () => {
    const path = writePlan("test", "Test", "## Checklist\n- [ ] A {#a}\n- [ ] B (depends on: unknown-slug) {#b}", CWD);
    const steps = unblockedSteps(path);
    expect(steps).toContain("b"); // unknown deps don't block
  });

  it("already-checked steps excluded (task 2.14)", () => {
    const path = writePlan("test", "Test", "## Checklist\n- [x] A {#a}\n- [x] B {#b}", CWD);
    const steps = unblockedSteps(path);
    expect(steps).toEqual([]);
  });

  it("chain of dependencies resolves correctly", () => {
    const content = "## Checklist\n- [ ] A {#a}\n- [ ] B (depends on: a) {#b}\n- [ ] C (depends on: b) {#c}";
    const path = writePlan("test", "Test", content, CWD);
    // Only A is unblocked initially
    expect(unblockedSteps(path)).toEqual(["a"]);
    // Check off A → B becomes unblocked
    checkOffStep(path, "a");
    expect(unblockedSteps(path)).toEqual(["b"]);
  });
});

describe("findExisting", () => {
  it("matches by title substring (task 2.15)", () => {
    writePlan("test", "JWT Authentication", "## Checklist\n- [ ] step {#s}", CWD);
    const found = findExisting("jwt auth", CWD);
    expect(found).toBeTruthy();
    expect(found!).toContain("jwt-authentication");
  });

  it("returns null on miss (task 2.15)", () => {
    writePlan("test", "JWT Authentication", "## Checklist\n- [ ] step {#s}", CWD);
    const found = findExisting("oauth setup", CWD);
    expect(found).toBeNull();
  });

  it("returns null when no plans exist", () => {
    const found = findExisting("anything", CWD);
    expect(found).toBeNull();
  });
});

describe("archive", () => {
  it("moves file to archive directory (task 2.16)", () => {
    const path = writePlan("test", "Test Plan", "## Checklist\n- [ ] step {#s}", CWD);
    expect(existsSync(path)).toBe(true);
    archive(path, CWD);
    expect(existsSync(path)).toBe(false);
    // File should now be in archived/
    const archivedPath = join(CWD, "docs", "tasks", "archived", path.split("/").pop()!);
    expect(existsSync(archivedPath)).toBe(true);
  });
});

describe("parseChecklist", () => {
  it("extracts slugs and checked status", () => {
    const content = "## Checklist\n- [ ] Do thing {#do-thing}\n- [x] Done thing {#done-thing}";
    const steps = parseChecklist(content);
    expect(steps).toHaveLength(2);
    expect(steps[0].slug).toBe("do-thing");
    expect(steps[0].checked).toBe(false);
    expect(steps[1].slug).toBe("done-thing");
    expect(steps[1].checked).toBe(true);
  });

  it("parses dependencies (task 2.17)", () => {
    const content = "## Checklist\n- [ ] Wire routes (depends on: auth, validation) {#wire-routes}";
    const steps = parseChecklist(content);
    expect(steps[0].depSlugs).toEqual(["auth", "validation"]);
  });

  it("handles empty checklist (task 2.17)", () => {
    const content = "## Checklist\n\n## Next Section";
    const steps = parseChecklist(content);
    expect(steps).toEqual([]);
  });

  it("handles steps without slugs (task 2.17)", () => {
    const content = "## Checklist\n- [ ] Step without slug";
    const steps = parseChecklist(content);
    expect(steps).toHaveLength(1);
    expect(steps[0].slug).toBe("");
  });

  it("handles duplicate slugs (task 2.17)", () => {
    const content = "## Checklist\n- [ ] First {#same}\n- [ ] Second {#same}";
    const steps = parseChecklist(content);
    expect(steps).toHaveLength(2);
    expect(steps[0].slug).toBe("same");
    expect(steps[1].slug).toBe("same");
  });

  it("stops at next ## heading", () => {
    const content = "## Checklist\n- [ ] Step {#step}\n\n## Another Section\n- [ ] Not a step";
    const steps = parseChecklist(content);
    expect(steps).toHaveLength(1);
  });
});

describe("translateExternalSpec", () => {
  it("extracts work items from checklist format (task 2.18)", () => {
    const specPath = join(TEST_DIR, "spec.md");
    writeFileSync(specPath, `# Auth Spec\n\n## Tasks\n\n- [ ] Create middleware\n- [ ] Add validation\n- [ ] Wire routes\n`, "utf-8");
    const result = translateExternalSpec(specPath);
    expect(result).toContain("## Checklist");
    expect(result).toContain("Create middleware");
    expect(result).toContain("Add validation");
    expect(result).toContain("Wire routes");
  });

  it("extracts from numbered list", () => {
    const specPath = join(TEST_DIR, "spec.md");
    writeFileSync(specPath, `# Steps\n\n## Implementation\n\n1. Set up project\n2. Add database\n3. Create API`, "utf-8");
    const result = translateExternalSpec(specPath);
    expect(result).toContain("Set up project");
    expect(result).toContain("Add database");
    expect(result).toContain("Create API");
  });
});
