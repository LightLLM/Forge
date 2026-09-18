export type {
  ChannelKind,
  ChatMode,
  GatewayMessage,
  InteractionSession,
  ForgeGatewayEvent,
  OutboundMessage,
  ChannelHealth,
  PairingRequest,
  AuthorizedIdentity,
} from "./types.js";
export {
  CreateSessionInputSchema,
  PostMessageInputSchema,
  ChatModeSchema,
} from "./types.js";
export { GatewayEventBus, filterEventsForChannel } from "./events.js";
export { InteractionSessionStore } from "./sessions.js";
export { TraceStore } from "./trace-store.js";
export type { ModelTraceRecord, AppLogRecord } from "./trace-store.js";
export { GatewayControlPlane } from "./control-plane.js";
export {
  ChannelManager,
  FakeChannelAdapter,
  TelegramAdapter,
  SlackAdapter,
  WhatsAppAdapter,
} from "./channels/index.js";
export type { ChannelAdapter, ChannelProbeResult } from "./channels/index.js";

// GatewayServer exported from server.ts once implemented
export { GatewayServer } from "./server.js";
export type { GatewayServerOptions, GatewayHandle } from "./server.js";
