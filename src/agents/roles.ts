import type { ToolRisk } from "../core/types.js";

export type AgentRoleId =
  | "architect"
  | "planner"
  | "implementer"
  | "debugger"
  | "tester"
  | "reviewer";

export interface RolePermissions {
  allowWrites: boolean;
  allowExecute: boolean;
  /** Highest risk the role may invoke (network still globally denied by policy). */
  maxRisk: ToolRisk;
}

export interface RoleBudgets {
  /** Soft turn hint for this role (orchestrator may clamp). */
  maxTurns?: number;
  maxContextChars?: number;
  maxCloudCostUsd?: number | null;
}

export interface RoleModelPolicy {
  /** Prefer local | cloud | either — router still owns LOCAL_ONLY enforcement. */
  prefer: "local" | "cloud" | "either";
}

export interface AgentRoleDefinition {
  id: AgentRoleId;
  name: string;
  description: string;
  systemInstructions: string;
  /** Tool names this role may see/use. Empty = none. */
  allowedTools: string[];
  permissions: RolePermissions;
  budgets: RoleBudgets;
  modelPolicy: RoleModelPolicy;
}

const READ_TOOLS = [
  "list_files",
  "read_file",
  "search_repository",
  "git_status",
  "git_diff",
] as const;

const WRITE_TOOLS = ["write_file", "apply_patch"] as const;
const EXEC_TOOLS = ["run_command"] as const;

export const BUILTIN_ROLES: Record<AgentRoleId, AgentRoleDefinition> = {
  architect: {
    id: "architect",
    name: "Architect",
    description: "High-level design and constraints; read-only analysis.",
    systemInstructions: [
      "You are the ARCHITECT role.",
      "Propose structure, boundaries, and risks. Do not implement code changes.",
      "Prefer clear module boundaries and verifiable acceptance criteria.",
    ].join("\n"),
    allowedTools: [...READ_TOOLS],
    permissions: { allowWrites: false, allowExecute: false, maxRisk: "read" },
    budgets: { maxTurns: 8, maxContextChars: 32_000 },
    modelPolicy: { prefer: "either" },
  },
  planner: {
    id: "planner",
    name: "Planner",
    description: "Decompose work into ordered steps; read-only.",
    systemInstructions: [
      "You are the PLANNER role.",
      "Produce a concise ordered plan with dependencies. Do not edit files.",
      "Call out verification steps for each planned item.",
    ].join("\n"),
    allowedTools: [...READ_TOOLS],
    permissions: { allowWrites: false, allowExecute: false, maxRisk: "read" },
    budgets: { maxTurns: 6, maxContextChars: 24_000 },
    modelPolicy: { prefer: "local" },
  },
  implementer: {
    id: "implementer",
    name: "Implementer",
    description: "Implement code changes under policy.",
    systemInstructions: [
      "You are the IMPLEMENTER role.",
      "Make minimal correct code changes to satisfy the objective.",
      "Stop when done and summarize; Forge runs verification independently.",
    ].join("\n"),
    allowedTools: [...READ_TOOLS, ...WRITE_TOOLS, ...EXEC_TOOLS],
    permissions: { allowWrites: true, allowExecute: true, maxRisk: "execute" },
    budgets: { maxTurns: 20, maxContextChars: 48_000 },
    modelPolicy: { prefer: "either" },
  },
  debugger: {
    id: "debugger",
    name: "Debugger",
    description: "Repair failing verification with focused changes.",
    systemInstructions: [
      "You are the DEBUGGER role.",
      "Focus on verification failures. Form one hypothesis, change minimally, stop.",
      "Prioritize failure-linked files and the current diff.",
    ].join("\n"),
    allowedTools: [...READ_TOOLS, ...WRITE_TOOLS, ...EXEC_TOOLS],
    permissions: { allowWrites: true, allowExecute: true, maxRisk: "execute" },
    budgets: { maxTurns: 12, maxContextChars: 40_000 },
    modelPolicy: { prefer: "either" },
  },
  tester: {
    id: "tester",
    name: "Tester",
    description: "Inspect and run tests; limited writes for test files.",
    systemInstructions: [
      "You are the TESTER role.",
      "Strengthen or repair tests. Prefer deterministic assertions.",
      "Do not delete tests to force green status.",
    ].join("\n"),
    allowedTools: [...READ_TOOLS, "write_file", ...EXEC_TOOLS],
    permissions: { allowWrites: true, allowExecute: true, maxRisk: "execute" },
    budgets: { maxTurns: 10, maxContextChars: 36_000 },
    modelPolicy: { prefer: "local" },
  },
  reviewer: {
    id: "reviewer",
    name: "Reviewer",
    description: "Independent review; read-only critique.",
    systemInstructions: [
      "You are the REVIEWER role.",
      "Critique the diff and risks. Do not modify files.",
      "Call out security, correctness, and missing tests. Be specific.",
    ].join("\n"),
    allowedTools: [...READ_TOOLS],
    permissions: { allowWrites: false, allowExecute: false, maxRisk: "read" },
    budgets: { maxTurns: 8, maxContextChars: 36_000 },
    modelPolicy: { prefer: "cloud" },
  },
};

export type AgentPhase = "implement" | "repair" | "escalate" | "review" | "plan" | "architect";

export interface RoleSelectionInput {
  phase: AgentPhase;
  objective: string;
  /** Optional explicit override. */
  roleId?: AgentRoleId;
  phaseRoles?: Partial<Record<"implement" | "repair" | "escalate", AgentRoleId>>;
}

/**
 * Select a specialized role. Explicit override wins; else phase map; else heuristics.
 */
export function selectAgentRole(input: RoleSelectionInput): AgentRoleDefinition {
  if (input.roleId && BUILTIN_ROLES[input.roleId]) {
    return BUILTIN_ROLES[input.roleId];
  }

  const phase = input.phase;
  if (phase === "implement" || phase === "repair" || phase === "escalate") {
    const mapped = input.phaseRoles?.[phase];
    if (mapped && BUILTIN_ROLES[mapped]) return BUILTIN_ROLES[mapped];
  }

  const obj = input.objective.toLowerCase();
  if (phase === "architect" || /\barchitect(ure)?\b/.test(obj)) {
    return BUILTIN_ROLES.architect;
  }
  if (phase === "plan" || /\bplan(ning)?\b/.test(obj)) {
    return BUILTIN_ROLES.planner;
  }
  if (phase === "review" || /\breview\b/.test(obj)) {
    return BUILTIN_ROLES.reviewer;
  }
  if (/\btest(s|ing)?\b/.test(obj) && phase === "implement") {
    return BUILTIN_ROLES.tester;
  }

  switch (phase) {
    case "repair":
    case "escalate":
      return BUILTIN_ROLES.debugger;
    case "implement":
    default:
      return BUILTIN_ROLES.implementer;
  }
}

export function listAgentRoles(): AgentRoleDefinition[] {
  return Object.values(BUILTIN_ROLES);
}

export function getAgentRole(id: string): AgentRoleDefinition | null {
  return (BUILTIN_ROLES as Record<string, AgentRoleDefinition>)[id] ?? null;
}

export function filterToolsForRole<T extends { name: string; risk: ToolRisk }>(
  tools: T[],
  role: AgentRoleDefinition,
): T[] {
  const allow = new Set(role.allowedTools);
  const rank: Record<ToolRisk, number> = {
    read: 0,
    write: 1,
    execute: 2,
    network: 3,
  };
  const max = rank[role.permissions.maxRisk];
  return tools.filter(
    (t) => allow.has(t.name) && rank[t.risk] <= max && t.risk !== "network",
  );
}
