import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApprovalFramework } from "../src/policy/approval-framework.js";
import { SqliteStore } from "../src/persistence/sqlite.js";

describe("M17 human approval framework", () => {
  it("gate: restricted action cannot execute without explicit approval", () => {
    const dir = mkdtempSync(join(tmpdir(), "forge-m17-"));
    const dbPath = join(dir, "forge.db");
    const store = new SqliteStore(dbPath);
    store.initialize();
    const fw = new ApprovalFramework(dbPath, store);
    fw.initialize();

    const pending = fw.request({
      taskId: "task-1",
      kind: "destructive_action",
      reason: "delete production database",
      risk: "critical",
      requestingAgent: "implementer",
    });

    expect(() => fw.assertApproved(pending.id)).toThrow(/silence is not approval|blocked/i);

    expect(() => fw.resolve(pending.id, "approved", "model")).toThrow(/cannot approve/i);
    expect(() => fw.resolve(pending.id, "approved", "agent")).toThrow(/cannot approve/i);

    const approved = fw.resolve(pending.id, "approved", "operator");
    expect(approved.status).toBe("approved");
    expect(fw.assertApproved(pending.id).decisionMaker).toBe("operator");

    fw.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
