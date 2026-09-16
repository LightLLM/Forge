import type { ChannelHealth, ChannelKind, OutboundMessage } from "../types.js";

export interface ChannelAdapter {
  readonly name: ChannelKind;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(message: OutboundMessage): Promise<void>;
  health(): Promise<ChannelHealth>;
}

export type InboundHandler = (input: {
  channel: ChannelKind;
  externalConversationId: string;
  externalUserId: string;
  displayName?: string;
  text: string;
  externalMessageId?: string;
}) => Promise<void>;
