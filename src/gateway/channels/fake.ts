import type { ChannelHealth, ChannelKind, OutboundMessage } from "../types.js";
import type { ChannelAdapter, InboundHandler } from "./types.js";

/**
 * Fake channel for CI — no network. Records outbound messages.
 */
export class FakeChannelAdapter implements ChannelAdapter {
  readonly name: ChannelKind = "fake";
  readonly sent: OutboundMessage[] = [];
  private handler: InboundHandler | null = null;
  private running = false;
  private lastMessageAt: string | null = null;

  onInbound(handler: InboundHandler): void {
    this.handler = handler;
  }

  async start(): Promise<void> {
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  async send(message: OutboundMessage): Promise<void> {
    this.sent.push(message);
    this.lastMessageAt = new Date().toISOString();
  }

  async health(): Promise<ChannelHealth> {
    return {
      name: this.name,
      status: this.running ? "connected" : "disabled",
      lastMessageAt: this.lastMessageAt,
      lastError: null,
    };
  }

  /** Simulate a user message for tests. */
  async simulateUser(input: {
    externalConversationId: string;
    externalUserId: string;
    text: string;
    displayName?: string;
  }): Promise<void> {
    if (!this.handler) throw new Error("Fake channel has no inbound handler");
    this.lastMessageAt = new Date().toISOString();
    await this.handler({
      channel: "fake",
      externalConversationId: input.externalConversationId,
      externalUserId: input.externalUserId,
      displayName: input.displayName,
      text: input.text,
    });
  }
}
