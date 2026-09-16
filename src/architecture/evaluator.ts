import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { KnowledgeAnalyzer } from "../knowledge/analyzer.js";
import type {
  ArchitectureEvaluation,
  ArchitecturePolicy,
  ArchitectureRule,
  ArchitectureViolation,
} from "./types.js";

export class ArchitecturePolicyLoader {
  load(workspaceRoot: string): ArchitecturePolicy | null {
    const candidates = [
      join(workspaceRoot, ".forge", "architecture.json"),
      join(workspaceRoot, "architecture.json"),
    ];
    for (const path of candidates) {
      if (!existsSync(path)) continue;
      const raw = JSON.parse(readFileSync(path, "utf8")) as ArchitecturePolicy;
      if (!raw.rules || !Array.isArray(raw.rules)) {
        throw new Error(`Invalid architecture policy at ${path}`);
      }
      return raw;
    }
    return null;
  }
}

/**
 * Deterministic architecture constraint evaluator over the knowledge graph.
 */
export class ArchitectureEvaluator {
  constructor(private readonly analyzer = new KnowledgeAnalyzer()) {}

  evaluate(workspaceRoot: string, policy?: ArchitecturePolicy | null): ArchitectureEvaluation {
    const effective =
      policy ?? new ArchitecturePolicyLoader().load(workspaceRoot);
    if (!effective || effective.rules.length === 0) {
      return { ok: true, violations: [], rulesChecked: 0 };
    }

    const graph = this.analyzer.build(workspaceRoot);
    const violations: ArchitectureViolation[] = [];

    for (const rule of effective.rules) {
      if (rule.kind !== "no_import" && rule.kind !== "layer_boundary") continue;
      for (const edge of graph.edges) {
        if (edge.kind !== "imports") continue;
        const from = strip(edge.from);
        const to = strip(edge.to);
        if (matchesPrefix(from, rule.from) && matchesPrefix(to, rule.to)) {
          violations.push({
            ruleId: rule.id,
            description: rule.description,
            fromFile: from,
            toFile: to,
          });
        }
      }
    }

    return {
      ok: violations.length === 0,
      violations,
      rulesChecked: effective.rules.length,
    };
  }
}

function strip(id: string): string {
  return id.startsWith("file:") ? id.slice(5) : id;
}

function matchesPrefix(path: string, pattern: string): boolean {
  const p = path.replace(/\\/g, "/");
  const pat = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
  if (pat.endsWith("/**") || pat.endsWith("/*")) {
    const base = pat.replace(/\/\*\*?$/, "");
    return p === base || p.startsWith(base + "/");
  }
  if (pat.includes("*")) {
    const re = new RegExp(
      "^" + pat.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
    );
    return re.test(p);
  }
  return p === pat || p.startsWith(pat.replace(/\/$/, "") + "/") || p.startsWith(pat);
}

export type { ArchitectureRule };
