import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { basename, extname, join, normalize, resolve, sep } from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";
import type { PersistenceStore } from "../persistence/store.js";
import type { ResolvedConfig } from "../config/load.js";
import type { FakeModelProvider } from "../models/fake.js";
import { MemoryService } from "../memory/service.js";
import { SkillLoader, SkillRegistry } from "../skills/index.js";
import { InteractionSessionStore } from "./sessions.js";
import { TraceStore } from "./trace-store.js";
import { GatewayEventBus, filterEventsForChannel } from "./events.js";
import { GatewayControlPlane } from "./control-plane.js";
import { ChannelManager } from "./channels/index.js";
import {
  CreateSessionInputSchema,
  PostMessageInputSchema,
  type ChannelKind,
  type ChatMode,
} from "./types.js";
import { FORGE_GUI_HTML } from "./ui-html.js";
import { addLogSink } from "../telemetry/logger.js";
import {
  DEFAULT_COMMAND_ALLOWLIST,
  runAllowedCommand,
} from "../tools/repository.js";
import { z } from "zod";
import {
  ANALYSIS_CATALOG,
  JobScheduler,
  ScheduleStore,
  assertAnalysisId,
  runAnalysis,
  writeAnalysisArtifact,
  type AnalysisId,
} from "../jobs/index.js";
import { JobStore } from "../daemon/job-store.js";
import {
  listAgentPipelines,
  listAgentRoles,
} from "../agents/index.js";
import { getDaemonStatus } from "../daemon/daemon.js";

export interface GatewayServerOptions {
  store: PersistenceStore;
  config: ResolvedConfig;
  host?: string;
  port?: number;
  fakeProvider?: FakeModelProvider;
  publicDir?: string;
}

export interface GatewayHandle {
  server: Server;
  url: string;
  sessions: InteractionSessionStore;
  events: GatewayEventBus;
  channels: ChannelManager;
  controlPlane: GatewayControlPlane;
  traces: TraceStore;
  close: () => Promise<void>;
}

const MAX_BODY = 1_000_000;

export class GatewayServer {
  constructor(private readonly options: GatewayServerOptions) {}

