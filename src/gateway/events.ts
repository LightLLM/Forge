import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { ForgeGatewayEvent, ForgeGatewayEventType } from "./types.js";

/**
 * In-process event bus shared by Gateway API, SSE, and channel adapters.
 * Does not replace SQLite audit events — it fans out live UI/channel notifications.
 */
export class GatewayEventBus {
  private readonly emitter = new EventEmitter();
  private readonly recent: ForgeGatewayEvent[] = [];
  private readonly maxRecent: number;

  constructor(maxRecent = 500) {
    this.maxRecent = maxRecent;
    this.emitter.setMaxListeners(100);
  }

  publish(
    type: ForgeGatewayEventType,
    payload: Record<string, unknown> = {},
    meta: Partial<Pick<ForgeGatewayEvent, "sessionId" | "taskId" | "goalId" | "channel">> = {},
  ): ForgeGatewayEvent {
    const event: ForgeGatewayEvent = {
      id: randomUUID(),
      type,
      payload,
      timestamp: new Date().toISOString(),
      ...meta,
    };
    this.recent.push(event);
    if (this.recent.length > this.maxRecent) {
      this.recent.splice(0, this.recent.length - this.maxRecent);
    }
    this.emitter.emit("event", event);
    return event;
  }

  subscribe(listener: (event: ForgeGatewayEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }

  history(filter?: {
    sessionId?: string;
    types?: ForgeGatewayEventType[];
    since?: string;
    limit?: number;
  }): ForgeGatewayEvent[] {
    let items = [...this.recent];
    if (filter?.sessionId) {
      items = items.filter((e) => e.sessionId === filter.sessionId);
    }
    if (filter?.types?.length) {
      const set = new Set(filter.types);
      items = items.filter((e) => set.has(e.type));
    }
    if (filter?.since) {
      items = items.filter((e) => e.timestamp >= filter.since!);
    }
    const limit = filter?.limit ?? 100;
    return items.slice(-limit);
  }
}

/** Filter which live events should surface on a messaging channel. */
export function filterEventsForChannel(
  event: ForgeGatewayEvent,
  level: "minimal" | "normal" | "verbose",
): boolean {
  if (level === "verbose") return true;
  const important: ForgeGatewayEventType[] = [
    "approval.requested",
    "task.completed",
    "task.failed",
    "goal.completed",
    "verification.completed",
    "escalation.started",
    "pairing.requested",
    "system.status",
  ];
  if (level === "minimal") {
    return (
      event.type === "approval.requested" ||
      event.type === "task.completed" ||
      event.type === "task.failed" ||
      event.type === "goal.completed"
    );
  }
  return important.includes(event.type);
}
