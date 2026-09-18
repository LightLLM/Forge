import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  nextCronOccurrence,
  parseCronExpression,
  ScheduleStore,
} from "../src/jobs/index.js";
import {
  listAgentPipelines,
  resolvePipeline,
  roleForPipelineStage,
} from "../src/agents/index.js";
import { loadConfig } from "../src/config/load.js";
import { SqliteStore } from "../src/persistence/sqlite.js";
import { GatewayServer } from "../src/gateway/index.js";
import { FakeModelProvider } from "../src/models/fake.js";

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

describe("cron schedules", () => {
  it("parses 5-field cron and computes next occurrence", () => {
    const parts = parseCronExpression("0 */6 * * *");
    expect(parts.minute).toEqual([0]);
    expect(parts.hour).toContain(0);
    expect(parts.hour).toContain(6);
    expect(parts.hour).toContain(18);

    const from = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
    const next = nextCronOccurrence("30 14 * * 1", from);
    expect(next.getUTCDay()).toBe(1);
    expect(next.getUTCHours()).toBe(14);
    expect(next.getUTCMinutes()).toBe(30);
    expect(next.getTime()).toBeGreaterThan(from.getTime());
  });

  it("stores cron schedules and advances next_run_at via cron", () => {
    const dir = mkdtempSync(join(tmpdir(), "forge-cron-"));
    dirs.push(dir);
    writeFileSync(join(dir, "README.md"), "#x\n");
    const dbPath = join(dir, "forge.db");
    const store = new ScheduleStore(dbPath);
    store.initialize();
    const s = store.create({
      name: "hourly todos",
      analysisId: "todo_analysis",
      everyMs: 3_600_000,
      cronExpr: "0 * * * *",
    });
    expect(s.cronExpr).toBe("0 * * * *");
    const firedAt = new Date(s.nextRunAt);
    const updated = store.markFired(s.id, "job-1", firedAt);
    expect(updated.runCount).toBe(1);
    expect(new Date(updated.nextRunAt).getTime()).toBeGreaterThan(firedAt.getTime());
    store.close();
  });
});

describe("multi-agent pipelines", () => {
  it("lists build/debug/design/full pipelines with real roles", () => {
    const pipes = listAgentPipelines();
    expect(pipes.map((p) => p.id)).toEqual(
      expect.arrayContaining(["build", "debug", "design", "full"]),
    );
    const build = resolvePipeline("build");
    expect(build.map((s) => s.roleId)).toEqual([
      "planner",
      "implementer",
      "reviewer",
    ]);
    const role = roleForPipelineStage("build", 1, "Add login");
    expect(role.id).toBe("implementer");
  });
});

describe("jobs + agents gateway APIs", () => {
  it("exposes catalog, schedule CRUD, roles, and pipelines", async () => {
    const dir = mkdtempSync(join(tmpdir(), "forge-jobs-api-"));
    dirs.push(dir);
    writeFileSync(join(dir, "README.md"), "#x\n");
    const config = loadConfig(dir, { mode: "local-only", localModel: "fake-model" });
    const store = new SqliteStore(config.dbPath);
    store.initialize();
    const handle = await new GatewayServer({
      store,
      config,
      host: "127.0.0.1",
      port: 0,
      fakeProvider: new FakeModelProvider([{ type: "message", content: "ok" }]),
    }).start();

    try {
      const catalog = await (await fetch(`${handle.url}/api/jobs/catalog`)).json() as {
        catalog: Array<{ id: string }>;
      };
      expect(catalog.catalog.some((c) => c.id === "todo_analysis")).toBe(true);

      const created = await fetch(`${handle.url}/api/jobs/schedules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analysisId: "repo_summary",
          cron: "15 3 * * *",
        }),
      });
      expect(created.status).toBe(201);
      const { schedule } = (await created.json()) as {
        schedule: { id: string; cronExpr: string | null; status: string };
      };
      expect(schedule.cronExpr).toBe("15 3 * * *");

      const paused = await fetch(
        `${handle.url}/api/jobs/schedules/${schedule.id}/pause`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
      expect(paused.ok).toBe(true);

      const roles = await (await fetch(`${handle.url}/api/agents/roles`)).json() as {
        roles: Array<{ id: string }>;
      };
      expect(roles.roles.some((r) => r.id === "implementer")).toBe(true);

      const pipes = await (await fetch(`${handle.url}/api/agents/pipelines`)).json() as {
        pipelines: Array<{ id: string }>;
      };
      expect(pipes.pipelines.some((p) => p.id === "build")).toBe(true);

      const html = await (await fetch(`${handle.url}/`)).text();
      expect(html).toMatch(/Jobs/);
      expect(html).toMatch(/Agents/);
      expect(html).toMatch(/Multi-agent/);
    } finally {
      await handle.close();
      store.close();
    }
  });
});