  async start(): Promise<GatewayHandle> {
    const host = this.options.host ?? "127.0.0.1";
    const port = this.options.port ?? 8787;
    const { store, config } = this.options;

    const sessions = new InteractionSessionStore(config.dbPath);
    sessions.initialize();
    const traces = new TraceStore(sessions.database);
    traces.initialize();
    const removeLogSink = addLogSink((entry) => {
      if (entry.level !== "error" && entry.level !== "warn") return;
      traces.appendLog({
        level: entry.level,
        scope: entry.scope,
        message: entry.message,
        fields: entry.fields ?? null,
      });
    });
    const events = new GatewayEventBus();
    const controlPlane = new GatewayControlPlane({
      store,
      sessions,
      events,
      config,
      traces,
      fakeProvider: this.options.fakeProvider,
    });
    const channels = new ChannelManager();

    channels.setInboundHandler(async (inbound) => {
      const permissionNeeded =
        inbound.text.trim().startsWith("/") && inbound.text.startsWith("/approvals")
          ? "approvals"
          : "chat";
      if (!sessions.isAuthorized(inbound.channel, inbound.externalUserId, permissionNeeded)) {
        const pairing = sessions.createPairing({
          channel: inbound.channel,
          externalUserId: inbound.externalUserId,
          displayName: inbound.displayName ?? null,
        });
        events.publish(
          "pairing.requested",
          {
            pairingId: pairing.id,
            channel: inbound.channel,
            externalUserId: inbound.externalUserId,
            code: pairing.code,
          },
          { channel: inbound.channel },
        );
        await channels.send({
          channel: inbound.channel,
          externalConversationId: inbound.externalConversationId,
          text: `PAIRING REQUIRED\n\nCode:\n${pairing.code}\n\nApprove this identity in the Forge GUI (Gateway → Pairings).`,
        });
        return;
      }

      // Channel policy: refuse routing-mode escalation via chat text
      if (/local[_\s-]?only/i.test(inbound.text) && /cloud/i.test(inbound.text)) {
        await channels.send({
          channel: inbound.channel,
          externalConversationId: inbound.externalConversationId,
          text: "Denied: routing policy cannot be changed through chat. Use the operator GUI on localhost.",
        });
        return;
      }

      let session = sessions.findByExternal(
        inbound.channel,
        inbound.externalConversationId,
      );
      if (!session) {
        const project = store.upsertProject(
          config.workspacePath,
          basename(config.workspacePath),
        );
        session = sessions.createSession({
          projectId: project.id,
          workspacePath: config.workspacePath,
          channel: inbound.channel,
          externalConversationId: inbound.externalConversationId,
          externalUserId: inbound.externalUserId,
          routingMode: config.mode,
          title: `${inbound.channel}:${inbound.externalConversationId}`,
        });
        events.publish(
          "session.created",
          { sessionId: session.id },
          { sessionId: session.id, channel: inbound.channel },
        );
      }

      const result = await controlPlane.handleUserMessage({
        session,
        text: inbound.text,
        externalUserId: inbound.externalUserId,
      });

      const level = session.notificationLevel;
      // Always reply to the user message on messaging channels
      await channels.send({
        channel: inbound.channel,
        externalConversationId: inbound.externalConversationId,
        text: result.message.content.text.slice(0, 3500),
      });

      // Subscribe one-shot completion notifications for this session
      const unsub = events.subscribe((ev) => {
        if (ev.sessionId !== session!.id) return;
        if (!filterEventsForChannel(ev, level)) return;
        void channels
          .send({
            channel: inbound.channel,
            externalConversationId: inbound.externalConversationId,
            text: formatEventForChannel(ev.type, ev.payload),
          })
          .catch(() => undefined);
        if (ev.type === "task.completed" || ev.type === "task.failed") {
          unsub();
        }
      });
    });

    await channels.startAll();

    const server = createServer((req, res) => {
      void handleRequest(req, res, {
        store,
        config,
        sessions,
        events,
        controlPlane,
        channels,
        traces,
        publicDir: this.options.publicDir,
      }).catch((err) => {
        sendJson(res, 500, {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });

    await new Promise<void>((resolveListen, reject) => {
      server.listen(port, host, () => resolveListen());
      server.on("error", reject);
    });

    const addr = server.address();
    const actualPort =
      typeof addr === "object" && addr ? addr.port : port;
    const url = `http://${host}:${actualPort}`;

    events.publish("system.status", { url, host, port: actualPort });

    return {
      server,
      url,
      sessions,
      events,
      channels,
      controlPlane,
      traces,
      close: async () => {
        controlPlane.cancelAll();
        removeLogSink();
        await channels.stopAll();
        sessions.close();
        await new Promise<void>((resolveClose, reject) => {
          server.close((err) => (err ? reject(err) : resolveClose()));
        });
      },
    };
  }
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: {
    store: PersistenceStore;
    config: ResolvedConfig;
    sessions: InteractionSessionStore;
    events: GatewayEventBus;
    controlPlane: GatewayControlPlane;
    channels: ChannelManager;
    traces: TraceStore;
    publicDir?: string;
  },
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";
  const { store, config, sessions, events, controlPlane, channels, traces } = ctx;

  if (method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  // SSE
  if (method === "GET" && url.pathname === "/api/events/stream") {
    res.writeHead(200, {
      ...corsHeaders(),
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`: connected\n\n`);
    const sessionFilter = url.searchParams.get("sessionId") ?? undefined;
    const unsub = events.subscribe((event) => {
      if (sessionFilter && event.sessionId !== sessionFilter) return;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    const heartbeat = setInterval(() => {
      res.write(`: ping\n\n`);
    }, 15_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      unsub();
    });
    return;
  }

  if (method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(FORGE_GUI_HTML);
    return;
  }

  if (method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true, service: "forge-gateway" });
    return;
  }

  if (method === "GET" && url.pathname === "/api/system/status") {
    const channelHealth = await channels.health();
    sendJson(res, 200, {
      ok: true,
      node: process.versions.node,
      mode: config.mode,
      workspacePath: config.workspacePath,
      dbPath: config.dbPath,
      bindHint: "default 127.0.0.1",
      channels: channelHealth,
      openRouterConfigured: Boolean(config.openRouterApiKey),
      // never include secrets
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/sessions") {
    sendJson(res, 200, { sessions: sessions.listSessions() });
    return;
  }

  if (method === "POST" && url.pathname === "/api/sessions") {
    const body = await readJson(req);
    const parsed = CreateSessionInputSchema.safeParse(body);
    if (!parsed.success) {
      sendJson(res, 400, { error: parsed.error.flatten() });
      return;
    }
    const workspacePath = resolve(parsed.data.workspacePath);
    const project = store.upsertProject(workspacePath, basename(workspacePath));
    const session = sessions.createSession({
      projectId: project.id,
      workspacePath,
      channel: parsed.data.channel,
      title: parsed.data.title,
      chatMode: parsed.data.chatMode,
      routingMode: parsed.data.routingMode ?? config.mode,
      externalConversationId: parsed.data.externalConversationId,
      externalUserId: parsed.data.externalUserId,
    });
    events.publish(
      "session.created",
      { sessionId: session.id },
      { sessionId: session.id, channel: session.channel },
    );
    sendJson(res, 201, { session });
    return;
  }

  const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)(.*)$/);
  if (sessionMatch) {
    const sessionId = decodeURIComponent(sessionMatch[1]!);
    const rest = sessionMatch[2] || "";
    const session = sessions.getSession(sessionId);
    if (!session) {
      sendJson(res, 404, { error: "session not found" });
      return;
    }

    if (method === "GET" && rest === "") {
      sendJson(res, 200, { session });
      return;
    }
    if (method === "GET" && rest === "/messages") {
      sendJson(res, 200, { messages: sessions.listMessages(sessionId) });
      return;
    }
    if (method === "POST" && rest === "/messages") {
      const body = await readJson(req);
      const parsed = PostMessageInputSchema.safeParse(body);
      if (!parsed.success) {
        sendJson(res, 400, { error: parsed.error.flatten() });
        return;
      }
      if ((parsed.data.content?.length ?? 0) > 100_000) {
        sendJson(res, 413, { error: "message too large" });
        return;
      }
      try {
        const result = await controlPlane.handleUserMessage({
          session,
          text: parsed.data.content,
          mode: parsed.data.mode as ChatMode | undefined,
          attachments: parsed.data.attachments,
        });
        sendJson(res, 200, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = /too large|Too many|Invalid workspace/i.test(message)
          ? 413
          : 400;
        sendJson(res, status, { error: message });
      }
      return;
    }
    if (method === "PATCH" && rest === "") {
      const body = await readJson(req);
      const updated = sessions.updateSession(sessionId, {
        chatMode: body.chatMode as ChatMode | undefined,
        routingMode: body.routingMode as InteractionSessionRouting | undefined,
        title: typeof body.title === "string" ? body.title : undefined,
      });
      events.publish(
        "session.updated",
        { sessionId },
        { sessionId, channel: updated.channel },
      );
      sendJson(res, 200, { session: updated });
      return;
    }
  }

  if (method === "GET" && url.pathname === "/api/projects") {
    const list = sessions.listSessions().map((s) => ({
      id: s.projectId,
      path: s.workspacePath,
      name: basename(s.workspacePath),
    }));
    const uniq = [...new Map(list.map((p) => [p.path, p])).values()];
    sendJson(res, 200, { projects: uniq });
    return;
  }

  if (method === "GET" && url.pathname.startsWith("/api/tasks/")) {
    const id = url.pathname.slice("/api/tasks/".length);
    const task = store.getTask(id);
    if (!task) {
      sendJson(res, 404, { error: "task not found" });
      return;
    }
    sendJson(res, 200, {
      task,
      events: store.listEvents(id).slice(-100),
      approvals: store.listApprovals(id),
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/approvals") {
    sendJson(res, 200, { pending: store.listPendingApprovals() });
    return;
  }

  if (method === "POST" && url.pathname.match(/^\/api\/approvals\/[^/]+\/(approve|deny)$/)) {
    const parts = url.pathname.split("/");
    const id = parts[3]!;
    const action = parts[4] as "approve" | "deny";
    const existing = store.getApproval(id);
    if (!existing) {
      sendJson(res, 404, { error: "approval not found" });
      return;
    }
    if (existing.status !== "pending") {
      sendJson(res, 409, { error: `already ${existing.status}` });
      return;
    }
    const updated = store.resolveApproval(
      id,
      action === "approve" ? "approved" : "denied",
    );
    sendJson(res, 200, { approval: updated });
    return;
  }

  if (method === "GET" && url.pathname === "/api/pairings") {
    sendJson(res, 200, { pending: sessions.listPendingPairings() });
    return;
  }

  if (method === "POST" && url.pathname.match(/^\/api\/pairings\/[^/]+\/(approve|deny)$/)) {
    const parts = url.pathname.split("/");
    const id = parts[3]!;
    const action = parts[4] as "approve" | "deny";
    try {
      const updated = sessions.resolvePairing(
        id,
        action === "approve" ? "approved" : "denied",
      );
      sendJson(res, 200, { pairing: updated });
    } catch (err) {
      sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (method === "GET" && url.pathname === "/api/gateway/channels") {
    sendJson(res, 200, { channels: await channels.health() });
    return;
  }

  if (method === "POST" && url.pathname === "/api/gateway/channels/probe") {
    sendJson(res, 200, { probes: await channels.probeAll() });
    return;
  }

  if (method === "GET" && url.pathname === "/api/gateway/identities") {
    const channel = url.searchParams.get("channel") as ChannelKind | null;
    sendJson(res, 200, {
      identities: sessions.listIdentities(channel ?? undefined),
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/memory") {
    const q = url.searchParams.get("q") ?? "";
    try {
      const memory = new MemoryService(store);
      const hits = q ? memory.search(q, { limit: 20 }) : memory.list({ limit: 20 });
      sendJson(res, 200, { memories: hits });
    } catch {
      sendJson(res, 200, { memories: [] });
    }
    return;
  }

  if (method === "GET" && url.pathname === "/api/models") {
    sendJson(res, 200, {
      local: { provider: "ollama", model: config.local.model || null },
      cloud: {
        provider: "openrouter",
        model: config.cloud.model || null,
        configured: Boolean(config.openRouterApiKey),
      },
      routingMode: config.mode,
      adaptive: config.routing.adaptive,
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/skills") {
    try {
      const loaded = new SkillLoader().load(config.workspacePath, {
        includeBuiltin: true,
        extraPaths: config.skills.extraPaths,
      });
      const registry = new SkillRegistry(loaded);
      sendJson(res, 200, {
        skills: registry.list().map((s) => ({
          id: s.metadata.id,
          name: s.metadata.name,
          description: s.metadata.description,
          source: s.source,
        })),
      });
    } catch {
      sendJson(res, 200, { skills: [] });
    }
    return;
  }

  if (method === "GET" && url.pathname === "/api/tools") {
    try {
      const { loadToolPacks } = await import("../tools/packs.js");
      const tools = await loadToolPacks(
        config.workspacePath,
        config.tools.packs,
      );
      sendJson(res, 200, {
        packs: config.tools.packs,
        allowNetwork: config.tools.allowNetwork === true,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          risk: t.risk,
          networkGated: t.risk === "network",
        })),
      });
    } catch (err) {
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (method === "GET" && url.pathname === "/api/jobs/catalog") {
    sendJson(res, 200, { catalog: ANALYSIS_CATALOG });
    return;
  }

  if (method === "GET" && url.pathname === "/api/jobs/schedules") {
    const schedules = new ScheduleStore(config.dbPath);
    schedules.initialize();
    try {
      sendJson(res, 200, { schedules: schedules.list() });
    } finally {
      schedules.close();
    }
    return;
  }

  if (method === "POST" && url.pathname === "/api/jobs/schedules") {
    const body = await readJson(req);
    const parsed = z
      .object({
        analysisId: z.string().min(1),
        name: z.string().optional(),
        everyMs: z.number().int().positive().optional(),
        cron: z.string().optional(),
        paused: z.boolean().optional(),
      })
      .safeParse(body);
    if (!parsed.success) {
      sendJson(res, 400, { error: parsed.error.flatten() });
      return;
    }
    try {
      assertAnalysisId(parsed.data.analysisId);
      const analysisId = parsed.data.analysisId as AnalysisId;
      const def = ANALYSIS_CATALOG.find((a) => a.id === analysisId)!;
      const schedules = new ScheduleStore(config.dbPath);
      schedules.initialize();
      try {
        const schedule = schedules.create({
          name: parsed.data.name ?? def.name,
          analysisId,
          everyMs: parsed.data.everyMs ?? def.defaultEveryMs,
          cronExpr: parsed.data.cron ?? null,
          status: parsed.data.paused ? "paused" : "active",
        });
        sendJson(res, 201, { schedule });
      } finally {
        schedules.close();
      }
    } catch (err) {
      sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  const scheduleAction = url.pathname.match(
    /^\/api\/jobs\/schedules\/([^/]+)\/(pause|resume)$/,
  );
  if (method === "POST" && scheduleAction) {
    const id = decodeURIComponent(scheduleAction[1]!);
    const action = scheduleAction[2] as "pause" | "resume";
    const schedules = new ScheduleStore(config.dbPath);
    schedules.initialize();
    try {
      const updated = schedules.setStatus(
        id,
        action === "pause" ? "paused" : "active",
      );
      sendJson(res, 200, { schedule: updated });
    } catch (err) {
      sendJson(res, 404, {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      schedules.close();
    }
    return;
  }

  if (method === "POST" && url.pathname === "/api/jobs/run") {
    const body = await readJson(req);
    const parsed = z
      .object({
        analysisId: z.string().min(1),
        enqueue: z.boolean().optional(),
      })
      .safeParse(body);
    if (!parsed.success) {
      sendJson(res, 400, { error: parsed.error.flatten() });
      return;
    }
    try {
      assertAnalysisId(parsed.data.analysisId);
      const analysisId = parsed.data.analysisId as AnalysisId;
      if (parsed.data.enqueue) {
        const jobs = new JobStore(config.dbPath);
        jobs.initialize();
        const schedules = new ScheduleStore(config.dbPath);
        schedules.initialize();
        try {
          const scheduler = new JobScheduler({
            scheduleStore: schedules,
            jobStore: jobs,
          });
          const job = scheduler.enqueueNow(analysisId);
          sendJson(res, 202, {
            job,
            hint: "Start daemon to execute: forge daemon start",
          });
        } finally {
          jobs.close();
          schedules.close();
        }
        return;
      }
      const report = runAnalysis(analysisId, config.workspacePath);
      const artifact = writeAnalysisArtifact(config.workspacePath, report);
      sendJson(res, 200, { report, artifact });
    } catch (err) {
      sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (method === "GET" && url.pathname === "/api/jobs/daemon") {
    const status = getDaemonStatus(config.workspacePath);
    sendJson(res, 200, {
      daemon: {
        running: status.alive,
        alive: status.alive,
        state: status.state,
        counts: status.counts ?? null,
        maxWorkers: status.state?.maxWorkers ?? null,
        activeWorkers: status.state?.activeWorkers ?? null,
      },
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/agents/roles") {
    sendJson(res, 200, {
      roles: listAgentRoles().map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        allowedTools: r.allowedTools,
        permissions: r.permissions,
        modelPolicy: r.modelPolicy,
      })),
      agentsEnabled: config.agents.enabled,
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/agents/pipelines") {
    sendJson(res, 200, {
      pipelines: listAgentPipelines(),
      note: "BUILD uses phase roles sequentially; Goal mode runs DAG nodes in parallel workers. Hermes-style nested delegate_task is not enabled — keep policy auditable.",
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/events") {
    const sessionId = url.searchParams.get("sessionId") ?? undefined;
    const limit = Number(url.searchParams.get("limit") ?? 100);
    sendJson(res, 200, {
      events: events.history({ sessionId, limit }),
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/traces") {
    const limit = Number(url.searchParams.get("limit") ?? 100);
    sendJson(res, 200, {
      summary: traces.summarizeUsage(),
      traces: traces.listTraces(limit),
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/logs") {
    const level = url.searchParams.get("level") as
      | "debug"
      | "info"
      | "warn"
      | "error"
      | null;
    const limit = Number(url.searchParams.get("limit") ?? 100);
    sendJson(res, 200, {
      logs: traces.listLogs({
        level: level ?? undefined,
        limit,
      }),
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/terminal/allowlist") {
    const allowlist = [
      ...DEFAULT_COMMAND_ALLOWLIST,
      ...(config.commands.allowlist ?? []),
    ];
    sendJson(res, 200, { allowlist: [...new Set(allowlist)] });
    return;
  }

  if (method === "POST" && url.pathname === "/api/terminal/exec") {
    const body = await readJson(req);
    const parsed = z
      .object({ command: z.string().min(1).max(2000) })
      .safeParse(body);
    if (!parsed.success) {
      sendJson(res, 400, { error: parsed.error.flatten() });
      return;
    }
    const allowlist = [
      ...DEFAULT_COMMAND_ALLOWLIST,
      ...(config.commands.allowlist ?? []),
    ];
    const started = Date.now();
    try {
      const result = await runAllowedCommand(parsed.data.command, {
        workspace: { root: config.workspacePath },
        commandAllowlist: allowlist,
        commandTimeoutMs: config.limits.commandTimeoutMs,
        maxCommandOutputChars: config.limits.maxCommandOutputChars,
        sandbox: {
          mode: config.commands.sandbox === "docker" ? "docker" : "host",
          image: config.commands.dockerImage,
          networkDisabled: config.commands.dockerNetworkDisabled,
        },
      });
      events.publish("terminal.output", {
        command: parsed.data.command,
        exitCode: result.exitCode,
        stdout: result.stdout.slice(0, 8000),
        stderr: result.stderr.slice(0, 4000),
        timedOut: result.timedOut,
        latencyMs: Date.now() - started,
      });
      sendJson(res, 200, {
        ...result,
        latencyMs: Date.now() - started,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      traces.appendLog({
        level: "error",
        scope: "gateway:terminal",
        message,
        fields: { command: parsed.data.command },
      });
      events.publish("terminal.output", {
        command: parsed.data.command,
        error: message,
        latencyMs: Date.now() - started,
      });
      sendJson(res, 400, { error: message });
    }
    return;
  }

  if (method === "POST" && url.pathname === "/api/webhooks/slack") {
    const body = await readJson(req);
    const result = await channels.slack.handleEvent(body as never);
    sendJson(res, 200, result);
    return;
  }

  // Static files
  if (method === "GET" && ctx.publicDir) {
    const served = tryServeStatic(ctx.publicDir, url.pathname, res);
    if (served) return;
  }

  sendJson(res, 404, { error: "not found" });
}

type InteractionSessionRouting =
  | "local-only"
  | "local-preferred"
  | "cloud-allowed";

function formatEventForChannel(
  type: string,
  payload: Record<string, unknown>,
): string {
  if (type === "task.completed") {
    return `Task complete.\n${String(payload.summary ?? "")}`.trim();
  }
  if (type === "task.failed") {
    return `Task failed.\n${String(payload.error ?? payload.status ?? "")}`.trim();
  }
  if (type === "approval.requested") {
    return `Approval required: ${String(payload.action ?? payload.reason ?? type)}`;
  }
  if (type === "verification.completed") {
    return `Verification: ${String(payload.status ?? "done")}`;
  }
  return `${type}`;
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    ...corsHeaders(),
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(data);
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        resolvePromise({});
        return;
      }
      try {
        resolvePromise(
          JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
            string,
            unknown
          >,
        );
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function tryServeStatic(
  publicDir: string,
  pathname: string,
  res: ServerResponse,
): boolean {
  const root = resolve(publicDir);
  const rel = decodeURIComponent(pathname).replace(/^\/+/, "");
  if (rel.includes("\0") || rel.includes("..")) return false;
  const full = normalize(join(root, rel));
  if (!full.startsWith(root + sep) && full !== root) return false;
  if (!existsSync(full) || !statSync(full).isFile()) return false;
  const ext = extname(full);
  const types: Record<string, string> = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
  };
  res.writeHead(200, { "Content-Type": types[ext] ?? "application/octet-stream" });
  res.end(readFileSync(full));
  return true;
}
