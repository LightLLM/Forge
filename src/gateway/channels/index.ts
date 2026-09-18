import type { ChannelHealth, ChannelKind, OutboundMessage } from "../types.js";
import type { ChannelAdapter, ChannelProbeResult, InboundHandler } from "./types.js";
import { FakeChannelAdapter } from "./fake.js";
import { TelegramAdapter } from "./telegram.js";
import { SlackAdapter } from "./slack.js";
import { WhatsAppAdapter } from "./whatsapp.js";

export class ChannelManager {
  readonly fake: FakeChannelAdapter;
  readonly telegram: TelegramAdapter;
  readonly slack: SlackAdapter;
  readonly whatsapp: WhatsAppAdapter;
  private readonly adapters: ChannelAdapter[];

  constructor(env: {
    telegramToken?: string | null;
    slackBotToken?: string | null;
    slackSigningSecret?: string | null;
    whatsappToken?: string | null;
  } = {}) {
    this.fake = new FakeChannelAdapter();
    this.telegram = new TelegramAdapter(
      env.telegramToken ?? process.env.TELEGRAM_BOT_TOKEN ?? null,
    );
    this.slack = new SlackAdapter(
      env.slackBotToken ?? process.env.SLACK_BOT_TOKEN ?? null,
      env.slackSigningSecret ?? process.env.SLACK_SIGNING_SECRET ?? null,
    );
    this.whatsapp = new WhatsAppAdapter(
      env.whatsappToken ?? process.env.WHATSAPP_ACCESS_TOKEN ?? null,
    );
    this.adapters = [this.fake, this.telegram, this.slack, this.whatsapp];
  }

  setInboundHandler(handler: InboundHandler): void {
    this.fake.onInbound(handler);
    this.telegram.onInbound(handler);
    this.slack.onInbound(handler);
  }

  async startAll(): Promise<void> {
    for (const a of this.adapters) {
      await a.start();
    }
  }

  async stopAll(): Promise<void> {
    for (const a of this.adapters) {
      await a.stop();
    }
  }

  async send(message: OutboundMessage): Promise<void> {
    const adapter = this.adapters.find((a) => a.name === message.channel);
    if (!adapter) throw new Error(`Unknown channel: ${message.channel}`);
    await adapter.send(message);
  }

  async health(): Promise<ChannelHealth[]> {
    return Promise.all(this.adapters.map((a) => a.health()));
  }

  async probeAll(): Promise<ChannelProbeResult[]> {
    const results: ChannelProbeResult[] = [];
    for (const a of this.adapters) {
      if (a.name === "fake") {
        results.push({
          name: "fake",
          ok: true,
          status: "connected",
          detail: "CI fake channel (no network)",
          error: null,
          identity: "fake",
        });
        continue;
      }
      if (typeof a.probe === "function") {
        results.push(await a.probe());
      } else {
        const h = await a.health();
        results.push({
          name: a.name,
          ok: h.status === "connected",
          status: h.status,
          detail: h.detail ?? h.status,
          error: h.lastError,
          identity: null,
        });
      }
    }
    return results;
  }

  get(name: ChannelKind): ChannelAdapter | undefined {
    return this.adapters.find((a) => a.name === name);
  }
}

export type { ChannelAdapter, ChannelProbeResult, InboundHandler } from "./types.js";
export { FakeChannelAdapter } from "./fake.js";
export { TelegramAdapter } from "./telegram.js";
export { SlackAdapter } from "./slack.js";
export { WhatsAppAdapter } from "./whatsapp.js";
