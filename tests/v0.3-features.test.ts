import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueueApprovalGate, createApprovalGate } from "../src/policy/approvals.js";
import { SqliteStore } from "../src/persistence/sqlite.js";
import { loadToolPacks } from "../src/tools/packs.js";
import { POSTGRES_SCHEMA_SQL } from "../src/persistence/postgres.js";
import { ForgeConfigSchema } from "../src/config/load.js";
import { rootLogger } from "../src/telemetry/logger.js";

describe("queue approvals", () => {
  it("resolves when approve is called while polling", async () => {
    const dir = mkdtempSync(join(tmpdir(), "forge-q-"));
    const store = new SqliteStore(join(dir, "t.db"));
    store.initialize();
    try {
      const project = store.upsertProject(dir, "t");
      const task = store.createTask({
        projectId: project.id,
        objective: "x",
        workspacePath: dir,
        routingMode: "local-only",
        localModel: "fake-model",
        cloudModel: null,
        maxTurns: 5,
        maxRepairs: 1,
        timeoutMs: 60_000,
        cloudBudgetUsd: null,
      });

      const gate = new QueueApprovalGate(store, rootLogger, 5_000, 50);
      const pending = gate.decide({
        taskId: task.id,
        toolName: "write_file",
        risk: "write",
        summary: "path: a.ts",
      });

      // Wait until pending row exists, then approve.
      await new Promise((r) => setTimeout(r, 80));
      const queued = store.listPendingApprovals(task.id);
      expect(queued.length).toBe(1);
      store.resolveApproval(queued[0]!.id, "approved");

      await expect(pending).resolves.toBe("approved");
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("createApprovalGate selects queue mode", () => {
    const dir = mkdtempSync(join(tmpdir(), "forge-qg-"));
    const store = new SqliteStore(join(dir, "t.db"));
    store.initialize();
    try {
      const gate = createApprovalGate(
        { mode: "queue", risks: ["write"], queueTimeoutMs: 1000, queuePollMs: 50 },
        { store },
      );
      expect(gate).toBeInstanceOf(QueueApprovalGate);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("tool packs", () => {
  it("loads built-in repository pack", async () => {
    const tools = await loadToolPacks(process.cwd(), ["repository"]);
    expect(tools.some((t) => t.name === "read_file")).toBe(true);
    expect(tools.some((t) => t.name === "write_file")).toBe(true);
  });

  it("loads an external pack module", async () => {
    const dir = mkdtempSync(join(tmpdir(), "forge-pack-"));
    try {
      mkdirSync(join(dir, "packs"), { recursive: true });
      writeFileSync(
        join(dir, "packs", "echo.mjs"),
        `
export function createTools() {
  return [{
    name: "echo_tool",
    description: "echo",
    risk: "read",
    inputSchema: { parse: (x) => x },
    jsonSchema: { type: "object", properties: { msg: { type: "string" } } },
    async execute(input) { return input; }
  }];
}
`,
      );
      const tools = await loadToolPacks(dir, [
        "repository",
        "./packs/echo.mjs",
      ]);
      expect(tools.some((t) => t.name === "echo_tool")).toBe(true);
      expect(tools.some((t) => t.name === "read_file")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("postgres schema module", () => {
  it("exports schema DDL", () => {
    expect(POSTGRES_SCHEMA_SQL).toContain("CREATE TABLE IF NOT EXISTS tasks");
    expect(POSTGRES_SCHEMA_SQL).toContain("approvals");
  });
});

describe("v0.3 config", () => {
  it("supports queue approvals and tool packs", () => {
    const cfg = ForgeConfigSchema.parse({
      approvals: { mode: "queue" },
      tools: { packs: ["repository"] },
    });
    expect(cfg.approvals.mode).toBe("queue");
    expect(cfg.tools.packs).toEqual(["repository"]);
  });
});
