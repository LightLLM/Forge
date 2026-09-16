import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DashboardServer } from "../src/dashboard/index.js";
import { SqliteStore } from "../src/persistence/sqlite.js";

describe("M18 operator dashboard", () => {
  it("gate: task state and approvals stay synchronized between CLI and UI", async () => {
    const dir = mkdtempSync(join(tmpdir(), "forge-m18-"));
    const dbPath = join(dir, "forge.db");
    const store = new SqliteStore(dbPath);
    store.initialize();

    const project = store.upsertProject(dir, "m18");
    const task = store.createTask({
      projectId: project.id,
      objective: "dashboard sync",
      workspacePath: dir,
      routingMode: "local-only",
      localModel: "fake-model",
      cloudModel: null,
      maxTurns: 5,
      maxRepairs: 1,
      timeoutMs: 60_000,
      cloudBudgetUsd: null,
    });

    const approval = store.createApproval(task.id, "write_file:write", "path: a.ts");

    const handle = await new DashboardServer({
      store,
      dbPath,
      host: "127.0.0.1",
      port: 0,
    }).start();

    try {
      const listRes = await fetch(`${handle.url}/api/approvals`);
      const listJson = (await listRes.json()) as {
        pending: { id: string; status: string }[];
      };
      expect(listJson.pending.some((a) => a.id === approval.id)).toBe(true);

      // Approve via dashboard API (same store as CLI)
      const approveRes = await fetch(`${handle.url}/api/approvals/${approval.id}/approve`, {
        method: "POST",
      });
      expect(approveRes.ok).toBe(true);

      // CLI-visible store reflects the same decision
      const fromStore = store.getApproval(approval.id);
      expect(fromStore?.status).toBe("approved");

      const taskRes = await fetch(`${handle.url}/api/tasks/${task.id}`);
      const taskJson = (await taskRes.json()) as {
        task: { id: string; status: string };
        approvals: { id: string; status: string }[];
      };
      expect(taskJson.task.id).toBe(task.id);
      expect(taskJson.approvals.find((a) => a.id === approval.id)?.status).toBe("approved");
    } finally {
      await handle.close();
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
