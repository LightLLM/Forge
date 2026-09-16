import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  AuthorizedIdentity,
  ChannelKind,
  ChannelPermission,
  ChatMode,
  GatewayMessage,
  InteractionSession,
  NotificationLevel,
  PairingRequest,
} from "./types.js";

/**
 * Interaction sessions + messages + pairing identities.
 * Distinct from engineering memory SessionRecord.
 */
export class InteractionSessionStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
  }

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS interaction_sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        channel TEXT NOT NULL,
        interface_label TEXT NOT NULL,
        external_conversation_id TEXT,
        external_user_id TEXT,
        active_goal_id TEXT,
        active_task_id TEXT,
        routing_mode TEXT NOT NULL,
        chat_mode TEXT NOT NULL,
        notification_level TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        closed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_ix_sessions_ext
        ON interaction_sessions(channel, external_conversation_id);
      CREATE TABLE IF NOT EXISTS gateway_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        role TEXT NOT NULL,
        external_conversation_id TEXT,
        external_user_id TEXT,
        content_type TEXT NOT NULL,
        content_text TEXT NOT NULL,
        attachments_json TEXT,
        mode TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_gw_messages_session
        ON gateway_messages(session_id, created_at);
      CREATE TABLE IF NOT EXISTS gateway_pairings (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        external_user_id TEXT NOT NULL,
        display_name TEXT,
        code TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        resolved_at TEXT,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS gateway_identities (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        external_user_id TEXT NOT NULL,
        display_name TEXT,
        permissions_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(channel, external_user_id)
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  createSession(input: {
    projectId: string;
    workspacePath: string;
    channel: ChannelKind;
    title?: string;
    chatMode?: ChatMode;
    routingMode?: InteractionSession["routingMode"];
    notificationLevel?: NotificationLevel;
    externalConversationId?: string;
    externalUserId?: string;
  }): InteractionSession {
    const now = new Date().toISOString();
    const record: InteractionSession = {
      id: randomUUID(),
      projectId: input.projectId,
      workspacePath: input.workspacePath,
      channel: input.channel,
      interfaceLabel: input.channel,
      externalConversationId: input.externalConversationId ?? null,
      externalUserId: input.externalUserId ?? null,
      activeGoalId: null,
      activeTaskId: null,
      routingMode: input.routingMode ?? "local-preferred",
      chatMode: input.chatMode ?? "build",
      notificationLevel: input.notificationLevel ?? "normal",
      title: input.title ?? `Session ${now.slice(11, 19)}`,
      createdAt: now,
      updatedAt: now,
      closedAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO interaction_sessions (
          id, project_id, workspace_path, channel, interface_label,
          external_conversation_id, external_user_id, active_goal_id, active_task_id,
          routing_mode, chat_mode, notification_level, title, created_at, updated_at, closed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.projectId,
        record.workspacePath,
        record.channel,
        record.interfaceLabel,
        record.externalConversationId,
        record.externalUserId,
        record.activeGoalId,
        record.activeTaskId,
        record.routingMode,
        record.chatMode,
        record.notificationLevel,
        record.title,
        record.createdAt,
        record.updatedAt,
        record.closedAt,
      );
    return record;
  }

  getSession(id: string): InteractionSession | null {
    const row = this.db
      .prepare(`SELECT * FROM interaction_sessions WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapSession(row) : null;
  }

  findByExternal(
    channel: ChannelKind,
    externalConversationId: string,
  ): InteractionSession | null {
    const row = this.db
      .prepare(
        `SELECT * FROM interaction_sessions
         WHERE channel = ? AND external_conversation_id = ? AND closed_at IS NULL
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(channel, externalConversationId) as Record<string, unknown> | undefined;
    return row ? mapSession(row) : null;
  }

  listSessions(limit = 50): InteractionSession[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM interaction_sessions
           WHERE closed_at IS NULL
           ORDER BY updated_at DESC LIMIT ?`,
        )
        .all(limit) as Record<string, unknown>[]
    ).map(mapSession);
  }

  updateSession(
    id: string,
    patch: Partial<
      Pick<
        InteractionSession,
        | "activeGoalId"
        | "activeTaskId"
        | "chatMode"
        | "routingMode"
        | "notificationLevel"
        | "title"
      >
    >,
  ): InteractionSession {
    const current = this.getSession(id);
    if (!current) throw new Error(`Session not found: ${id}`);
    const updated: InteractionSession = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `UPDATE interaction_sessions SET
          active_goal_id = ?, active_task_id = ?, chat_mode = ?, routing_mode = ?,
          notification_level = ?, title = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        updated.activeGoalId,
        updated.activeTaskId,
        updated.chatMode,
        updated.routingMode,
        updated.notificationLevel,
        updated.title,
        updated.updatedAt,
        id,
      );
    return updated;
  }

  appendMessage(msg: Omit<GatewayMessage, "id" | "timestamp"> & { id?: string; timestamp?: string }): GatewayMessage {
    const record: GatewayMessage = {
      id: msg.id ?? randomUUID(),
      channel: msg.channel,
      sessionId: msg.sessionId,
      role: msg.role,
      externalConversationId: msg.externalConversationId,
      externalUserId: msg.externalUserId,
      content: msg.content,
      attachments: msg.attachments,
      mode: msg.mode,
      timestamp: msg.timestamp ?? new Date().toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO gateway_messages (
          id, session_id, channel, role, external_conversation_id, external_user_id,
          content_type, content_text, attachments_json, mode, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.sessionId,
        record.channel,
        record.role,
        record.externalConversationId ?? null,
        record.externalUserId ?? null,
        record.content.type,
        record.content.text,
        JSON.stringify(record.attachments ?? []),
        record.mode ?? null,
        record.timestamp,
      );
    this.db
      .prepare(`UPDATE interaction_sessions SET updated_at = ? WHERE id = ?`)
      .run(record.timestamp, record.sessionId);
    return record;
  }

  listMessages(sessionId: string, limit = 200): GatewayMessage[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM gateway_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?`,
        )
        .all(sessionId, limit) as Record<string, unknown>[]
    ).map(mapMessage);
  }

  createPairing(input: {
    channel: ChannelKind;
    externalUserId: string;
    displayName?: string | null;
  }): PairingRequest {
    const now = Date.now();
    const record: PairingRequest = {
      id: randomUUID(),
      channel: input.channel,
      externalUserId: input.externalUserId,
      displayName: input.displayName ?? null,
      code: makePairingCode(),
      status: "pending",
      createdAt: new Date(now).toISOString(),
      resolvedAt: null,
      expiresAt: new Date(now + 15 * 60_000).toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO gateway_pairings (
          id, channel, external_user_id, display_name, code, status, created_at, resolved_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.channel,
        record.externalUserId,
        record.displayName,
        record.code,
        record.status,
        record.createdAt,
        record.resolvedAt,
        record.expiresAt,
      );
    return record;
  }

  getPairing(id: string): PairingRequest | null {
    const row = this.db
      .prepare(`SELECT * FROM gateway_pairings WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapPairing(row) : null;
  }

  listPendingPairings(): PairingRequest[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM gateway_pairings WHERE status = 'pending' ORDER BY created_at DESC`,
        )
        .all() as Record<string, unknown>[]
    ).map(mapPairing);
  }

  resolvePairing(
    id: string,
    decision: "approved" | "denied",
    permissions: ChannelPermission[] = ["tasks", "status", "approvals", "chat"],
  ): PairingRequest {
    const current = this.getPairing(id);
    if (!current) throw new Error(`Pairing not found: ${id}`);
    if (current.status !== "pending") throw new Error(`Pairing already ${current.status}`);
    if (current.expiresAt < new Date().toISOString()) {
      this.db
        .prepare(`UPDATE gateway_pairings SET status = 'expired', resolved_at = ? WHERE id = ?`)
        .run(new Date().toISOString(), id);
      throw new Error("Pairing code expired");
    }
    const resolvedAt = new Date().toISOString();
    this.db
      .prepare(`UPDATE gateway_pairings SET status = ?, resolved_at = ? WHERE id = ?`)
      .run(decision, resolvedAt, id);
    if (decision === "approved") {
      this.upsertIdentity({
        channel: current.channel,
        externalUserId: current.externalUserId,
        displayName: current.displayName,
        permissions,
      });
    }
    return this.getPairing(id)!;
  }

  upsertIdentity(input: {
    channel: ChannelKind;
    externalUserId: string;
    displayName?: string | null;
    permissions: ChannelPermission[];
  }): AuthorizedIdentity {
    const existing = this.getIdentity(input.channel, input.externalUserId);
    if (existing) {
      this.db
        .prepare(
          `UPDATE gateway_identities SET display_name = ?, permissions_json = ? WHERE id = ?`,
        )
        .run(input.displayName ?? existing.displayName, JSON.stringify(input.permissions), existing.id);
      return this.getIdentity(input.channel, input.externalUserId)!;
    }
    const record: AuthorizedIdentity = {
      id: randomUUID(),
      channel: input.channel,
      externalUserId: input.externalUserId,
      displayName: input.displayName ?? null,
      permissions: input.permissions,
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO gateway_identities (id, channel, external_user_id, display_name, permissions_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.channel,
        record.externalUserId,
        record.displayName,
        JSON.stringify(record.permissions),
        record.createdAt,
      );
    return record;
  }

  getIdentity(channel: ChannelKind, externalUserId: string): AuthorizedIdentity | null {
    const row = this.db
      .prepare(
        `SELECT * FROM gateway_identities WHERE channel = ? AND external_user_id = ?`,
      )
      .get(channel, externalUserId) as Record<string, unknown> | undefined;
    return row ? mapIdentity(row) : null;
  }

  listIdentities(channel?: ChannelKind): AuthorizedIdentity[] {
    if (channel) {
      return (
        this.db
          .prepare(`SELECT * FROM gateway_identities WHERE channel = ? ORDER BY created_at`)
          .all(channel) as Record<string, unknown>[]
      ).map(mapIdentity);
    }
    return (
      this.db
        .prepare(`SELECT * FROM gateway_identities ORDER BY created_at`)
        .all() as Record<string, unknown>[]
    ).map(mapIdentity);
  }

  isAuthorized(
    channel: ChannelKind,
    externalUserId: string,
    permission: ChannelPermission,
  ): boolean {
    // Web / API on localhost are operator surfaces.
    if (channel === "web" || channel === "api") return true;
    const identity = this.getIdentity(channel, externalUserId);
    if (!identity) return false;
    return (
      identity.permissions.includes("full_operator") ||
      identity.permissions.includes(permission)
    );
  }
}

function makePairingCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i++) {
    if (i === 4) out += "-";
    out += alphabet[Math.floor(Math.random() * alphabet.length)]!;
  }
  return out;
}

function mapSession(row: Record<string, unknown>): InteractionSession {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    workspacePath: String(row.workspace_path),
    channel: row.channel as ChannelKind,
    interfaceLabel: String(row.interface_label),
    externalConversationId: (row.external_conversation_id as string | null) ?? null,
    externalUserId: (row.external_user_id as string | null) ?? null,
    activeGoalId: (row.active_goal_id as string | null) ?? null,
    activeTaskId: (row.active_task_id as string | null) ?? null,
    routingMode: row.routing_mode as InteractionSession["routingMode"],
    chatMode: row.chat_mode as ChatMode,
    notificationLevel: row.notification_level as NotificationLevel,
    title: String(row.title),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    closedAt: (row.closed_at as string | null) ?? null,
  };
}

function mapMessage(row: Record<string, unknown>): GatewayMessage {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    channel: row.channel as ChannelKind,
    role: row.role as GatewayMessage["role"],
    externalConversationId: (row.external_conversation_id as string | undefined) ?? undefined,
    externalUserId: (row.external_user_id as string | undefined) ?? undefined,
    content: {
      type: (row.content_type as "text" | "markdown") ?? "text",
      text: String(row.content_text),
    },
    attachments: JSON.parse(String(row.attachments_json || "[]")) as GatewayMessage["attachments"],
    mode: (row.mode as ChatMode | null) ?? undefined,
    timestamp: String(row.created_at),
  };
}

function mapPairing(row: Record<string, unknown>): PairingRequest {
  return {
    id: String(row.id),
    channel: row.channel as ChannelKind,
    externalUserId: String(row.external_user_id),
    displayName: (row.display_name as string | null) ?? null,
    code: String(row.code),
    status: row.status as PairingRequest["status"],
    createdAt: String(row.created_at),
    resolvedAt: (row.resolved_at as string | null) ?? null,
    expiresAt: String(row.expires_at),
  };
}

function mapIdentity(row: Record<string, unknown>): AuthorizedIdentity {
  return {
    id: String(row.id),
    channel: row.channel as ChannelKind,
    externalUserId: String(row.external_user_id),
    displayName: (row.display_name as string | null) ?? null,
    permissions: JSON.parse(String(row.permissions_json)) as ChannelPermission[],
    createdAt: String(row.created_at),
  };
}
