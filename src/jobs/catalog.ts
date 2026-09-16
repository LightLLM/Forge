import type { AnalysisDefinition, AnalysisId } from "./types.js";

export const ANALYSIS_CATALOG: readonly AnalysisDefinition[] = [
  {
    id: "todo_analysis",
    name: "TODO analysis",
    description: "Scan source for TODO/FIXME/HACK markers and propose follow-ups.",
    defaultEveryMs: 24 * 60 * 60 * 1000,
  },
  {
    id: "dependency_audit",
    name: "Dependency audit",
    description: "Inspect package.json / lockfile presence and dependency footprint.",
    defaultEveryMs: 24 * 60 * 60 * 1000,
  },
  {
    id: "security_scan",
    name: "Security scan",
    description: "Heuristic scan for secret-like strings and risky patterns (report only).",
    defaultEveryMs: 12 * 60 * 60 * 1000,
  },
  {
    id: "repo_summary",
    name: "Repository summary",
    description: "File counts, extensions, and rough size metrics.",
    defaultEveryMs: 24 * 60 * 60 * 1000,
  },
  {
    id: "dead_code_hints",
    name: "Dead-code hints",
    description: "Heuristic unused-export / orphan-file hints (not proof).",
    defaultEveryMs: 7 * 24 * 60 * 60 * 1000,
  },
] as const;

export function getAnalysisDefinition(id: AnalysisId): AnalysisDefinition {
  const def = ANALYSIS_CATALOG.find((d) => d.id === id);
  if (!def) {
    throw new Error(`Missing analysis definition: ${id}`);
  }
  return def;
}
