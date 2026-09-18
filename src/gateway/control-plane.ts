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

export interface ControlPlaneDeps {
  store: PersistenceStore;
  sessions: InteractionSessionStore;
  events: GatewayEventBus;
  config: ResolvedConfig;
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
  }): Promise<{ message: GatewayMessage; taskId?: string }> {
    const mode = input.mode ?? input.session.chatMode;
    this.deps.sessions.appendMessage({
      sessionId: input.session.id,
      channel: input.session.channel,
      role: "user",
      content: { type: "text", text: input.text },
      mode,
      externalUserId: input.externalUserId,
      externalConversationId: input.session.externalConversationId ?? undefined,
    });
    this.deps.events.publish(
      "message.created",
      { role: "user", text: input.text, mode },
      { sessionId: input.session.id, channel: input.session.channel },
    );

    if (input.text.trim().startsWith("/")) {
      const reply = await this.handleCommand(input.session, input.text.trim());
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
      const reply = this.readOnlyReply(mode, input.text);
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

    const objective = mode === "debug" ? `[DEBUG] ${input.text}` : input.text;
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

      if (report.task.status === "COMPLETED") {
        events.publish(
          "task.completed",
          { taskId: report.task.id, summary: report.summary },
          { sessionId, taskId: report.task.id },
        );
        sessions.appendMessage({
          sessionId,
          channel,
          role: "assistant",
          content: {
            type: "markdown",
            text: `Task \`${report.task.id.slice(0, 8)}\` **complete**.\n\n${report.summary}`,
          },
        });
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
        sessions.appendMessage({
          sessionId,
          channel,
          role: "assistant",
          content: {
            type: "markdown",
            text: `Task \`${report.task.id.slice(0, 8)}\` ended **${report.task.status}**.${
              report.task.error ? `\n\n${report.task.error}` : ""
            }`,
          },
        });
      }
      events.publish(
        "verification.completed",
        { status: report.verification?.status ?? null },
        { sessionId, taskId: report.task.id },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      events.publish("task.failed", { error: message }, { sessionId });
      const channel = sessions.getSession(sessionId)?.channel ?? "web";
      sessions.appendMessage({
        sessionId,
        channel,
        role: "assistant",
        content: { type: "markdown", text: `Task failed: ${message}` },
      });
    } finally {
      this.running.delete(runKey);
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
