import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ChannelManager,
  SlackAdapter,
  TelegramAdapter,
  WhatsAppAdapter,
} from "../src/gateway/channels/index.js";
import { GatewayServer } from "../src/gateway/index.js";
import { loadConfig } from "../src/config/load.js";
import { SqliteStore } from "../src/persistence/sqlite.js";
import { FakeModelProvider } from "../src/models/fake.js";
import { InteractionSessionStore } from "../src/gateway/sessions.js";

const dirs: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function tempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "forge-ch-"));
  dirs.push(dir);
  writeFileSync(join(dir, "README.md"), "# fixture\n");
  return dir;
}

describe("Telegram / Slack / WhatsApp connection testing", () => {
  it("reports disabled when tokens are unset", async () => {
    const mgr = new ChannelManager({
      telegramToken: null,
      slackBotToken: null,
      whatsappToken: null,
    });
    await mgr.startAll();
    const health = await mgr.health();
    const byName = Object.fromEntries(health.map((h) => [h.name, h]));
    expect(byName.telegram?.status).toBe("disabled");
    expect(byName.slack?.status).toBe("disabled");
    expect(byName.whatsapp?.status).toBe("disabled");
    expect(byName.fake?.status).toBe("connected");

    const probes = await mgr.probeAll();
    const telegram = probes.find((p) => p.name === "telegram")!;
    const slack = probes.find((p) => p.name === "slack")!;
    const whatsapp = probes.find((p) => p.name === "whatsapp")!;
    expect(telegram.ok).toBe(false);
    expect(telegram.detail).toMatch(/TELEGRAM_BOT_TOKEN unset/);
    expect(slack.ok).toBe(false);
    expect(slack.detail).toMatch(/SLACK_BOT_TOKEN unset/);
    expect(whatsapp.ok).toBe(false);
    expect(whatsapp.error).toBe("whatsapp_stub");
    await mgr.stopAll();
  });

  it("Telegram probe succeeds against mocked getMe", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain("api.telegram.org/botTEST_TOKEN/getMe");
      return new Response(
        JSON.stringify({
          ok: true,
          result: { id: 1, is_bot: true, username: "forge_test_bot" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const tg = new TelegramAdapter("TEST_TOKEN");
    await tg.start();
    const probe = await tg.probe();
    expect(probe.ok).toBe(true);
    expect(probe.identity).toBe("@forge_test_bot");
    expect(probe.detail).toMatch(/getMe ok/);
    const health = await tg.health();
    expect(health.status).toBe("connected");
    await tg.stop();
  });

  it("Telegram probe fails on invalid token (mocked)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ ok: false, description: "Unauthorized" }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const tg = new TelegramAdapter("BAD");
    const probe = await tg.probe();
    expect(probe.ok).toBe(false);
    expect(probe.status).toBe("error");
    expect(probe.error).toMatch(/Unauthorized|HTTP/);
  });

  it("Slack probe succeeds against mocked auth.test", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toContain("slack.com/api/auth.test");
        const headers = init?.headers as Record<string, string>;
        expect(headers.Authorization).toBe("Bearer xoxb-test");
        return new Response(
          JSON.stringify({ ok: true, user: "forgebot", team: "LightLLM" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );
    const slack = new SlackAdapter("xoxb-test", "signing-secret");
    await slack.start();
    const probe = await slack.probe();
    expect(probe.ok).toBe(true);
    expect(probe.identity).toBe("forgebot@LightLLM");
    expect(probe.detail).toMatch(/signing secret set/);
  });

  it("Slack webhook url_verification and inbound message wiring", async () => {
    const slack = new SlackAdapter("xoxb-test");
    const inbound: Array<{ text: string; user: string; channel: string }> = [];
    slack.onInbound(async (msg) => {
      inbound.push({
        text: msg.text,
        user: msg.externalUserId,
        channel: msg.externalConversationId,
      });
    });
    await slack.start();

    const challenge = await slack.handleEvent({
      type: "url_verification",
      challenge: "abc123",
    });
    expect(challenge).toEqual({ challenge: "abc123" });

    await slack.handleEvent({
      event: {
        type: "message",
        user: "U123",
        text: "hello forge",
        channel: "C456",
        ts: "1.0",
      },
    });
    expect(inbound).toEqual([
      { text: "hello forge", user: "U123", channel: "C456" },
    ]);

    // Ignore bot messages
    await slack.handleEvent({
      event: {
        type: "message",
        user: "U999",
        text: "bot noise",
        channel: "C456",
        bot_id: "B1",
        ts: "2.0",
      },
    });
    expect(inbound).toHaveLength(1);
  });

  it("WhatsApp remains stubbed and refuses send", async () => {
    const wa = new WhatsAppAdapter("token-present");
    const health = await wa.health();
    expect(health.status).toBe("disabled");
    expect(health.detail).toMatch(/stubbed/);
    const probe = await wa.probe();
    expect(probe.ok).toBe(false);
    expect(probe.error).toBe("whatsapp_stub");
    await expect(
      wa.send({
        channel: "whatsapp",
        externalConversationId: "1",
        text: "hi",
      }),
    ).rejects.toThrow(/Cloud API/);
  });

  it("Gateway exposes channel health + probe API and Slack webhook challenge", async () => {
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
      const healthRes = await fetch(`${handle.url}/api/gateway/channels`);
      expect(healthRes.ok).toBe(true);
      const healthBody = (await healthRes.json()) as {
        channels: Array<{ name: string; status: string }>;
      };
      const names = healthBody.channels.map((c) => c.name).sort();
      expect(names).toEqual(["fake", "slack", "telegram", "whatsapp"]);

      const probeRes = await fetch(`${handle.url}/api/gateway/channels/probe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      expect(probeRes.ok).toBe(true);
      const probeBody = (await probeRes.json()) as {
        probes: Array<{ name: string; ok: boolean; detail: string }>;
      };
      expect(probeBody.probes.find((p) => p.name === "fake")?.ok).toBe(true);
      expect(probeBody.probes.find((p) => p.name === "telegram")?.ok).toBe(false);
      expect(probeBody.probes.find((p) => p.name === "slack")?.ok).toBe(false);
      expect(probeBody.probes.find((p) => p.name === "whatsapp")?.ok).toBe(false);

      const challenge = await fetch(`${handle.url}/api/webhooks/slack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "url_verification", challenge: "sl-challenge" }),
      });
      expect(challenge.ok).toBe(true);
      const challengeBody = (await challenge.json()) as { challenge?: string };
      expect(challengeBody.challenge).toBe("sl-challenge");
    } finally {
      await handle.close();
      store.close();
    }
  });

  it("Telegram pairing flow authorizes chat after operator approval", () => {
    const dir = tempWorkspace();
    const config = loadConfig(dir);
    const store = new SqliteStore(config.dbPath);
    store.initialize();
    const sessions = new InteractionSessionStore(config.dbPath);
    sessions.initialize();

    expect(sessions.isAuthorized("telegram", "tg-42", "chat")).toBe(false);
    const pairing = sessions.createPairing({
      channel: "telegram",
      externalUserId: "tg-42",
      displayName: "alice",
    });
    expect(pairing.code.length).toBeGreaterThan(3);
    sessions.resolvePairing(pairing.id, "approved");
    expect(sessions.isAuthorized("telegram", "tg-42", "chat")).toBe(true);
    expect(sessions.isAuthorized("slack", "U99", "chat")).toBe(false);

    const slackPair = sessions.createPairing({
      channel: "slack",
      externalUserId: "U99",
      displayName: "bob",
    });
    sessions.resolvePairing(slackPair.id, "approved");
    expect(sessions.isAuthorized("slack", "U99", "chat")).toBe(true);

    sessions.close();
    store.close();
  });

  it("live probe: skips or reports when env tokens present (never logs secrets)", async () => {
    const hasTg = Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim());
    const hasSlack = Boolean(process.env.SLACK_BOT_TOKEN?.trim());
    const mgr = new ChannelManager();
    const probes = await mgr.probeAll();

    const tg = probes.find((p) => p.name === "telegram")!;
    const slack = probes.find((p) => p.name === "slack")!;
    const wa = probes.find((p) => p.name === "whatsapp")!;

    // Always assert structured results; secrets must never appear in details.
    for (const p of probes) {
      expect(JSON.stringify(p)).not.toMatch(/bot\d+:[A-Za-z0-9_-]{20,}/);
      expect(JSON.stringify(p)).not.toMatch(/xoxb-[A-Za-z0-9-]+/);
    }

    if (!hasTg) {
      expect(tg.ok).toBe(false);
      expect(tg.detail).toMatch(/unset/);
    } else {
      // Live credential present — report connectivity truthfully
      expect(typeof tg.ok).toBe("boolean");
      expect(tg.detail.length).toBeGreaterThan(0);
    }

    if (!hasSlack) {
      expect(slack.ok).toBe(false);
      expect(slack.detail).toMatch(/unset/);
    } else {
      expect(typeof slack.ok).toBe("boolean");
    }

    expect(wa.ok).toBe(false);
    expect(wa.error).toBe("whatsapp_stub");
  });
});
