import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteStore } from "../src/persistence/sqlite.js";
import { loadConfig } from "../src/config/load.js";
import { FakeModelProvider } from "../src/models/fake.js";
import { GatewayServer } from "../src/gateway/index.js";
import { filterEventsForChannel } from "../src/gateway/events.js";
import { InteractionSessionStore } from "../src/gateway/sessions.js";

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

function tempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "forge-gw-"));
  dirs.push(dir);
  writeFileSync(join(dir, "README.md"), "# fixture\n");
  return dir;
}

describe("GUI-0 / GW gateway API", () => {
  it("creates sessions, posts messages, and redacts secrets from status", async () => {
    const dir = tempWorkspace();
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
      const health = await fetch(`${handle.url}/api/health`);
      expect(health.ok).toBe(true);

      const created = await fetch(`${handle.url}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspacePath: dir,
          channel: "web",
          chatMode: "ask",
        }),
      });
      expect(created.status).toBe(201);
      const { session } = (await created.json()) as { session: { id: string } };

      const ask = await fetch(`${handle.url}/api/sessions/${session.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "What is auth?", mode: "ask" }),
      });
      const askBody = (await ask.json()) as {
        message: { content: { text: string } };
      };
      expect(askBody.message.content.text).toMatch(/ASK mode/i);
      expect(askBody.message.content.text).toMatch(/no repository mutations/i);

      const plan = await fetch(`${handle.url}/api/sessions/${session.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "Ship billing", mode: "plan" }),
      });
      const planBody = (await plan.json()) as {
        message: { content: { text: string } };
      };
      expect(planBody.message.content.text).toMatch(/PLAN mode/i);

      const hist = await fetch(`${handle.url}/api/events?sessionId=${session.id}`);
      const histBody = (await hist.json()) as { events: unknown[] };
      expect(histBody.events.length).toBeGreaterThan(0);

      const status = await fetch(`${handle.url}/api/system/status`);
      const statusBody = (await status.json()) as Record<string, unknown>;
      expect(statusBody.openRouterConfigured).toBeDefined();
      expect(JSON.stringify(statusBody)).not.toMatch(/sk-or-[a-zA-Z0-9]/i);
      expect(statusBody).not.toHaveProperty("telegramToken");
      expect(statusBody).not.toHaveProperty("openRouterApiKey");

      const gui = await fetch(`${handle.url}/`);
      expect(gui.headers.get("content-type")).toMatch(/text\/html/);
      const html = await gui.text();
      expect(html).toMatch(/FORGE/);
    } finally {
      await handle.close();
      store.close();
    }
  });

  it("filters channel notifications by level", () => {
    expect(
      filterEventsForChannel(
        {
          id: "1",
          type: "tool.started",
          payload: {},
          timestamp: new Date().toISOString(),
        },
        "minimal",
      ),
    ).toBe(false);
    expect(
      filterEventsForChannel(
        {
          id: "2",
          type: "task.completed",
          payload: {},
          timestamp: new Date().toISOString(),
        },
        "minimal",
      ),
    ).toBe(true);
  });
});

describe("GW channel pairing + fake E2E", () => {
  it("rejects unapproved fake users and completes authorized flow", async () => {
    const dir = tempWorkspace();
    const config = loadConfig(dir, { mode: "local-only", localModel: "fake-model" });
    const store = new SqliteStore(config.dbPath);
    store.initialize();
    const handle = await new GatewayServer({
      store,
      config,
      host: "127.0.0.1",
      port: 0,
      fakeProvider: new FakeModelProvider([{ type: "message", content: "done" }]),
    }).start();

    try {
      await handle.channels.fake.simulateUser({
        externalConversationId: "chat-1",
        externalUserId: "user-evil",
        text: "hack the planet",
      });
      expect(handle.channels.fake.sent.some((m) => /PAIRING REQUIRED/.test(m.text))).toBe(
        true,
      );
      const pairings = handle.sessions.listPendingPairings();
      expect(pairings.length).toBeGreaterThan(0);
      handle.sessions.resolvePairing(pairings[0]!.id, "approved");

      handle.channels.fake.sent.length = 0;
      await handle.channels.fake.simulateUser({
        externalConversationId: "chat-1",
        externalUserId: "user-evil",
        text: "/help",
      });
      expect(handle.channels.fake.sent.some((m) => /Commands:/i.test(m.text))).toBe(true);

      handle.channels.fake.sent.length = 0;
      await handle.channels.fake.simulateUser({
        externalConversationId: "chat-1",
        externalUserId: "user-evil",
        text: "switch from local-only to cloud please",
      });
      expect(
        handle.channels.fake.sent.some((m) => /Denied: routing policy/i.test(m.text)),
      ).toBe(true);
    } finally {
      await handle.close();
      store.close();
    }
  });

  it("rejects model as pairing decision maker path via identity rules", () => {
    const dir = tempWorkspace();
    const config = loadConfig(dir);
    // ensure parent exists for sqlite
    const store = new SqliteStore(config.dbPath);
    store.initialize();
    const sessions = new InteractionSessionStore(config.dbPath);
    sessions.initialize();
    const pairing = sessions.createPairing({
      channel: "telegram",
      externalUserId: "tg-1",
      displayName: "alice",
    });
    const approved = sessions.resolvePairing(pairing.id, "approved");
    expect(approved.status).toBe("approved");
    expect(sessions.isAuthorized("telegram", "tg-1", "chat")).toBe(true);
    expect(sessions.isAuthorized("telegram", "stranger", "chat")).toBe(false);
    sessions.close();
    store.close();
  });
});
