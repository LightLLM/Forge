import type { AgentPhase, AgentRoleDefinition, AgentRoleId } from "./roles.js";
import { BUILTIN_ROLES, selectAgentRole } from "./roles.js";

/**
 * Ordered multi-agent pipelines for software work.
 * Each stage maps to a specialized role; Forge still owns policy + verification.
 */
export const AGENT_PIPELINES = {
  /** Default BUILD path: plan → implement → review. */
  build: ["planner", "implementer", "reviewer"] as const satisfies readonly AgentRoleId[],
  /** Debug/repair path. */
  debug: ["debugger", "tester", "reviewer"] as const satisfies readonly AgentRoleId[],
  /** Design-heavy path. */
  design: ["architect", "planner", "implementer", "reviewer"] as const satisfies readonly AgentRoleId[],
  /** Full sequential cast. */
  full: [
    "architect",
    "planner",
    "implementer",
    "tester",
    "reviewer",
  ] as const satisfies readonly AgentRoleId[],
} as const;

export type AgentPipelineId = keyof typeof AGENT_PIPELINES;

export interface PipelineStage {
  index: number;
  roleId: AgentRoleId;
  role: AgentRoleDefinition;
  phaseHint: AgentPhase;
}

const ROLE_PHASE: Partial<Record<AgentRoleId, AgentPhase>> = {
  architect: "architect",
  planner: "plan",
  implementer: "implement",
  debugger: "repair",
  tester: "implement",
  reviewer: "review",
};

export function listAgentPipelines(): Array<{
  id: AgentPipelineId;
  stages: AgentRoleId[];
  description: string;
}> {
  return [
    {
      id: "build",
      stages: [...AGENT_PIPELINES.build],
      description: "Plan → implement → review (default BUILD)",
    },
    {
      id: "debug",
      stages: [...AGENT_PIPELINES.debug],
      description: "Debug → test → review",
    },
    {
      id: "design",
      stages: [...AGENT_PIPELINES.design],
      description: "Architect → plan → implement → review",
    },
    {
      id: "full",
      stages: [...AGENT_PIPELINES.full],
      description: "Full sequential specialist cast",
    },
  ];
}

export function resolvePipeline(id: AgentPipelineId | string): PipelineStage[] {
  const key = id as AgentPipelineId;
  const roles = AGENT_PIPELINES[key];
  if (!roles) {
    throw new Error(`Unknown agent pipeline: ${id}`);
  }
  return roles.map((roleId, index) => {
    const role = BUILTIN_ROLES[roleId];
    return {
      index,
      roleId,
      role,
      phaseHint: ROLE_PHASE[roleId] ?? "implement",
    };
  });
}

/** Pick the active role for a pipeline stage (validates role exists). */
export function roleForPipelineStage(
  pipelineId: AgentPipelineId,
  stageIndex: number,
  objective: string,
): AgentRoleDefinition {
  const stages = resolvePipeline(pipelineId);
  const stage = stages[stageIndex];
  if (!stage) {
    throw new Error(`Pipeline stage out of range: ${pipelineId}[${stageIndex}]`);
  }
  return selectAgentRole({
    phase: stage.phaseHint,
    objective,
    roleId: stage.roleId,
  });
}
