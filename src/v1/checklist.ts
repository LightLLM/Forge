import { readFileSync } from "node:fs";

/**
 * Forge v1 capability checklist (definition from Super Build Prompt §52).
 * Used by M20 RC gate — structural readiness, not a claim of production perfection.
 */
export const FORGE_V1_CAPABILITIES = [
  "understand_repository",
  "preserve_project_memory",
  "plan_objective",
  "create_task_dag",
  "select_relevant_skills",
  "choose_models",
  "launch_isolated_workers",
  "implement_tasks",
  "test_continuously",
  "debug_failures",
  "use_failure_knowledge",
  "perform_browser_qa",
  "run_security_review",
  "integrate_compatible_changes",
  "identify_conflicts",
  "request_approval_when_necessary",
  "survive_restart",
  "respect_privacy_policy",
  "respect_budget",
  "produce_evidence_backed_results",
] as const;

export type ForgeV1Capability = (typeof FORGE_V1_CAPABILITIES)[number];

/** Map capabilities to modules / milestones that implement them. */
export const CAPABILITY_EVIDENCE: Record<ForgeV1Capability, string[]> = {
  understand_repository: ["src/knowledge", "src/context"],
  preserve_project_memory: ["src/memory"],
  plan_objective: ["src/goal", "src/scheduler"],
  create_task_dag: ["src/scheduler"],
  select_relevant_skills: ["src/skills"],
  choose_models: ["src/models", "src/routing"],
  launch_isolated_workers: ["src/workspace/worktree.ts", "src/daemon"],
  implement_tasks: ["src/agent"],
  test_continuously: ["src/verification"],
  debug_failures: ["src/failures", "src/agents"],
  use_failure_knowledge: ["src/failures"],
  perform_browser_qa: ["src/verification/browser"],
  run_security_review: ["src/architecture", "skills"],
  integrate_compatible_changes: ["src/workspace/integration.ts"],
  identify_conflicts: ["src/workspace/conflict.ts"],
  request_approval_when_necessary: [
    "src/policy/approvals.ts",
    "src/policy/approval-framework.ts",
  ],
  survive_restart: ["src/daemon", "src/goal"],
  respect_privacy_policy: ["src/policy", "local-first routing"],
  respect_budget: ["src/core/budgets"],
  produce_evidence_backed_results: ["src/verification", "never trust model self-report"],
};

export interface EvalSuiteTask {
  id: string;
  category: string;
  title: string;
  objective: string;
}

export function loadEvalSuiteCatalog(path: string): EvalSuiteTask[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as { tasks: EvalSuiteTask[] };
  return raw.tasks;
}

export function assertV1ChecklistComplete(): {
  ok: boolean;
  missing: string[];
  count: number;
} {
  const missing = FORGE_V1_CAPABILITIES.filter((c) => !CAPABILITY_EVIDENCE[c]?.length);
  return {
    ok: missing.length === 0,
    missing,
    count: FORGE_V1_CAPABILITIES.length,
  };
}
