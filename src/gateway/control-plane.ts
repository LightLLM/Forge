import { resolve } from "node:path";
import type { PersistenceStore } from "../persistence/store.js";
import type { ResolvedConfig } from "../config/load.js";
import { TaskOrchestrator } from "../agent/orchestrator.js";
import { OllamaProvider } from "../models/ollama.js";
import { OpenRouterProvider } from "../models/openrouter.js";
import { FakeModelProvider } from "../models/fake.js";
import { rootLogger } from "../telemetry/logger.js";
import type { ChatMode, GatewayMessage, InteractionSession } from "./types.js";
import type { GatewayEventBus } from "./events.js";
import type { InteractionSessionStore } from "./sessions.js";
import type { TraceStore } from "./trace-store.js";
import {
  formatAttachmentsForPrompt,
  intakeAttachments,
  type IncomingAttachment,
} from "./attachments.js";

export interface ControlPlaneDeps {
  store: PersistenceStore;
  sessions: InteractionSessionStore;
  events: GatewayEventBus;
  config: ResolvedConfig;
  traces?: TraceStore;
  fakeProvider?: FakeModelProvider;
}

/**
 * Bridges Gateway messages to Forge runtime without duplicating orchestrator logic.
 * Chat modes are enforced here (permissions), not by prompting the model alone.
 */
export class GatewayControlPlane {
  private readonly running = new Map<string, AbortController>();

  constructor(private readonly deps: ControlPlaneDeps) {}

  async handleUserMessage(input: {
    session: InteractionSession;
    text: string;
    mode?: ChatMode;
    externalUserId?: string;
    attachments?: IncomingAttachment[];
  }): Promise<{ message: GatewayMessage; taskId?: string }> {
    const mode = input.mode ?? input.session.chatMode;
    const attachmentMeta =
      input.attachments && input.attachments.length > 0
        ? intakeAttachments(input.session.workspacePath, input.attachments)
        : [];
    const text = formatAttachmentsForPrompt(input.text || "", attachmentMeta);
    this.deps.sessions.appendMessage({
      sessionId: input.session.id,
      channel: input.session.channel,
      role: "user",
      content: { type: "text", text },
      attachments: attachmentMeta,
      mode,
      externalUserId: input.externalUserId,
      externalConversationId: input.session.externalConversationId ?? undefined,
    });
    this.deps.events.publish(
      "message.created",
      { role: "user", text, mode },
      { sessionId: input.session.id, channel: input.session.channel },
    );

    if (text.trim().startsWith("/")) {
      const reply = await this.handleCommand(input.session, text.trim());
      const assistant = this.deps.sessions.appendMessage({
        sessionId: input.session.id,
        channel: input.session.channel,
        role: "assistant",
        content: { type: "markdown", text: reply },
      });
      this.deps.events.publish(
        "message.created",
        { role: "assistant", text: reply },
        { sessionId: input.session.id },
      );
      return { message: assistant };
    }

    if (mode === "ask" || mode === "plan" || mode === "review") {
      let reply: string;
      try {
        reply = await this.readOnlyModelReply(mode, text, input.session.id);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        this.deps.traces?.appendLog({
          level: "error",
          scope: "gateway:chat",
          message: detail,
          fields: { sessionId: input.session.id, mode },
        });
        this.deps.events.publish(
          "log.error",
          { message: detail, scope: "gateway:chat" },
          { sessionId: input.session.id },
        );
        reply = [
          this.readOnlyReply(mode, text),
          "",
          `_(Model call failed: ${detail})_`,
        ].join("\n");
      }
      const assistant = this.deps.sessions.appendMessage({
        sessionId: input.session.id,
        channel: input.session.channel,
        role: "assistant",
        content: { type: "markdown", text: reply },
        mode,
      });
      this.deps.events.publish(
        "message.created",
        { role: "assistant", text: reply, mode },
        { sessionId: input.session.id },
      );
      return { message: assistant };
    }

    const modelGap = this.modelConfigGap(input.session.routingMode);
    if (modelGap) {
      const assistant = this.deps.sessions.appendMessage({
        sessionId: input.session.id,
        channel: input.session.channel,
        role: "assistant",
        content: { type: "markdown", text: modelGap },
        mode,
      });
      this.deps.events.publish(
        "message.created",
        { role: "assistant", text: modelGap, mode },
        { sessionId: input.session.id },
      );
      return { message: assistant };
    }

    const objective = mode === "debug" ? `[DEBUG] ${text}` : text;
    const ack = this.deps.sessions.appendMessage({
      sessionId: input.session.id,
      channel: input.session.channel,
      role: "assistant",
      content: {
        type: "markdown",
        text: `Starting **${mode}** run.\n\nRouting: **${input.session.routingMode}**\n\nAnalyzing repository…`,
      },
      mode,
    });
    this.deps.events.publish(
      "agent.started",
      { mode, objective },
      { sessionId: input.session.id, channel: input.session.channel },
    );

    void this.runObjective(input.session.id, objective, input.session.workspacePath);
    return { message: ack };
  }

