import type { Workspace } from "../workspace/workspace.js";
import { expandImportClosure } from "./escalation.js";

/**
 * Deterministic relevance scoring for the context compiler.
 * Prefer package entrypoints, changed files, keyword hits, and import neighborhoods.
 */
export function rankRelevantFiles(
  workspace: Workspace,
  options: {
    keywords: string[];
    priorityPaths?: string[];
    changedPaths?: string[];
    maxFiles?: number;
  },
): string[] {
  const maxFiles = options.maxFiles ?? 12;
  const files = workspace.listFiles(".", { maxEntries: 500 });
  const codeFiles = files.filter((f) =>
    /\.(ts|tsx|js|jsx|mjs|cjs|json|md)$/i.test(f),
  );

  const entryBoost = new Set(detectEntryPoints(workspace, codeFiles));
  const changed = new Set(options.changedPaths ?? []);
  const priority = new Set(options.priorityPaths ?? []);

  const scored = codeFiles.map((path) => {
    const base = path.toLowerCase();
    let score = 0;
    if (priority.has(path)) score += 80;
    if (changed.has(path)) score += 40;
    if (entryBoost.has(path)) score += 25;
    for (const kw of options.keywords) {
      if (base.includes(kw)) score += 5;
    }
    if (/\.(test|spec)\./i.test(path)) score += 3;
    if (path.endsWith("package.json")) score += 4;
    if (path === "README.md" || path === "AGENTS.md") score += 2;
    // Prefer src/ over deep node tooling noise
    if (path.startsWith("src/")) score += 2;
    return { path, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.filter((s) => s.score > 0).slice(0, maxFiles);

  // 2-hop import expansion around top keyword/priority hits
  const seeds = top.slice(0, 6).map((s) => s.path);
  const closure = expandImportClosure(workspace, seeds, maxFiles);
  const ordered = [...new Set([...priority, ...closure, ...top.map((t) => t.path)])];

  // Fill if still empty
  if (ordered.length === 0) {
    return codeFiles.filter((f) => /\.(ts|js)$/i.test(f)).slice(0, 5);
  }
  return ordered.slice(0, maxFiles);
}

function detectEntryPoints(workspace: Workspace, files: string[]): string[] {
  const out: string[] = [];
  for (const candidate of [
    "src/index.ts",
    "src/index.js",
    "src/main.ts",
    "src/cli/index.ts",
    "index.ts",
    "package.json",
  ]) {
    if (workspace.exists(candidate)) out.push(candidate);
  }

  if (workspace.exists("package.json")) {
    try {
      const pkg = JSON.parse(workspace.readFile("package.json", 50_000)) as {
        main?: string;
        module?: string;
        bin?: string | Record<string, string>;
        exports?: unknown;
      };
      for (const field of [pkg.main, pkg.module]) {
        if (typeof field === "string") {
          const cleaned = field.replace(/^\.\//, "");
          if (workspace.exists(cleaned)) out.push(cleaned);
        }
      }
      if (typeof pkg.bin === "string") {
        const cleaned = pkg.bin.replace(/^\.\//, "");
        if (workspace.exists(cleaned)) out.push(cleaned);
      } else if (pkg.bin && typeof pkg.bin === "object") {
        for (const v of Object.values(pkg.bin)) {
          const cleaned = v.replace(/^\.\//, "");
          if (workspace.exists(cleaned)) out.push(cleaned);
        }
      }
    } catch {
      // ignore
    }
  }

  // Keep only known files
  return out.filter((p) => files.includes(p) || workspace.exists(p));
}
