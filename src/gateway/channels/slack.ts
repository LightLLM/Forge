import type { ChannelHealth, ChannelKind, OutboundMessage } from "../types.js";
import type { ChannelAdapter, InboundHandler } from "./types.js";

/**
 * Slack adapter via Events API webhook injection + chat.postMessage.
 * Without tokens, remains disabled. Webhooks are validated by shared secret when set.
 */
export class SlackAdapter implements ChannelAdapter {
  readonly name: ChannelKind = "slack";
  private handler: InboundHandler | null = null;
  private running = false;
  private lastMessageAt: string | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly botToken: string | null,
    private readonly signingSecret: string | null = null,
  ) {}

  onInbound(handler: InboundHandler): void {
    this.handler = handler;
  }

  async start(): Promise<void> {
    this.running = Boolean(this.botToken);
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  async send(message: OutboundMessage): Promise<void> {
    if (!this.botToken) throw new Error("Slack not configured");
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: message.externalConversationId,
        text: message.text.slice(0, 4000),
        thread_ts: message.replyToExternalId,
      }),
    });
    const data = (await res.json()) as { ok: boolean; error?: string };
    if (!data.ok) throw new Error(`Slack send failed: ${data.error ?? res.status}`);
    this.lastMessageAt = new Date().toISOString();
  }

  async health(): Promise<ChannelHealth> {
    return {
      name: this.name,
      status: !this.botToken ? "disabled" : this.running ? "connected" : "disconnected",
      lastMessageAt: this.lastMessageAt,
      lastError: this.lastError,
      detail: this.botToken ? "bot token configured" : "token unset",
    };
  }

  /** Called by Gateway HTTP webhook route after signature checks. */
  async handleEvent(body: {
    type?: string;
    challenge?: string;
    event?: {
      type?: string;
      user?: string;
      text?: string;
      channel?: string;
      thread_ts?: string;
      ts?: string;
      bot_id?: string;
    };
  }): Promise<{ challenge?: string } | { ok: true }> {
    if (body.type === "url_verification" && body.challenge) {
      return { challenge: body.challenge };
    }
    const event = body.event;
    if (!event || event.bot_id || event.type !== "message" || !event.text || !event.user) {
      return { ok: true };
    }
    if (!this.handler) return { ok: true };
    const conversationId = event.thread_ts
      ? `${event.channel}:${event.thread_ts}`
      : String(event.channel);
    this.lastMessageAt = new Date().toISOString();
    await this.handler({
      channel: "slack",
      externalConversationId: conversationId,
      externalUserId: event.user,
      text: event.text,
      externalMessageId: event.ts,
    });
    return { ok: true };
  }

  getSigningSecret(): string | null {
    return this.signingSecret;
  }
}
