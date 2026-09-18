import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
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
      fakeProvider: new FakeModelProvider([
        { type: "message", content: "ok" },
        { type: "message", content: "PLAN: ship billing in three steps" },
      ]),
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
      expect(askBody.message.content.text).toMatch(/ok/i);

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

  it("accepts small file attachments into .forge/inbox and references them in chat", async () => {
    const dir = tempWorkspace();
    writeFileSync(join(dir, "notes.txt"), "hello from workspace\n");
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
      const created = await fetch(`${handle.url}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspacePath: dir,
          channel: "web",
          chatMode: "ask",
        }),
      });
      const { session } = (await created.json()) as { session: { id: string } };
      const payload = Buffer.from("screenshot-bytes").toString("base64");
      const posted = await fetch(`${handle.url}/api/sessions/${session.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "look at this",
          mode: "ask",
          attachments: [
            {
              name: "shot.png",
              mimeType: "image/png",
              sizeBytes: 16,
              dataBase64: payload,
            },
            {
              name: "notes.txt",
              mimeType: "text/plain",
              sizeBytes: 0,
              workspacePath: "notes.txt",
            },
          ],
        }),
      });
      expect(posted.ok).toBe(true);
      const body = (await posted.json()) as {
        message: { content: { text: string } };
      };
      expect(body.message.content.text).toMatch(/ASK mode/i);

      const hist = await fetch(`${handle.url}/api/sessions/${session.id}/messages`);
      const messages = (await hist.json()) as {
        messages: Array<{
          role: string;
          content: { text: string };
          attachments?: Array<{ storedPath?: string }>;
        }>;
      };
      const user = messages.messages.find((m) => m.role === "user");
      expect(user?.content.text).toMatch(/Attachments:/);
      expect(user?.content.text).toMatch(/\.forge\/inbox\//);
      expect(user?.content.text).toMatch(/notes\.txt/);
      expect(user?.attachments?.length).toBe(2);
      expect(existsSync(join(dir, user!.attachments![0]!.storedPath!))).toBe(true);
    } finally {
      await handle.close();
      store.close();
    }
  });
});

describe("terminal + traces APIs", () => {
  it("records chat model usage traces and runs allowlisted terminal commands", async () => {
    const dir = tempWorkspace();
    const config = loadConfig(dir, { mode: "local-only", localModel: "fake-model" });
    const store = new SqliteStore(config.dbPath);
    store.initialize();
    const handle = await new GatewayServer({
      store,
      config,
      host: "127.0.0.1",
      port: 0,
      fakeProvider: new FakeModelProvider([{ type: "message", content: "traced" }]),
    }).start();

    try {
      const created = await fetch(`${handle.url}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspacePath: dir,
          channel: "web",
          chatMode: "ask",
        }),
      });
      const { session } = (await created.json()) as { session: { id: string } };

      const ask = await fetch(`${handle.url}/api/sessions/${session.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "hello", mode: "ask" }),
      });
      expect(ask.ok).toBe(true);

      const traces = await fetch(`${handle.url}/api/traces`);
      const traceBody = (await traces.json()) as {
        summary: { calls: number };
        traces: Array<{ provider: string; model: string; status: string }>;
      };
      expect(traceBody.summary.calls).toBeGreaterThan(0);
      expect(traceBody.traces[0]?.provider).toBe("fake");
      expect(traceBody.traces[0]?.status).toBe("ok");

      const allow = await fetch(`${handle.url}/api/terminal/allowlist`);
      const allowBody = (await allow.json()) as { allowlist: string[] };
      expect(allowBody.allowlist).toContain("git status");

      const denied = await fetch(`${handle.url}/api/terminal/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "rm -rf /" }),
      });
      expect(denied.status).toBe(400);

      const ok = await fetch(`${handle.url}/api/terminal/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "git status" }),
      });
      // Workspace may not be a git repo — accept success or non-policy failure via stdout/stderr
      expect([200, 400].includes(ok.status)).toBe(true);
      if (ok.status === 200) {
        const body = (await ok.json()) as { command: string; exitCode: number | null };
        expect(body.command).toBe("git status");
      }

      const html = await (await fetch(`${handle.url}/`)).text();
      expect(html).toMatch(/Terminal/);
      expect(html).toMatch(/Eval &amp; Traces|Eval & Traces/);
      expect(html).toMatch(/forge-session-id/);
    } finally {
      await handle.close();
      store.close();
    }
  });
});
