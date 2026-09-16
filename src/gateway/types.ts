import { z } from "zod";

/** Interaction channel / transport identity. */
export type ChannelKind = "web" | "api" | "telegram" | "slack" | "whatsapp" | "fake";

export type ChatMode = "ask" | "plan" | "build" | "debug" | "review";

export type NotificationLevel = "minimal" | "normal" | "verbose";

export const ChatModeSchema = z.enum(["ask", "plan", "build", "debug", "review"]);

export interface MessageContent {
  type: "text" | "markdown";
  text: string;
}

export interface AttachmentMeta {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  /** Workspace-relative path after safe intake — never absolute attacker paths. */
  storedPath?: string;
}

export interface GatewayMessage {
  id: string;
  channel: ChannelKind;
  sessionId: string;
  role: "user" | "assistant" | "system" | "event";
  externalConversationId?: string;
  externalUserId?: string;
  content: MessageContent;
  attachments?: AttachmentMeta[];
  mode?: ChatMode;
  timestamp: string;
}

export interface InteractionSession {
  id: string;
  projectId: string;
  workspacePath: string;
  channel: ChannelKind;
  interfaceLabel: string;
  externalConversationId: string | null;
  externalUserId: string | null;
  activeGoalId: string | null;
  activeTaskId: string | null;
  routingMode: "local-only" | "local-preferred" | "cloud-allowed";
  chatMode: ChatMode;
  notificationLevel: NotificationLevel;
  title: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export type ForgeGatewayEventType =
  | "session.created"
  | "session.updated"
  | "message.created"
  | "agent.started"
  | "agent.thinking"
  | "model.selected"
  | "tool.requested"
  | "tool.allowed"
  | "tool.denied"
  | "tool.started"
  | "tool.completed"
  | "file.changed"
  | "verification.started"
  | "verification.completed"
  | "repair.started"
  | "escalation.started"
  | "approval.requested"
  | "task.completed"
  | "task.failed"
  | "goal.completed"
  | "pairing.requested"
  | "channel.status"
  | "system.status";

export interface ForgeGatewayEvent {
  id: string;
  type: ForgeGatewayEventType;
  sessionId?: string;
  taskId?: string;
  goalId?: string;
  channel?: ChannelKind;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface OutboundMessage {
  channel: ChannelKind;
  externalConversationId: string;
  text: string;
  replyToExternalId?: string;
  parseMode?: "text" | "markdown";
}

export interface ChannelHealth {
  name: string;
  status: "disabled" | "disconnected" | "connecting" | "connected" | "error";
  lastMessageAt: string | null;
  lastError: string | null;
  detail?: string;
}

export type ChannelPermission =
  | "tasks"
  | "status"
  | "approvals"
  | "chat"
  | "full_operator"
  | "collaboration";

export interface ChannelPolicy {
  channel: ChannelKind;
  enabled: boolean;
  permissions: ChannelPermission[];
  notificationLevel: NotificationLevel;
}

export interface PairingRequest {
  id: string;
  channel: ChannelKind;
  externalUserId: string;
  displayName: string | null;
  code: string;
  status: "pending" | "approved" | "denied" | "expired";
  createdAt: string;
  resolvedAt: string | null;
  expiresAt: string;
}

export interface AuthorizedIdentity {
  id: string;
  channel: ChannelKind;
  /** Platform-stable user id — never display name as authority. */
  externalUserId: string;
  displayName: string | null;
  permissions: ChannelPermission[];
  createdAt: string;
}

export const CreateSessionInputSchema = z.object({
  workspacePath: z.string().min(1),
  channel: z
    .enum(["web", "api", "telegram", "slack", "whatsapp", "fake"])
    .default("web"),
  title: z.string().optional(),
  chatMode: ChatModeSchema.default("build"),
  routingMode: z
    .enum(["local-only", "local-preferred", "cloud-allowed"])
    .optional(),
  externalConversationId: z.string().optional(),
  externalUserId: z.string().optional(),
});

export const PostMessageInputSchema = z.object({
  content: z.string().min(1).max(100_000),
  mode: ChatModeSchema.optional(),
  attachments: z
    .array(
      z.object({
        name: z.string(),
        mimeType: z.string(),
        sizeBytes: z.number().int().nonnegative(),
        /** Base64 for small attachments only; large uploads rejected. */
        dataBase64: z.string().optional(),
      }),
    )
    .optional(),
});
