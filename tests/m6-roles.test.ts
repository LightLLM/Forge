import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  BUILTIN_ROLES,
  filterToolsForRole,
  selectAgentRole,
  listAgentRoles,
} from "../src/agents/index.js";
import { ContextCompiler } from "../src/context/compiler.js";
import { DefaultPolicyEngine } from "../src/policy/engine.js";
import { createRepositoryTools } from "../src/tools/repository.js";
import { Workspace } from "../src/workspace/workspace.js";
import type { RegisteredTool } from "../src/tools/types.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

describe("M6 specialized agents", () => {
  it("exposes distinct built-in roles", () => {
    const ids = listAgentRoles().map((r) => r.id).sort();
    expect(ids).toEqual([
      "architect",
      "debugger",
      "implementer",
      "planner",
      "reviewer",
      "tester",
    ]);
  });

  it("selects different roles by phase", () => {
    expect(
      selectAgentRole({ phase: "implement", objective: "add feature" }).id,
    ).toBe("implementer");
    expect(
      selectAgentRole({ phase: "repair", objective: "fix bug" }).id,
    ).toBe("debugger");
    expect(
      selectAgentRole({ phase: "escalate", objective: "fix bug" }).id,
    ).toBe("debugger");
    expect(
      selectAgentRole({ phase: "review", objective: "review the diff" }).id,
    ).toBe("reviewer");
    expect(
      selectAgentRole({ phase: "architect", objective: "design auth" }).id,
    ).toBe("architect");
    expect(
      selectAgentRole({ phase: "plan", objective: "plan rollout" }).id,
    ).toBe("planner");
  });

  it("gate: roles receive different tools and permissions", () => {
    const tools = createRepositoryTools();
    const reviewerTools = filterToolsForRole(tools, BUILTIN_ROLES.reviewer);
    const implementerTools = filterToolsForRole(tools, BUILTIN_ROLES.implementer);

    expect(reviewerTools.some((t) => t.name === "write_file")).toBe(false);
    expect(reviewerTools.some((t) => t.name === "run_command")).toBe(false);
    expect(implementerTools.some((t) => t.name === "write_file")).toBe(true);
    expect(implementerTools.some((t) => t.name === "run_command")).toBe(true);

    expect(BUILTIN_ROLES.reviewer.permissions.allowWrites).toBe(false);
    expect(BUILTIN_ROLES.implementer.permissions.allowWrites).toBe(true);
    expect(BUILTIN_ROLES.architect.permissions.allowExecute).toBe(false);
    expect(BUILTIN_ROLES.debugger.permissions.allowExecute).toBe(true);
  });

  it("gate: role policy denies writes for reviewer but allows implementer", () => {
    const writeTool = createRepositoryTools().find((t) => t.name === "write_file")!;

    const reviewerPolicy = new DefaultPolicyEngine({
      allowWrites: BUILTIN_ROLES.reviewer.permissions.allowWrites,
      allowExecute: BUILTIN_ROLES.reviewer.permissions.allowExecute,
    });
    const implementerPolicy = new DefaultPolicyEngine({
      allowWrites: BUILTIN_ROLES.implementer.permissions.allowWrites,
      allowExecute: BUILTIN_ROLES.implementer.permissions.allowExecute,
    });

    const call = {
      id: "1",
      name: "write_file",
      arguments: { path: "a.ts", content: "x" },
    };
    expect(reviewerPolicy.evaluate(call, writeTool).allowed).toBe(false);
    expect(implementerPolicy.evaluate(call, writeTool).allowed).toBe(true);
  });

  it("gate: roles receive different context instructions and budgets", () => {
    const dir = mkdtempSync(join(tmpdir(), "forge-m6-"));
    dirs.push(dir);
    const compiler = new ContextCompiler();
    const baseTask = {
      id: "t",
      projectId: "p",
      objective: "do work",
      workspacePath: dir,
      status: "IMPLEMENTING" as const,
      routingMode: "local-only" as const,
      localModel: "fake",
      cloudModel: null,
      maxTurns: 5,
      maxRepairs: 1,
      timeoutMs: 60_000,
      cloudBudgetUsd: null,
      plan: null,
      acceptanceCriteria: null,
      turnCount: 0,
      repairCount: 0,
      cloudCostUsd: 0,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
    };

    const architectCtx = compiler.compile({
      task: baseTask,
      workspace: new Workspace(dir),
      tools: [],
      phase: "implement",
      roleId: "architect",
      roleInstructions: BUILTIN_ROLES.architect.systemInstructions,
      permissionsSummary: "writes=denied",
      budgetSummary: "turns limited",
      maxContextChars: BUILTIN_ROLES.architect.budgets.maxContextChars!,
    });
    const implementerCtx = compiler.compile({
      task: baseTask,
      workspace: new Workspace(dir),
      tools: [],
      phase: "implement",
      roleId: "implementer",
      roleInstructions: BUILTIN_ROLES.implementer.systemInstructions,
      permissionsSummary: "writes=allowed",
      budgetSummary: "turns limited",
      maxContextChars: BUILTIN_ROLES.implementer.budgets.maxContextChars!,
    });

    expect(architectCtx.systemPrompt).toContain("ARCHITECT");
    expect(architectCtx.systemPrompt).toContain("Do not implement");
    expect(implementerCtx.systemPrompt).toContain("IMPLEMENTER");
    expect(implementerCtx.systemPrompt).toContain("Make minimal correct");
    expect(architectCtx.metadata.roleId).toBe("architect");
    expect(implementerCtx.metadata.roleId).toBe("implementer");
    expect(BUILTIN_ROLES.architect.budgets.maxContextChars).toBeLessThan(
      BUILTIN_ROLES.implementer.budgets.maxContextChars!,
    );
    expect(BUILTIN_ROLES.planner.modelPolicy.prefer).toBe("local");
    expect(BUILTIN_ROLES.reviewer.modelPolicy.prefer).toBe("cloud");
  });

  it("unknown tools outside role allowlist are not present for reviewer", () => {
    const extra: RegisteredTool = {
      name: "shadow_write",
      description: "x",
      risk: "write",
      inputSchema: z.object({}),
      jsonSchema: { type: "object" },
      execute: async () => ({}),
    };
    const filtered = filterToolsForRole(
      [...createRepositoryTools(), extra],
      BUILTIN_ROLES.reviewer,
    );
    expect(filtered.map((t) => t.name)).not.toContain("shadow_write");
    expect(filtered.every((t) => t.risk === "read")).toBe(true);
  });
});
