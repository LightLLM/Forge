import type { ChannelHealth, ChannelKind, OutboundMessage } from "../types.js";
import type { ChannelAdapter, ChannelProbeResult, InboundHandler } from "./types.js";

/**
 * Telegram adapter — polling when TELEGRAM_BOT_TOKEN is set.
 * Without a token, adapter stays disabled (CI-safe).
 */
export class TelegramAdapter implements ChannelAdapter {
  readonly name: ChannelKind = "telegram";
  private handler: InboundHandler | null = null;
  private running = false;
  private offset = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastMessageAt: string | null = null;
  private lastError: string | null = null;
  private lastProbe: ChannelProbeResult | null = null;

  constructor(private readonly token: string | null) {}

  onInbound(handler: InboundHandler): void {
    this.handler = handler;
  }

  async start(): Promise<void> {
    if (!this.token) {
      this.running = false;
      return;
    }
    this.running = true;
    this.timer = setInterval(() => {
      void this.poll().catch((err) => {
        this.lastError = err instanceof Error ? err.message : String(err);
      });
    }, 2000);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async send(message: OutboundMessage): Promise<void> {
    if (!this.token) throw new Error("Telegram not configured");
    const res = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: message.externalConversationId,
        text: message.text.slice(0, 4000),
      }),
    });
    if (!res.ok) {
      throw new Error(`Telegram send failed: ${res.status}`);
    }
    this.lastMessageAt = new Date().toISOString();
  }

  async health(): Promise<ChannelHealth> {
    return {
      name: this.name,
      status: !this.token
        ? "disabled"
        : this.lastProbe && !this.lastProbe.ok
          ? "error"
          : this.running
            ? "connected"
            : "disconnected",
      lastMessageAt: this.lastMessageAt,
      lastError: this.lastError ?? this.lastProbe?.error ?? null,
      detail: this.lastProbe?.detail
        ?? (this.token ? "token configured" : "token unset"),
    };
  }

  /** Live check via Telegram getMe (does not send messages). */
  async probe(): Promise<ChannelProbeResult> {
    if (!this.token) {
      this.lastProbe = {
        name: this.name,
        ok: false,
        status: "disabled",
        detail: "TELEGRAM_BOT_TOKEN unset",
        error: null,
        identity: null,
      };
      return this.lastProbe;
    }
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.token}/getMe`, {
        signal: AbortSignal.timeout(10_000),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        description?: string;
        result?: { username?: string; id?: number; is_bot?: boolean };
      };
      if (!res.ok || !data.ok || !data.result) {
        const err = data.description ?? `HTTP ${res.status}`;
        this.lastError = err;
        this.lastProbe = {
          name: this.name,
          ok: false,
          status: "error",
          detail: "getMe failed",
          error: err,
          identity: null,
        };
        return this.lastProbe;
      }
      const username = data.result.username
        ? `@${data.result.username}`
        : `id:${data.result.id}`;
      this.lastError = null;
      this.lastProbe = {
        name: this.name,
        ok: true,
        status: this.running ? "connected" : "disconnected",
        detail: `getMe ok · ${username}`,
        error: null,
        identity: username,
      };
      return this.lastProbe;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastError = message;
      this.lastProbe = {
        name: this.name,
        ok: false,
        status: "error",
        detail: "getMe network error",
        error: message,
        identity: null,
      };
      return this.lastProbe;
    }
  }

  private async poll(): Promise<void> {
    if (!this.token || !this.handler || !this.running) return;
    const url = `https://api.telegram.org/bot${this.token}/getUpdates?timeout=0&offset=${this.offset}`;
    const res = await fetch(url);
    if (!res.ok) {
      this.lastError = `poll ${res.status}`;
      return;
    }
    const data = (await res.json()) as {
      ok: boolean;
      result: Array<{
        update_id: number;
        message?: {
          message_id: number;
          text?: string;
          chat: { id: number };
          from?: { id: number; username?: string; first_name?: string };
        };
      }>;
    };
    for (const update of data.result ?? []) {
      this.offset = update.update_id + 1;
      const msg = update.message;
      if (!msg?.text || !msg.from) continue;
      this.lastMessageAt = new Date().toISOString();
      await this.handler({
        channel: "telegram",
        externalConversationId: String(msg.chat.id),
        externalUserId: String(msg.from.id),
        displayName: msg.from.username ?? msg.from.first_name,
        text: msg.text,
        externalMessageId: String(msg.message_id),
      });
    }
  }
}
