import type { ChannelHealth, ChannelKind, OutboundMessage } from "../types.js";
import type { ChannelAdapter, ChannelProbeResult } from "./types.js";

/**
 * WhatsApp stub — same ChannelAdapter surface; production must use official Cloud API.
 * Never couples Forge core to unofficial reverse-engineered clients.
 */
export class WhatsAppAdapter implements ChannelAdapter {
  readonly name: ChannelKind = "whatsapp";

  constructor(private readonly accessToken: string | null) {}

  async start(): Promise<void> {
    /* intentionally no-op until Cloud API wired */
  }

  async stop(): Promise<void> {
    /* no-op */
  }

  async send(_message: OutboundMessage): Promise<void> {
    throw new Error(
      "WhatsApp adapter is a stub. Configure official WhatsApp Cloud API before enabling.",
    );
  }

  async health(): Promise<ChannelHealth> {
    return {
      name: this.name,
      status: "disabled",
      lastMessageAt: null,
      lastError: null,
      detail: this.accessToken
        ? "token present but adapter stubbed (GW-4)"
        : "token unset; adapter stubbed",
    };
  }

  async probe(): Promise<ChannelProbeResult> {
    return {
      name: this.name,
      ok: false,
      status: "disabled",
      detail: this.accessToken
        ? "WHATSAPP_ACCESS_TOKEN set but Cloud API adapter not implemented"
        : "WhatsApp stub — set Cloud API credentials after GW-4 implementation",
      error: "whatsapp_stub",
      identity: null,
    };
  }
}
