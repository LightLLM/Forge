import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadToolPacks } from "../src/tools/packs.js";
import { createAgentTools } from "../src/tools/agent.js";
import { TodoBoard } from "../src/tools/todo-board.js";
import { SqliteStore } from "../src/persistence/sqlite.js";
import { MemoryService } from "../src/memory/service.js";
import { Workspace } from "../src/workspace/workspace.js";
import { rootLogger } from "../src/telemetry/logger.js";
import { DefaultPolicyEngine } from "../src/policy/engine.js";
import { filterToolsForRole, BUILTIN_ROLES } from "../src/agents/roles.js";
import type { ToolContext } from "../src/tools/types.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "forge-agent-tools-"));
  dirs.push(dir);
  writeFileSync(join(dir, "README.md"), "# fixture\n");
  return dir;
}

function ctxFor(
  dir: string,
  extras: Partial<ToolContext["services"]> = {},
): { ctx: ToolContext; store: SqliteStore } {
  const store = new SqliteStore(join(dir, "forge.db"));
  store.initialize();
  const project = store.upsertProject(dir, "fixture");
  const task = store.createTask({
    projectId: project.id,
    objective: "test agent tools",
    workspacePath: dir,
    routingMode: "local-only",
    localModel: "fake-model",
    cloudModel: null,
    maxTurns: 5,
    maxRepairs: 1,
    timeoutMs: 60_000,
    cloudBudgetUsd: null,
  });
  const memory = new MemoryService(store);
  const todos = new TodoBoard();
  const ctx: ToolContext = {
    workspace: new Workspace(dir),
    taskId: task.id,
    runId: "run-1",
    logger: rootLogger.child("test"),
    commandTimeoutMs: 30_000,
    maxCommandOutputChars: 20_000,
    commandAllowlist: [],
    services: {
      store,
      memory,
      projectId: project.id,
      todos,
      allowNetwork: false,
      ...extras,
    },
  };
  return { ctx, store };
}

describe("Hermes-style agent tools", () => {
  it("loads repository + agent packs with expected tool names", async () => {
    const dir = tempDir();
    const tools = await loadToolPacks(dir, ["repository", "agent"]);
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "read_file",
        "run_command",
        "memory_search",
        "memory",
        "todo",
        "skills_list",
        "skill_view",
        "session_search",
        "clarify",
        "web_search",
        "web_extract",
      ]),
    );
  });

  it("supports todo + memory + skills_list without network", async () => {
    const dir = tempDir();
    const { ctx, store } = ctxFor(dir);
    const tools = Object.fromEntries(createAgentTools().map((t) => [t.name, t]));

    const added = (await tools.todo!.execute(
      { action: "add", text: "fix auth" },
      ctx,
    )) as { item: { id: string; text: string } };
    expect(added.item.text).toBe("fix auth");

    const listed = (await tools.todo!.execute({ action: "list" }, ctx)) as {
      items: unknown[];
    };
    expect(listed.items).toHaveLength(1);

    const mem = (await tools.memory!.execute(
      {
        title: "Use JWT",
        content: "Auth uses signed JWT cookies.",
        kind: "decision",
      },
      ctx,
    )) as { saved: { title: string } };
    expect(mem.saved.title).toBe("Use JWT");

    const hits = (await tools.memory_search!.execute(
      { query: "JWT" },
      ctx,
    )) as { hits: Array<{ title: string }> };
    expect(hits.hits.some((h) => h.title.includes("JWT"))).toBe(true);

    const skills = (await tools.skills_list!.execute({}, ctx)) as {
      skills: Array<{ id: string }>;
    };
    expect(skills.skills.some((s) => s.id === "typescript")).toBe(true);

    const clarify = (await tools.clarify!.execute(
      { question: "Which auth library?", choices: ["jose", "jsonwebtoken"] },
      ctx,
    )) as { awaitingUser: boolean; approvalId: string };
    expect(clarify.awaitingUser).toBe(true);
    expect(store.getApproval(clarify.approvalId)?.action).toBe("clarify");

    store.close();
  });

  it("denies network tools by policy until allowNetwork is set", async () => {
    const tools = createAgentTools();
    const web = tools.find((t) => t.name === "web_search")!;
    const denied = new DefaultPolicyEngine({
      allowWrites: true,
      allowExecute: true,
      allowNetwork: false,
    }).evaluate({ id: "1", name: "web_search", arguments: { query: "x" } }, web);
    expect(denied.allowed).toBe(false);

    const allowed = new DefaultPolicyEngine({
      allowWrites: true,
      allowExecute: true,
      allowNetwork: true,
    }).evaluate({ id: "1", name: "web_search", arguments: { query: "x" } }, web);
    expect(allowed.allowed).toBe(true);
  });

  it("exposes agent tools to implementer role when network opt-in", () => {
    const tools = [
      ...createAgentTools(),
      { name: "read_file", risk: "read" as const },
    ];
    const filtered = filterToolsForRole(tools, BUILTIN_ROLES.implementer, {
      allowNetwork: true,
    });
    const names = filtered.map((t) => t.name);
    expect(names).toContain("todo");
    expect(names).toContain("web_search");
    expect(names).toContain("memory_search");

    const offline = filterToolsForRole(tools, BUILTIN_ROLES.implementer, {
      allowNetwork: false,
    });
    expect(offline.map((t) => t.name)).not.toContain("web_search");
  });
});
