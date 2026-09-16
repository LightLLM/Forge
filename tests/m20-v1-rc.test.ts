import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertV1ChecklistComplete,
  FORGE_V1_CAPABILITIES,
  loadEvalSuiteCatalog,
} from "../src/v1/index.js";
import { KnowledgeAnalyzer } from "../src/knowledge/index.js";
import { ArchitectureEvaluator } from "../src/architecture/index.js";
import { ApprovalFramework } from "../src/policy/approval-framework.js";
import { SkillImprovementService } from "../src/skills/improvement.js";
import { DashboardServer } from "../src/dashboard/index.js";
import { FailureCorpus } from "../src/failures/index.js";
import { AdaptiveModelRouter } from "../src/routing/index.js";
import { GoalEngine } from "../src/goal/index.js";
import { VerificationEngine } from "../src/verification/engine.js";

describe("M20 Forge v1 RC", () => {
  it("has complete 20-capability checklist with evidence", () => {
    const result = assertV1ChecklistComplete();
    expect(result.count).toBe(20);
    expect(result.ok).toBe(true);
    expect(FORGE_V1_CAPABILITIES).toHaveLength(20);
  });

  it("ships real-world eval suite catalog (~20 tasks)", () => {
    const catalogPath = resolve("fixtures/eval-suite/catalog.json");
    expect(existsSync(catalogPath)).toBe(true);
    const tasks = loadEvalSuiteCatalog(catalogPath);
    expect(tasks.length).toBeGreaterThanOrEqual(20);
    const categories = new Set(tasks.map((t) => t.category));
    expect(categories.has("bug_fix")).toBe(true);
    expect(categories.has("security_bug")).toBe(true);
    expect(categories.has("multi_file_feature")).toBe(true);
  });

  it("exports core v1 surfaces used by the capability list", () => {
    expect(KnowledgeAnalyzer).toBeTypeOf("function");
    expect(ArchitectureEvaluator).toBeTypeOf("function");
    expect(ApprovalFramework).toBeTypeOf("function");
    expect(SkillImprovementService).toBeTypeOf("function");
    expect(DashboardServer).toBeTypeOf("function");
    expect(FailureCorpus).toBeTypeOf("function");
    expect(AdaptiveModelRouter).toBeTypeOf("function");
    expect(GoalEngine).toBeTypeOf("function");
    expect(VerificationEngine).toBeTypeOf("function");
  });
});
