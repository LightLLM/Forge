import type {
  ModelMessage,
  ModelResponse,
  ProviderKind,
  TaskRecord,
  ToolCallResult,
  VerificationResult,
} from "../core/types.js";
import { BudgetTracker } from "../core/budgets/tracker.js";
import { ContextCompiler } from "../context/compiler.js";
import type { ModelProvider } from "../models/provider.js";
import type { PersistenceStore } from "../persistence/store.js";
import { authorizeAndExecute, type PolicyEngine } from "../policy/engine.js";
import type { ApprovalGate } from "../policy/approvals.js";
import type { RegisteredTool, ToolContext } from "../tools/types.js";
import type { Logger } from "../telemetry/logger.js";
import type { Workspace } from "../workspace/workspace.js";
import {
  DEFAULT_COMMAND_ALLOWLIST,
  runAllowedCommand,
} from "../tools/repository.js";
import type { SandboxOptions } from "../tools/sandbox.js";

export interface AgentLoopOptions {
  task: TaskRecord;
  runId: string;
  provider: ModelProvider;
  providerKind: ProviderKind;
  model: string;
  workspace: Workspace;
  tools: RegisteredTool[];
  policy: PolicyEngine;
  approvalGate?: ApprovalGate;
  store: PersistenceStore;
  logger: Logger;
  budgets: BudgetTracker;
  contextCompiler: ContextCompiler;
  phase: "implement" | "repair" | "escalate";
  verification?: VerificationResult | null;
  previousApproach?: string | null;
  relatedMemoriesText?: string | null;
  relatedSkillsText?: string | null;
  roleId?: string | null;
  roleInstructions?: string | null;
  permissionsSummary?: string;
  maxContextChars: number;
  commandTimeoutMs: number;
  maxCommandOutputChars: number;
  commandAllowlist: string[];
  sandbox?: SandboxOptions;
  streamProgress?: boolean;
  signal?: AbortSignal;
}

export interface AgentLoopResult {
  assistantSummary: string | null;
  toolResults: ToolCallResult[];
  turnCount: number;
  stoppedReason:
    | "completed_by_model"
    | "max_turns"
    | "timeout"
    | "cancelled"
    | "provider_error"
    | "no_progress"
    | "tool_limit";
  lastError?: string;
  usageCostUsd: number;
}

/**
 * Bounded agent loop. Forge owns budgets, policy, and termination.
 */
