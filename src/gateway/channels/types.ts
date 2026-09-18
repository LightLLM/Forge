import type { ChannelHealth, ChannelKind, OutboundMessage } from "../types.js";

export interface ChannelProbeResult {
  name: ChannelKind;
  ok: boolean;
  status: ChannelHealth["status"];
  detail: string;
  error: string | null;
  /** Non-secret identity hint (e.g. bot username). */
  identity?: string | null;
}

export interface ChannelAdapter {
  readonly name: ChannelKind;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(message: OutboundMessage): Promise<void>;
  health(): Promise<ChannelHealth>;
  /** Optional live credential/API check (Telegram getMe, Slack auth.test, …). */
  probe?(): Promise<ChannelProbeResult>;
}

export type InboundHandler = (input: {
  channel: ChannelKind;
  externalConversationId: string;
  externalUserId: string;
  displayName?: string;
  text: string;
  externalMessageId?: string;
}) => Promise<void>;
