/**
 * plan-file.ts — Plan file CRUD + dependency parsing + external spec translation.
 *
 * Plan files live at docs/tasks/ and use the format:
 *   ## Checklist
 *   - [ ] Step description {#slug}
 *   - [ ] Step with deps (depends on: slug-a, slug-b) {#another-slug}
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

// ---- Types ----

export interface ParsedStep {
  slug: string;
  description: string;  // text before {#slug}, trimmed
  checked: boolean;
  rawDeps: string;      // e.g. "slug-a, slug-b"
  depSlugs: string[];   // parsed: ["slug-a", "slug-b"]
  lineNumber: number;   // 1-indexed line in the file
}

// ---- Paths ----

const TASKS_DIR = "docs/tasks";
const ARCHIVE_DIR = join(TASKS_DIR, "archived");

function resolveTasksDir(cwd?: string): string {
  return resolve(cwd ?? process.cwd(), TASKS_DIR);
}

function resolveArchiveDir(cwd?: string): string {
  return resolve(cwd ?? process.cwd(), ARCHIVE_DIR);
}

// ---- Helpers ----

function ensureDirs(cwd?: string): void {
  const base = resolveTasksDir(cwd);
  const archive = resolveArchiveDir(cwd);
  if (!existsSync(base)) mkdirSync(base, { recursive: true });
  if (!existsSync(archive)) mkdirSync(archive, { recursive: true });
}

/** Slugify a title for use in filenames. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** ISO date string for filenames. */
function isoDate(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

// ---- Public API ----

/**
 * Write a new plan file and return its absolute path.
 * Creates docs/tasks/ and docs/tasks/archived/ on demand.
 */
export function writePlan(task: string, title: string, content: string, cwd?: string): string {
  ensureDirs(cwd);
  const filename = `${isoDate()}-${slugify(title)}.md`;
  const filePath = join(resolveTasksDir(cwd), filename);

  const template = `# ${title}

**Created**: ${new Date().toISOString()}
**Status**: in-progress

${content}
`;

  writeFileSync(filePath, template, "utf-8");
  return filePath;
}

/** Read a plan file and return its contents as a UTF-8 string. */
export function readPlan(path: string): string {
  return readFileSync(path, "utf-8");
}

/**
 * Check off a step identified by {#slug}.
 * Finds the line containing {#slug}, replaces the first [ ] before the slug with [x].
 * Idempotent — already-checked steps are a no-op.
 * No-op if the slug is not found.
 */
export function checkOffStep(path: string, slug: string): void {
  const content = readFileSync(path, "utf-8");
  const lines = content.split("\n");
  let changed = false;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(`{#${slug}}`)) {
      // Replace the first unchecked checkbox before the slug
      const slugIdx = lines[i].indexOf(`{#${slug}}`);
      const before = lines[i].slice(0, slugIdx);
      const after = lines[i].slice(slugIdx);
      const newBefore = before.replace(/\[ \]/, "[x]");
      if (newBefore !== before) {
        lines[i] = newBefore + after;
        changed = true;
      }
      break;
    }
  }

  if (changed) {
    writeFileSync(path, lines.join("\n"), "utf-8");
  }
}

/**
 * Find an existing plan by task description.
 * Scans docs/tasks/ (excluding archived/) for .md files whose # Title heading
 * matches the task string (case-insensitive substring).
 * Returns the absolute path of the first match, or null.
 */