export class AgentLoop {
  async run(options: AgentLoopOptions): Promise<AgentLoopResult> {
    const {
      task,
      runId,
      provider,
      model,
      workspace,
      tools,
      policy,
      store,
      logger,
      budgets,
      contextCompiler,
      phase,
      signal,
    } = options;

    const toolMap = new Map(tools.map((t) => [t.name, t]));
    const toolResults: ToolCallResult[] = [];
    let assistantSummary: string | null = null;
    let usageCostUsd = 0;
    let consecutiveNoTool = 0;
    let lastSignatures: string[] = [];

    const diffSummary = await safeGitDiff(workspace, options);

    const compiled = contextCompiler.compile({
      task,
      workspace,
      tools,
      phase,
      verification: options.verification,
      previousApproach: options.previousApproach,
      relatedMemoriesText: options.relatedMemoriesText,
      relatedSkillsText: options.relatedSkillsText,
      roleId: options.roleId,
      roleInstructions: options.roleInstructions,
      diffSummary,
      budgetSummary: formatBudget(budgets),
      permissionsSummary:
        options.permissionsSummary ??
        "read/write/execute tools allowed within workspace; network tools denied; secrets paths denied",
      maxContextChars: options.maxContextChars,
    });

    const messages: ModelMessage[] = [
      { role: "system", content: compiled.systemPrompt },
      { role: "user", content: compiled.userPrompt },
    ];

    store.appendEvent(
      task.id,
      "context_built",
      { phase, metadata: compiled.metadata },
      runId,
    );

    while (true) {
      if (signal?.aborted) {
        return {
          assistantSummary,
          toolResults,
          turnCount: budgets.getTurnCount(),
          stoppedReason: "cancelled",
          usageCostUsd,
        };
      }

      const violation = budgets.beginTurn();
      if (violation) {
        return {
          assistantSummary,
          toolResults,
          turnCount: budgets.getTurnCount(),
          stoppedReason: violation === "timeout" ? "timeout" : "max_turns",
          usageCostUsd,
        };
      }

      store.updateTaskFields(task.id, { turnCount: budgets.getTurnCount() });
      store.appendEvent(
        task.id,
        "turn_started",
        { turn: budgets.getTurnCount(), provider: options.providerKind, model },
        runId,
      );

      let response: ModelResponse;
      try {
        let streamed = false;
        response = await provider.generate({
          messages,
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.jsonSchema,
          })),
          model,
          signal,
          onToken: options.streamProgress
            ? (chunk) => {
                if (!streamed) {
                  process.stderr.write("\n[forge] model streaming… ");
                  streamed = true;
                }
                process.stderr.write(chunk.length > 0 ? "·" : "");
              }
            : undefined,
        });
        if (streamed) process.stderr.write("\n");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("provider generate failed", { error: message });
        store.appendEvent(task.id, "provider_error", { error: message }, runId);
        return {
          assistantSummary,
          toolResults,
          turnCount: budgets.getTurnCount(),
          stoppedReason: "provider_error",
          lastError: message,
          usageCostUsd,
        };
      }

      if (response.usage.estimatedCostUsd != null) {
        usageCostUsd += response.usage.estimatedCostUsd;
        budgets.addCloudCost(
          options.providerKind === "openrouter"
            ? response.usage.estimatedCostUsd
            : 0,
        );
      }

      store.appendEvent(
        task.id,
        "model_response",
        {
          finishReason: response.finishReason,
          toolCallCount: response.toolCalls.length,
          hasContent: Boolean(response.content),
          usage: response.usage,
        },
        runId,
      );

      if (response.finishReason === "cancelled") {
        return {
          assistantSummary,
          toolResults,
          turnCount: budgets.getTurnCount(),
          stoppedReason: "cancelled",
          usageCostUsd,
        };
      }

      if (response.content) {
        assistantSummary = response.content;
        messages.push({ role: "assistant", content: response.content });
      }

      if (response.toolCalls.length === 0) {
        consecutiveNoTool += 1;
        if (consecutiveNoTool >= 1) {
          return {
            assistantSummary,
            toolResults,
            turnCount: budgets.getTurnCount(),
            stoppedReason: "completed_by_model",
            usageCostUsd,
          };
        }
        continue;
      }

      consecutiveNoTool = 0;
      const signature = response.toolCalls
        .map((c) => `${c.name}:${JSON.stringify(c.arguments)}`)
        .join("|");
      lastSignatures.push(signature);
      if (lastSignatures.length > 3) lastSignatures = lastSignatures.slice(-3);
      if (
        lastSignatures.length === 3 &&
        lastSignatures[0] === lastSignatures[1] &&
        lastSignatures[1] === lastSignatures[2]
      ) {
        return {
          assistantSummary,
          toolResults,
          turnCount: budgets.getTurnCount(),
          stoppedReason: "no_progress",
          lastError: "Repeated identical tool calls detected",
          usageCostUsd,
        };
      }

      messages.push({
        role: "assistant",
        content: response.content ?? "",
        toolCalls: response.toolCalls,
      });

      for (const proposal of response.toolCalls) {
        store.appendEvent(
          task.id,
          "tool_proposed",
          { name: proposal.name, arguments: summarizeArgs(proposal.arguments) },
          runId,
        );

        const toolLimit = budgets.recordToolCall();
        if (toolLimit) {
          return {
            assistantSummary,
            toolResults,
            turnCount: budgets.getTurnCount(),
            stoppedReason: "tool_limit",
            usageCostUsd,
          };
        }

        const toolCtx: ToolContext = {
          workspace,
          taskId: task.id,
          runId,
          logger,
          signal,
          commandTimeoutMs: options.commandTimeoutMs,
          maxCommandOutputChars: options.maxCommandOutputChars,
          commandAllowlist: options.commandAllowlist,
          sandbox: options.sandbox,
        };

        const result = await authorizeAndExecute(
          proposal,
          toolMap.get(proposal.name),
          policy,
          toolCtx,
          options.approvalGate,
        );
        toolResults.push(result);

        store.appendEvent(
          task.id,
          result.denied ? "tool_denied" : result.ok ? "tool_result" : "tool_error",
          {
            name: result.name,
            ok: result.ok,
            denied: result.denied ?? false,
            error: result.error,
            denialReason: result.denialReason,
          },
          runId,
        );

        const run = store.getRun(runId);
        if (run) {
          store.updateRun(runId, { toolCallCount: run.toolCallCount + 1 });
        }

        messages.push({
          role: "tool",
          toolCallId: proposal.id,
          name: proposal.name,
          content: JSON.stringify(
            result.denied
              ? { denied: true, reason: result.denialReason }
              : result.ok
                ? result.output
                : { error: result.error },
          ).slice(0, 20_000),
        });
      }
    }
  }
}

function formatBudget(budgets: BudgetTracker): string {
  const s = budgets.snapshot();
  return [
    `turns: ${s.turnCount}/${s.maxTurns}`,
    `repairs: ${s.repairCount}/${s.maxRepairs}`,
    `timeoutMs: ${s.timeoutMs}`,
    `cloudCostUsd: ${s.cloudCostUsd}${s.cloudBudgetUsd != null ? `/${s.cloudBudgetUsd}` : ""}`,
  ].join(", ");
}

function summarizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string" && v.length > 200) {
      out[k] = `${v.slice(0, 200)}…`;
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function safeGitDiff(
  workspace: Workspace,
  options: AgentLoopOptions,
): Promise<string | null> {
  try {
    const result = await runAllowedCommand("git diff", {
      workspace,
      commandAllowlist: DEFAULT_COMMAND_ALLOWLIST,
      commandTimeoutMs: options.commandTimeoutMs,
      maxCommandOutputChars: options.maxCommandOutputChars,
      sandbox: { mode: "host", image: "", networkDisabled: true },
    });
    return result.stdout || null;
  } catch {
    return null;
  }
}