  /** Clear, immediate guidance when BUILD would otherwise hang on "Analyzing repository…". */
  private modelConfigGap(routingMode: InteractionSession["routingMode"]): string | null {
    const local = (this.deps.config.local.model || "").trim();
    const cloud = (this.deps.config.cloud.model || "").trim();
    const hasKey = Boolean(this.deps.config.openRouterApiKey);
    if (routingMode === "local-only") {
      if (!local) {
        return [
          "**Cannot start BUILD** — no local model configured.",
          "",
          "Set `OLLAMA_MODEL` in `.forge/desktop.env` or pull a model in Ollama and re-run onboarding.",
        ].join("\n");
      }
      return null;
    }
    if (!local && !cloud) {
      return [
        "**Cannot start BUILD** — no model name configured.",
        "",
        hasKey
          ? "OpenRouter key is present, but `OPENROUTER_MODEL` is empty. Add it to `.forge/desktop.env`, for example:"
          : "Set a local model (`OLLAMA_MODEL`) or add an OpenRouter key **and** `OPENROUTER_MODEL`.",
        hasKey ? "```" : "",
        hasKey ? "OPENROUTER_MODEL=openai/gpt-4o-mini" : "",
        hasKey ? "```" : "",
        "",
        "Then restart Forge (or start a new session) and try BUILD again.",
      ]
        .filter(Boolean)
        .join("\n");
    }
    return null;
  }
  private async runObjective(
    sessionId: string,
    objective: string,
    workspacePath: string,
  ): Promise<void> {
    const abort = new AbortController();
    const runKey = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.running.set(runKey, abort);
    const { store, config, events, fakeProvider, sessions } = this.deps;

    const runConfig: ResolvedConfig = {
      ...config,
      mode: sessions.getSession(sessionId)?.routingMode ?? config.mode,
      workspacePath,
    };

    try {
      const ollama = new OllamaProvider({
        baseUrl: runConfig.ollamaBaseUrl,
        // Local CPU models often exceed the default 120s per request.
        timeoutMs: Math.max(
          600_000,
          (runConfig.limits.timeoutMinutes || 45) * 60_000,
        ),
      });
      const openrouter = runConfig.openRouterApiKey
        ? new OpenRouterProvider({
            apiKey: runConfig.openRouterApiKey,
          })
        : null;

      const fake =
        fakeProvider ??
        (runConfig.local.model === "fake-model"
          ? new FakeModelProvider([
              { type: "message", content: "Gateway fake run acknowledged." },
            ])
          : undefined);

      events.publish(
        "model.selected",
        { local: runConfig.local.model, mode: runConfig.mode },
        { sessionId },
      );

      const orchestrator = new TaskOrchestrator({
        store,
        config: runConfig,
        logger: rootLogger.child("gateway"),
        ollama,
        openrouter,
        fake,
      });

      events.publish("verification.started", {}, { sessionId });
      const report = await orchestrator.run({
        objective,
        workspacePath,
        signal: abort.signal,
      });

      sessions.updateSession(sessionId, { activeTaskId: report.task.id });
      const channel = sessions.getSession(sessionId)?.channel ?? "web";

      this.recordBuildTraces(sessionId, report.task.id);

      if (report.task.status === "COMPLETED") {
        events.publish(
          "task.completed",
          { taskId: report.task.id, summary: report.summary },
          { sessionId, taskId: report.task.id },
        );
        const doneText = `Task \`${report.task.id.slice(0, 8)}\` **complete**.\n\n${report.summary}`;
        sessions.appendMessage({
          sessionId,
          channel,
          role: "assistant",
          content: {
            type: "markdown",
            text: doneText,
          },
        });
        events.publish(
          "message.created",
          { role: "assistant", text: doneText },
          { sessionId },
        );
      } else {
        events.publish(
          "task.failed",
          {
            taskId: report.task.id,
            status: report.task.status,
            error: report.task.error,
          },
          { sessionId, taskId: report.task.id },
        );
        const failText = `Task \`${report.task.id.slice(0, 8)}\` ended **${report.task.status}**.${
          report.task.error ? `\n\n${report.task.error}` : ""
        }`;
        sessions.appendMessage({
          sessionId,
          channel,
          role: "assistant",
          content: {
            type: "markdown",
            text: failText,
          },
        });
        events.publish(
          "message.created",
          { role: "assistant", text: failText },
          { sessionId },
        );
      }
      events.publish(
        "verification.completed",
        { status: report.verification?.status ?? null },
        { sessionId, taskId: report.task.id },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.deps.traces?.appendLog({
        level: "error",
        scope: "gateway:build",
        message,
        fields: { sessionId },
      });
      this.deps.events.publish(
        "log.error",
        { message, scope: "gateway:build" },
        { sessionId },
      );
      events.publish("task.failed", { error: message }, { sessionId });
      const channel = sessions.getSession(sessionId)?.channel ?? "web";
      const failText = `Task failed: ${message}`;
      sessions.appendMessage({
        sessionId,
        channel,
        role: "assistant",
        content: { type: "markdown", text: failText },
      });
      events.publish(
        "message.created",
        { role: "assistant", text: failText },
        { sessionId },
      );
    } finally {
      this.running.delete(runKey);
    }
  }

  private recordBuildTraces(sessionId: string, taskId: string): void {
    const traces = this.deps.traces;
    if (!traces) return;
    try {
      const runs = this.deps.store.listRuns(taskId);
      for (const run of runs) {
        const record = traces.recordTrace({
          sessionId,
          taskId,
          source: "build",
          provider: run.provider,
          model: run.model,
          promptTokens: run.promptTokens,
          completionTokens: run.completionTokens,
          estimatedCostUsd: run.estimatedCostUsd,
          latencyMs:
            run.endedAt && run.startedAt
              ? Math.max(
                  0,
                  new Date(run.endedAt).getTime() -
                    new Date(run.startedAt).getTime(),
                )
              : null,
          status: run.status === "succeeded" ? "ok" : "error",
          error: run.error,
        });
        this.deps.events.publish(
          "model.usage",
          {
            provider: record.provider,
            model: record.model,
            promptTokens: record.promptTokens,
            completionTokens: record.completionTokens,
            estimatedCostUsd: record.estimatedCostUsd,
            status: record.status,
          },
          { sessionId, taskId },
        );
      }
    } catch (err) {
      rootLogger.warn("failed to record build traces", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  cancelAll(): void {
    for (const ctl of this.running.values()) ctl.abort();
    this.running.clear();
  }

  cancelTask(_taskId: string): boolean {
    if (this.running.size === 0) return false;
    this.cancelAll();
    return true;
  }

  private systemPromptForMode(mode: ChatMode): string {
    if (mode === "ask") {
      return [
        "You are Forge, a local-first software engineering assistant.",
        "ASK mode: answer questions helpfully. Do not claim to have edited files.",
        "Be concise and practical.",
      ].join(" ");
    }
    if (mode === "plan") {
      return [
        "You are Forge in PLAN mode.",
        "Produce a concrete engineering plan with steps, files, and verification.",
        "Do not claim to have modified the repository.",
      ].join(" ");
    }
    return [
      "You are Forge in REVIEW mode.",
      "Review the user's focus area. Point out risks and suggested fixes.",
      "Do not claim to have modified files.",
    ].join(" ");
  }

  /**
   * ASK/PLAN/REVIEW — real model answer, no write tools.
   * Prefer healthy local Ollama first; fall back to OpenRouter; retry the other on failure.
   */
  private async readOnlyModelReply(
    mode: ChatMode,
    text: string,
    sessionId: string,
  ): Promise<string> {
    const { config, fakeProvider, traces, events } = this.deps;
    const system = this.systemPromptForMode(mode);
    const messages = [
      { role: "system" as const, content: system },
      { role: "user" as const, content: text },
    ];

    if (fakeProvider && (config.local.model === "fake-model" || !config.local.model)) {
      const t0 = Date.now();
      const res = await fakeProvider.generate({
        messages,
        tools: [],
        model: "fake-model",
        maxTokens: 1024,
      });
      traces?.recordTrace({
        sessionId,
        taskId: null,
        source: "chat",
        provider: "fake",
        model: "fake-model",
        promptTokens: res.usage.promptTokens,
        completionTokens: res.usage.completionTokens,
        estimatedCostUsd: res.usage.estimatedCostUsd,
        latencyMs: Date.now() - t0,
        status: "ok",
        error: null,
      });
      const body = (res.content ?? "").trim() || "(empty model response)";
      return `**${mode.toUpperCase()} mode** — no repository mutations.\n\n${body}`;
    }

    const ollama = new OllamaProvider({
      baseUrl: config.ollamaBaseUrl,
      timeoutMs: 600_000,
    });
    const openrouter = config.openRouterApiKey
      ? new OpenRouterProvider({ apiKey: config.openRouterApiKey, timeoutMs: 180_000 })
      : null;

    const localModel = (config.local.model || "").trim();
    const cloudModel = (config.cloud.model || "").trim();
    const localPing = localModel ? await ollama.ping?.() : { ok: false, detail: "unset" };
    const localOk = Boolean(localModel && localPing?.ok);
    const cloudOk = Boolean(openrouter && cloudModel && config.openRouterApiKey);

    type Candidate = {
      provider: OllamaProvider | OpenRouterProvider;
      model: string;
      label: string;
      providerKind: string;
    };
    const candidates: Candidate[] = [];

    // Always try a healthy local model first for chat (even in cloud-allowed).
    if (localOk) {
      candidates.push({
        provider: ollama,
        model: localModel,
        label: `ollama/${localModel}`,
        providerKind: "ollama",
      });
    }
    if (cloudOk && config.mode !== "local-only") {
      candidates.push({
        provider: openrouter!,
        model: cloudModel,
        label: `openrouter/${cloudModel}`,
        providerKind: "openrouter",
      });
    }

    if (candidates.length === 0) {
      return [
        this.readOnlyReply(mode, text),
        "",
        "_(No reachable model. Start Ollama with `llama3.2` (or set `OLLAMA_MODEL`), or add OpenRouter credits.)_",
      ].join("\n");
    }

    const errors: string[] = [];
    for (const c of candidates) {
      const t0 = Date.now();
      try {
        const res = await c.provider.generate({
          messages,
          tools: [],
          model: c.model,
          maxTokens: 1024,
        });
        const latencyMs = Date.now() - t0;
        const trace = traces?.recordTrace({
          sessionId,
          taskId: null,
          source: "chat",
          provider: c.providerKind,
          model: c.model,
          promptTokens: res.usage.promptTokens,
          completionTokens: res.usage.completionTokens,
          estimatedCostUsd: res.usage.estimatedCostUsd,
          latencyMs,
          status: "ok",
          error: null,
        });
        if (trace) {
          events.publish(
            "model.usage",
            {
              provider: trace.provider,
              model: trace.model,
              promptTokens: trace.promptTokens,
              completionTokens: trace.completionTokens,
              estimatedCostUsd: trace.estimatedCostUsd,
              latencyMs: trace.latencyMs,
              status: "ok",
            },
            { sessionId },
          );
        }
        const body = (res.content ?? "").trim() || "(empty model response)";
        return `**${mode.toUpperCase()} mode** (${c.label}) — no repository mutations.\n\n${body}`;
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        errors.push(`${c.label}: ${detail}`);
        traces?.recordTrace({
          sessionId,
          taskId: null,
          source: "chat",
          provider: c.providerKind,
          model: c.model,
          promptTokens: null,
          completionTokens: null,
          estimatedCostUsd: null,
          latencyMs: Date.now() - t0,
          status: "error",
          error: detail.slice(0, 1000),
        });
        traces?.appendLog({
          level: "error",
          scope: "gateway:model",
          message: detail,
          fields: { provider: c.providerKind, model: c.model, sessionId },
        });
        events.publish(
          "log.error",
          { message: detail, provider: c.providerKind, model: c.model },
          { sessionId },
        );
      }
    }

    return [
      this.readOnlyReply(mode, text),
      "",
      `_(All model calls failed.)_`,
      ...errors.map((e) => `- ${e.slice(0, 240)}`),
    ].join("\n");
  }

  private readOnlyReply(mode: ChatMode, text: string): string {
    if (mode === "ask") {
      return [
        "**ASK mode** — no repository mutations.",
        "",
        `Received: ${text}`,
        "",
        "Switch to **BUILD** to authorize implementation, or **PLAN** for a structured plan without edits.",
      ].join("\n");
    }
    if (mode === "plan") {
      return [
        "**PLAN mode** — engineering plan only (no code modifications).",
        "",
        `Objective: ${text}`,
        "",
        "1. Inspect repository structure and relevant entrypoints",
        "2. Identify files and acceptance criteria",
        "3. Sequence tasks with dependencies",
        "4. Define verification gates (typecheck / test / browser)",
        "",
        "Switch to **BUILD** to execute.",
      ].join("\n");
    }
    return [
      "**REVIEW mode** — read-only code review.",
      "",
      `Focus: ${text}`,
      "",
      "Review will not modify files. Use BUILD for fixes after review.",
    ].join("\n");
  }

  private async handleCommand(session: InteractionSession, text: string): Promise<string> {
    const [cmd] = text.split(/\s+/);
    switch ((cmd ?? "").toLowerCase()) {
      case "/help":
        return [
          "Commands:",
          "/status — active task status",
          "/tasks — active task",
          "/goal — active goal id",
          "/stop — cancel active run",
          "/models — configured models",
          "/approvals — pending approvals",
          "/help",
        ].join("\n");
      case "/status": {
        if (!session.activeTaskId) return "No active task.";
        const task = this.deps.store.getTask(session.activeTaskId);
        return task
          ? `Task ${task.id.slice(0, 8)} — **${task.status}**\n${task.objective}`
          : "Active task not found.";
      }
      case "/tasks":
        return session.activeTaskId
          ? `Active: ${session.activeTaskId}`
          : "No active task in this session.";
      case "/goal":
        return session.activeGoalId
          ? `Active goal: ${session.activeGoalId}`
          : "No active goal.";
      case "/stop": {
        const ok = this.cancelTask(session.activeTaskId ?? "");
        return ok ? "Cancel signal sent." : "No running gateway task.";
      }
      case "/models":
        return [
          `Local: ${this.deps.config.local.model || "(unset)"}`,
          `Cloud: ${this.deps.config.cloud.model || "(unset)"}`,
          `Mode: ${session.routingMode}`,
        ].join("\n");
      case "/approvals": {
        const pending = this.deps.store.listPendingApprovals();
        if (pending.length === 0) return "No pending approvals.";
        return pending
          .map((a) => `${a.id.slice(0, 8)}  ${a.action}  ${a.reason ?? ""}`)
          .join("\n");
      }
      case "/new":
        return "Create a new session from the Web GUI Sessions panel.";
      default:
        return `Unknown command: ${cmd}. Try /help.`;
    }
  }
}

export function resolveWorkspaceOrThrow(path: string): string {
  return resolve(path);
}