export function findExisting(task: string, cwd?: string): string | null {
  const dir = resolveTasksDir(cwd);
  if (!existsSync(dir)) return null;

  const query = task.toLowerCase();
  const files = readdirSync(dir).filter(f => f.endsWith(".md"));

  for (const file of files) {
    try {
      const content = readFileSync(join(dir, file), "utf-8");
      const titleMatch = content.match(/^#\s+(.+)$/m);
      if (titleMatch && titleMatch[1].toLowerCase().includes(query)) {
        return join(dir, file);
      }
    } catch {
      // Skip unreadable files
    }
  }

  return null;
}

/** Move a plan file to the archive directory. */
export function archive(path: string, cwd?: string): void {
  ensureDirs(cwd);
  const archiveDir = resolveArchiveDir(cwd);
  const dest = join(archiveDir, basename(path));
  renameSync(path, dest);
}

/**
 * Parse checklist steps from plan content.
 * Extracts each - [ ] / - [x] line from the ## Checklist section.
 */
export function parseChecklist(content: string): ParsedStep[] {
  const steps: ParsedStep[] = [];

  // Find the Checklist section
  const checklistMatch = content.match(/^## Checklist\s*$/m);
  if (!checklistMatch) return steps;

  const startIdx = checklistMatch.index! + checklistMatch[0].length;
  const rest = content.slice(startIdx);

  // Find the next ## heading (end of checklist section)
  const nextHeading = rest.match(/^##\s/m);
  const sectionText = nextHeading ? rest.slice(0, nextHeading.index) : rest;

  const lines = sectionText.split("\n");
  let lineNumber = (content.slice(0, startIdx).split("\n").length) + 1;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    lineNumber++;

    // Match "- [ ] ..." or "- [x] ..."
    const match = line.match(/^-\s+\[([ x])\]\s+(.+)$/);
    if (!match) continue;

    const checked = match[1] === "x";
    const restOfLine = match[2];

    // Extract slug: {#slug-name}
    const slugMatch = restOfLine.match(/\{#([^}]+)\}/);
    const slug = slugMatch ? slugMatch[1] : "";

    // Extract description: everything before {#slug}, trimmed
    let description = slugMatch ? restOfLine.slice(0, slugMatch.index!).trim() : restOfLine.trim();

    // Extract dependencies: (depends on: slug, slug)
    const depsMatch = description.match(/\(depends on:\s*([^)]+)\)/);
    const rawDeps = depsMatch ? depsMatch[1].trim() : "";
    const depSlugs = rawDeps ? rawDeps.split(/\s*,\s*/).filter(Boolean) : [];

    // Remove the dependency clause from the description
    if (depsMatch) {
      description = description.replace(depsMatch[0], "").trim();
    }

    steps.push({ slug, description, checked, rawDeps, depSlugs, lineNumber });
  }

  return steps;
}

/**
 * Return slugs of unchecked steps whose dependency slugs are all checked off.
 * Steps with no dependencies are always unblocked (unless already checked).
 * Unknown dependency slugs are treated as satisfied (don't block on typos).
 */
export function unblockedSteps(path: string): string[] {
  const content = readFileSync(path, "utf-8");
  const steps = parseChecklist(content);

  const checkedSlugs = new Set(steps.filter(s => s.checked).map(s => s.slug));

  return steps
    .filter(s => !s.checked) // only unchecked
    .filter(s => {
      if (s.depSlugs.length === 0) return true; // no deps = always unblocked
      // All dependency slugs must be checked off
      return s.depSlugs.every(dep => {
        // Unknown slugs don't block
        const depStep = steps.find(ss => ss.slug === dep);
        if (!depStep) return true;
        return depStep.checked;
      });
    })
    .map(s => s.slug);
}

/**
 * Translate an external spec/plan file into internal checklist format.
 * Reads the file, extracts work items from recognizable structures, and
 * returns a string in internal checklist format. Does NOT write any files.
 */
export function translateExternalSpec(externalPath: string): string {
  const content = readFileSync(externalPath, "utf-8");
  const lines = content.split("\n");
  const items: { description: string; deps: string[] }[] = [];

  let inTaskSection = false;
  let currentHeading = "";

  for (const line of lines) {
    const trimmed = line.trim();

    // Track headings
    const headingMatch = trimmed.match(/^#{1,3}\s+(.+)$/);
    if (headingMatch) {
      currentHeading = headingMatch[1].toLowerCase();
      // Detect task-related sections
      inTaskSection = /task|checklist|step|implementation|todo/i.test(currentHeading);
      continue;
    }

    if (!inTaskSection) continue;

    // Match checklist items: - [ ] or numbered: 1. or bullet: -
    const checklistMatch = trimmed.match(/^-\s+\[[ x]\]\s+(.+)$/);
    const numberedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    const bulletMatch = trimmed.match(/^-\s+(.+)$/);

    let desc = "";
    if (checklistMatch) {
      desc = checklistMatch[1];
    } else if (numberedMatch) {
      desc = numberedMatch[1];
    } else if (bulletMatch && !bulletMatch[1].startsWith("[")) {
      desc = bulletMatch[1];
    }

    if (desc) {
      // Extract inline dependencies
      const depsMatch = desc.match(/\(depends on:\s*([^)]+)\)/);
      const deps = depsMatch ? depsMatch[1].split(/\s*,\s*/).filter(Boolean) : [];
      const cleanDesc = depsMatch ? desc.replace(depsMatch[0], "").trim() : desc;

      items.push({ description: cleanDesc, deps });
    }
  }

  if (items.length === 0) {
    // Fallback: treat each ## heading as a task item
    for (const line of lines) {
      const hm = line.trim().match(/^##\s+(.+)$/);
      if (hm && !/task|checklist|step|implementation|todo/i.test(hm[1])) {
        items.push({ description: hm[1], deps: [] });
      }
    }
  }

  // Build checklist output
  const checklistLines = items.map((item, i) => {
    const slug = slugify(item.description).slice(0, 30) || `step-${i + 1}`;
    const depClause = item.deps.length > 0 ? ` (depends on: ${item.deps.join(", ")})` : "";
    return `- [ ] ${item.description}${depClause} {#${slug}}`;
  });

  return `## Checklist\n${checklistLines.join("\n")}\n`;
}
