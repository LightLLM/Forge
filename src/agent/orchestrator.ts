import { basename } from "node:path";
import type { ResolvedConfig } from "../config/load.js";
import { BudgetTracker } from "../core/budgets/tracker.js";
import { isTerminalStatus } from "../core/state/machine.js";
import type {
  ProviderKind,
  TaskRecord,
  VerificationResult,
} from "../core/types.js";
import { ForgeError } from "../core/types.js";
import { AgentLoop } from "../agent/loop.js";
import { ContextCompiler } from "../context/compiler.js";
import type { ModelProvider } from "../models/provider.js";
import { DeterministicModelRouter } from "../models/router.js";
import type { PersistenceStore } from "../persistence/store.js";
import { DefaultPolicyEngine } from "../policy/engine.js";
import { createApprovalGate } from "../policy/approvals.js";
import {
  createRepositoryTools,
  DEFAULT_COMMAND_ALLOWLIST,
  runAllowedCommand,
} from "../tools/repository.js";
import { loadToolPacks } from "../tools/packs.js";
import type { RegisteredTool } from "../tools/types.js";
import type { Logger } from "../telemetry/logger.js";
import { VerificationEngine } from "../verification/engine.js";
import { Workspace } from "../workspace/workspace.js";
import { createTaskBranch } from "../workspace/git.js";
import { WorktreeManager } from "../workspace/worktree.js";
import { WorkspaceLease, type LeaseHandle } from "../workspace/lease.js";
import type { SandboxOptions } from "../tools/sandbox.js";
import {
  formatMemoriesForContext,
  MemoryService,
} from "../memory/service.js";
import {
  collectWorkspaceSignals,
  formatSkillsForContext,
  SkillLoader,
  SkillRegistry,
  SkillRouter,
} from "../skills/index.js";
import { McpGateway } from "../mcp/index.js";
import {
  filterToolsForRole,
  selectAgentRole,
} from "../agents/index.js";

export interface OrchestratorDeps {
  store: PersistenceStore;
  config: ResolvedConfig;
  logger: Logger;
  ollama: ModelProvider;
  openrouter: ModelProvider | null;
  fake?: ModelProvider;
}

export interface RunTaskOptions {
  objective: string;
  workspacePath?: string;
  acceptanceCriteria?: string;
  signal?: AbortSignal;
}

export interface TaskReport {
  task: TaskRecord;
  verification: VerificationResult | null;
  finalDiff: string | null;
  escalated: boolean;
  summary: string;
}

export class TaskOrchestrator {
  private readonly router: DeterministicModelRouter;
  private readonly contextCompiler = new ContextCompiler();
  private readonly agentLoop = new AgentLoop();
  private tools: RegisteredTool[] = createRepositoryTools();

  constructor(private readonly deps: OrchestratorDeps) {
    this.router = new DeterministicModelRouter({
      ollama: deps.ollama,
      openrouter: deps.openrouter,
      fake: deps.fake,
    });
  }

  async run(options: RunTaskOptions): Promise<TaskReport> {
    const { store, config, logger } = this.deps;
    const workspacePath = options.workspacePath ?? config.workspacePath;
    let workspace = new Workspace(workspacePath);

    this.tools = await loadToolPacks(workspacePath, config.tools.packs);

    let mcpGateway: McpGateway | null = null;
    const mcpToolNames: string[] = [];
    if (config.mcp.servers.some((s) => s.enabled)) {
      mcpGateway = new McpGateway({
        workspacePath,
        servers: config.mcp.servers,
      });
      const mcpTools = await mcpGateway.loadTools();
      const seen = new Set(this.tools.map((t) => t.name));
      for (const tool of mcpTools) {
        if (seen.has(tool.name)) {
          throw new ForgeError(
            `Duplicate tool name from MCP: ${tool.name}`,
            "MCP_TOOL_CONFLICT",
          );
        }
        seen.add(tool.name);
        this.tools.push(tool);
        mcpToolNames.push(tool.name);
      }
    }

    const project = store.upsertProject(workspacePath, basename(workspacePath));
    const memory = new MemoryService(store);
    const session = memory.openSession(project.id, `task:${options.objective.slice(0, 60)}`);
    let task = store.createTask({
      projectId: project.id,
      objective: options.objective,
      workspacePath,
      routingMode: config.mode,
      localModel: config.local.model || null,
      cloudModel: config.cloud.model || null,
      maxTurns: config.limits.maxTurns,
      maxRepairs: config.limits.maxRepairs,
      timeoutMs: config.limits.timeoutMinutes * 60_000,
      cloudBudgetUsd: config.limits.maxCloudCostUsd,
      acceptanceCriteria: options.acceptanceCriteria ?? null,
    });

    store.appendEvent(task.id, "task_created", {
      objective: task.objective,
      mode: task.routingMode,
      sessionId: session.id,
    });
    store.appendEvent(task.id, "session_bound", { sessionId: session.id });
    if (mcpToolNames.length > 0) {
      store.appendEvent(task.id, "mcp_tools_loaded", {
        tools: mcpToolNames,
        servers: config.mcp.servers.filter((s) => s.enabled).map((s) => s.id),
      });
    }

    let recordedFailureId: string | null = null;
    let sawVerificationFailure = false;
    let lease: LeaseHandle | null = null;

    if (config.git.useWorktrees) {
      const manager = new WorktreeManager(workspacePath, {
        worktreeBase: config.git.worktreeBase,
      });
      const wt = await manager.createForTask(task.id);
      workspace = wt.workspace;
      store.appendEvent(task.id, "worktree_created", {
        path: wt.path,
        branch: wt.branch,
        created: wt.created,
        detail: wt.detail,
      });
      store.createArtifact(
        task.id,
        "worktree",
        JSON.stringify(
          {
            path: wt.path,
            branch: wt.branch,
            created: wt.created,
            detail: wt.detail,
          },
          null,
          2,
        ),
      );
      logger.info("worktree ready", {
        path: wt.path,
        branch: wt.branch,
        created: wt.created,
      });
    } else if (config.git.createTaskBranch) {
      const branchResult = await createTaskBranch(workspace, task.id);
      store.appendEvent(task.id, "task_branch", branchResult);
      store.createArtifact(
        task.id,
        "git_branch",
        JSON.stringify(branchResult, null, 2),
      );
      logger.info("task branch", branchResult);
    }

    if (config.git.acquireLease || config.git.useWorktrees) {
      lease = WorkspaceLease.acquire(workspace.root, task.id, task.timeoutMs);
      store.appendEvent(task.id, "workspace_lease_acquired", {
        path: workspace.root,
        holderId: task.id,
        expiresAt: lease.record.expiresAt,
      });
    }

    const budgets = new BudgetTracker({
      maxTurns: task.maxTurns,
      maxRepairs: task.maxRepairs,
      timeoutMs: task.timeoutMs,
      cloudBudgetUsd: task.cloudBudgetUsd,
      maxToolCallsPerTurn: config.limits.maxToolCallsPerTurn,
    });

    const policy = new DefaultPolicyEngine({
      allowWrites: true,
      allowExecute: true,
      approvals: {
        mode: config.approvals.mode,
        risks: config.approvals.risks,
      },
    });

    const approvalGate = createApprovalGate(
      {
        mode: config.approvals.mode,
        risks: config.approvals.risks,
        queueTimeoutMs: config.approvals.queueTimeoutMs,
        queuePollMs: config.approvals.queuePollMs,
      },
      { store, logger },
    );

    const sandbox: SandboxOptions = {
      mode: config.commands.sandbox,
      image: config.commands.dockerImage,
      networkDisabled: config.commands.dockerNetworkDisabled,
      hardened: config.commands.dockerHardened,
      memoryLimit: config.commands.dockerMemoryLimit,
      pidsLimit: config.commands.dockerPidsLimit,
    };

    const verificationEngine = new VerificationEngine({
      typecheck: config.verification.typecheck,
      lint: config.verification.lint,
      test: config.verification.test,
      build: config.verification.build,
      gitDiffCheck: config.verification.gitDiffCheck,
      playwright: config.verification.playwright,
      browserQa: config.verification.browserQa,
      browserQaDriver: config.verification.browserQaDriver,
      commandTimeoutMs: config.limits.commandTimeoutMs,
      maxCommandOutputChars: config.limits.maxCommandOutputChars,
      commandAllowlist: config.commands.allowlist,
      sandbox,
    });

    const abort = options.signal;
    let escalated = false;
    let previousApproach: string | null = null;
    let lastVerification: VerificationResult | null = null;
    let lastSummary: string | null = null;

    try {
      task = store.updateTaskStatus(task.id, "CONTEXT_BUILDING");
      task = store.updateTaskStatus(task.id, "PLANNING");
      const plan = `Implement: ${task.objective}`;
      task = store.updateTaskFields(task.id, { plan });
      store.createArtifact(task.id, "plan", plan);
      task = store.updateTaskStatus(task.id, "READY");

      const localAvailable = await this.isLocalAvailable(task.localModel);
      let cloudAvailable = this.isCloudAvailable();

      // Initial implementation pass
      task = store.updateTaskStatus(task.id, "IMPLEMENTING");
      const implementResult = await this.runPhase({
        task,
        phase: "implement",
        workspace,
        policy,
        approvalGate,
        budgets,
        localAvailable,
        cloudAvailable,
        escalate: false,
        verification: null,
        previousApproach: null,
        signal: abort,
      });
      previousApproach = implementResult.assistantSummary;
      lastSummary = implementResult.assistantSummary;
      task = store.getTask(task.id)!;

      if (implementResult.stoppedReason === "provider_error") {
        if (task.routingMode === "local-only") {
          throw new ForgeError(
            implementResult.lastError ?? "Provider error",
            "PROVIDER_ERROR",
          );
        }
        // Try escalate on provider failure for non-local-only
        escalated = true;
      }

      // Verify → repair → escalate loop
      while (!isTerminalStatus(task.status)) {
        if (abort?.aborted) {
          task = store.updateTaskStatus(task.id, "CANCELLED");
          break;
        }

        const timeout = budgets.checkTimeout();
        if (timeout) {
          task = store.updateTaskStatus(task.id, "FAILED", "Task timed out");
          break;
        }

        task = store.updateTaskStatus(task.id, "VERIFYING");
        store.appendEvent(task.id, "verification_started", {});
        lastVerification = await verificationEngine.verify(workspace);
        store.appendEvent(task.id, "verification_result", {
          status: lastVerification.status,
          summary: lastVerification.summary,
          checks: lastVerification.checks.map((c) => ({
            name: c.name,
            status: c.status,
            exitCode: c.exitCode,
          })),
        });
        store.createArtifact(
          task.id,
          "verification",
          JSON.stringify(lastVerification, null, 2),
        );

        if (
          lastVerification.status === "passed" ||
          lastVerification.status === "skipped"
        ) {
          task = store.updateTaskStatus(task.id, "REVIEW");
          task = store.updateTaskStatus(task.id, "COMPLETED");
          break;
        }

        sawVerificationFailure = true;
        const failureMem = memory.writeFailure({
          projectId: project.id,
          taskId: task.id,
          objective: task.objective,
          verification: lastVerification,
        });
        recordedFailureId = failureMem.id;
        store.appendEvent(task.id, "memory_failure_recorded", {
          memoryId: failureMem.id,
        });

        // Failed verification — attempt repair if budget remains
        const repairViolation = budgets.beginRepair();
        if (!repairViolation) {
          store.updateTaskFields(task.id, { repairCount: budgets.getRepairCount() });
          store.appendEvent(task.id, "repair_started", {
            repair: budgets.getRepairCount(),
          });
          task = store.updateTaskStatus(task.id, "REPAIRING");

          const repairResult = await this.runPhase({
            task,
            phase: "repair",
            workspace,
            policy,
            approvalGate,
            budgets,
            localAvailable: await this.isLocalAvailable(task.localModel),
            cloudAvailable: this.isCloudAvailable(),
            escalate: escalated,
            verification: lastVerification,
            previousApproach,
            signal: abort,
          });
          previousApproach = repairResult.assistantSummary ?? previousApproach;
          lastSummary = repairResult.assistantSummary ?? lastSummary;
          task = store.getTask(task.id)!;
          continue;
        }

        // Repair budget exhausted — escalate if permitted
        if (task.routingMode === "local-only") {
          task = store.updateTaskStatus(
            task.id,
            "FAILED",
            `Verification failed after ${budgets.getRepairCount()} repair(s); local-only forbids escalation. ${lastVerification.summary}`,
          );
          break;
        }

        if (!this.isCloudAvailable()) {
          task = store.updateTaskStatus(
            task.id,
            "FAILED",
            `Verification failed; cloud escalation unavailable. ${lastVerification.summary}`,
          );
          break;
        }

        if (
          task.cloudBudgetUsd != null &&
          budgets.getCloudCostUsd() >= task.cloudBudgetUsd
        ) {
          task = store.updateTaskStatus(
            task.id,
            "FAILED",
            "Cloud budget exhausted before escalation",
          );
          break;
        }

        task = store.updateTaskStatus(task.id, "ESCALATING");
        store.appendEvent(task.id, "escalation", {
          reason: "local repair budget exhausted",
          verification: lastVerification.summary,
        });
        escalated = true;
        cloudAvailable = this.isCloudAvailable();

        const escalateResult = await this.runPhase({
          task,
          phase: "escalate",
          workspace,
          policy,
          approvalGate,
          budgets,
          localAvailable: false,
          cloudAvailable,
          escalate: true,
          escalationReason: "local repair budget exhausted",
          verification: lastVerification,
          previousApproach,
          signal: abort,
        });
        previousApproach = escalateResult.assistantSummary ?? previousApproach;
        lastSummary = escalateResult.assistantSummary ?? lastSummary;
        task = store.getTask(task.id)!;

        // One more verification after escalation
        task = store.updateTaskStatus(task.id, "VERIFYING");
        lastVerification = await verificationEngine.verify(workspace);
        store.appendEvent(task.id, "verification_result", {
          status: lastVerification.status,
          summary: lastVerification.summary,
          afterEscalation: true,
        });
        store.createArtifact(
          task.id,
          "verification",
          JSON.stringify(lastVerification, null, 2),
        );

        if (
          lastVerification.status === "passed" ||
          lastVerification.status === "skipped"
        ) {
          task = store.updateTaskStatus(task.id, "REVIEW");
          task = store.updateTaskStatus(task.id, "COMPLETED");
        } else {
          task = store.updateTaskStatus(
            task.id,
            "FAILED",
            `Verification still failing after escalation: ${lastVerification.summary}`,
          );
        }
        break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("task failed", { taskId: task.id, error: message });
      const current = store.getTask(task.id);
      if (current && !isTerminalStatus(current.status)) {
        try {
          task = store.updateTaskStatus(task.id, "FAILED", message);
        } catch {
          store.updateTaskFields(task.id, { error: message });
          task = store.getTask(task.id)!;
        }
      } else {
        task = store.getTask(task.id)!;
      }
    }

    const finalDiff = await this.captureDiff(workspace, config);
    if (finalDiff) {
      store.createArtifact(task.id, "diff", finalDiff);
    }

    const finalTask = store.getTask(task.id)!;
    if (finalTask.status === "COMPLETED" && sawVerificationFailure) {
      const solution = memory.writeSolution({
        projectId: project.id,
        taskId: finalTask.id,
        objective: finalTask.objective,
        summary: lastSummary ?? "Repaired after verification failure",
        relatedFailureId: recordedFailureId,
      });
      store.appendEvent(finalTask.id, "memory_solution_recorded", {
        memoryId: solution.id,
        relatedFailureId: recordedFailureId,
      });
    }
    memory.writeTaskOutcome({
      projectId: project.id,
      taskId: finalTask.id,
      objective: finalTask.objective,
      status: finalTask.status,
      summary:
        lastSummary ??
        finalTask.error ??
        (finalTask.status === "COMPLETED" ? "Task completed" : "Task ended"),
    });
    try {
      store.closeSession(session.id);
    } catch {
      // session may already be closed
    }

    if (mcpGateway) {
      await mcpGateway.close().catch(() => undefined);
    }

    if (lease) {
      try {
        lease.release();
        store.appendEvent(finalTask.id, "workspace_lease_released", {
          path: workspace.root,
        });
      } catch {
        // ignore
      }
    }

    store.appendEvent(task.id, "task_finished", {
      status: finalTask.status,
      escalated,
      sessionId: session.id,
    });

    return {
      task: finalTask,
      verification: lastVerification,
      finalDiff,
      escalated,
      summary:
        lastSummary ??
        finalTask.error ??
        (finalTask.status === "COMPLETED" ? "Task completed" : "Task ended"),
    };
  }

  private async runPhase(args: {
    task: TaskRecord;
    phase: "implement" | "repair" | "escalate";
    workspace: Workspace;
    policy: DefaultPolicyEngine;
    approvalGate: ReturnType<typeof createApprovalGate>;
    budgets: BudgetTracker;
    localAvailable: boolean;
    cloudAvailable: boolean;
    escalate: boolean;
    escalationReason?: string;
    verification: VerificationResult | null;
    previousApproach: string | null;
    signal?: AbortSignal;
  }): Promise<{
    assistantSummary: string | null;
    stoppedReason: string;
    lastError?: string;
    providerKind: ProviderKind;
  }> {
    const { store, config, logger } = this.deps;
    const decision = this.router.select({
      mode: args.task.routingMode,
      localModel: args.task.localModel ?? config.local.model,
      cloudModel: args.task.cloudModel ?? config.cloud.model,
      localAvailable: args.localAvailable,
      cloudAvailable: args.cloudAvailable,
      escalate: args.escalate,
      escalationReason: args.escalationReason,
    });

    store.appendEvent(args.task.id, "provider_selected", {
      provider: decision.providerKind,
      model: decision.model,
      reason: decision.reason,
      escalated: decision.escalated,
    });

    const run = store.createRun({
      taskId: args.task.id,
      provider: decision.providerKind,
      model: decision.model,
      escalationReason: decision.escalated
        ? (args.escalationReason ?? decision.reason)
        : null,
    });

    const allowlist = [
      ...DEFAULT_COMMAND_ALLOWLIST,
      ...(config.commands.allowlist ?? []),
    ];

    const sandbox: SandboxOptions = {
      mode: config.commands.sandbox,
      image: config.commands.dockerImage,
      networkDisabled: config.commands.dockerNetworkDisabled,
      hardened: config.commands.dockerHardened,
      memoryLimit: config.commands.dockerMemoryLimit,
      pidsLimit: config.commands.dockerPidsLimit,
    };

    const memory = new MemoryService(store);
    const memoryHits = memory.retrieveForTask({
      projectId: args.task.projectId,
      objective: args.task.objective,
      phase: args.phase,
      verification: args.verification,
      limit: 6,
    });
    const relatedMemoriesText = formatMemoriesForContext(memoryHits);
    if (memoryHits.length > 0) {
      store.appendEvent(args.task.id, "memory_retrieved", {
        count: memoryHits.length,
        ids: memoryHits.map((h) => h.memory.id),
        phase: args.phase,
      });
    }

    let relatedSkillsText: string | null = null;
    if (config.skills.enabled) {
      const loaded = new SkillLoader().load(args.workspace.root, {
        extraPaths: config.skills.extraPaths,
      });
      const registry = new SkillRegistry(loaded);
      const router = new SkillRouter(registry);
      const matches = router.route({
        objective: args.task.objective,
        phase: args.phase,
        signals: collectWorkspaceSignals(args.workspace.root),
        maxSkills: config.skills.maxSkills,
        include: config.skills.include,
        exclude: config.skills.exclude,
      });
      relatedSkillsText = formatSkillsForContext(matches) || null;
      if (matches.length > 0) {
        store.appendEvent(args.task.id, "skills_selected", {
          phase: args.phase,
          skills: matches.map((m) => ({
            id: m.skill.metadata.id,
            score: m.score,
            reasons: m.reasons,
          })),
        });
      }
    }

    const role = config.agents.enabled
      ? selectAgentRole({
          phase: args.phase,
          objective: args.task.objective,
          phaseRoles: config.agents.phaseRoles,
        })
      : selectAgentRole({
          phase: "implement",
          objective: args.task.objective,
          roleId: "implementer",
        });

    const roleTools = config.agents.enabled
      ? filterToolsForRole(this.tools, role)
      : this.tools;

    const rolePolicy = new DefaultPolicyEngine({
      allowWrites: role.permissions.allowWrites,
      allowExecute: role.permissions.allowExecute,
      approvals: {
        mode: config.approvals.mode,
        risks: config.approvals.risks,
      },
    });

    const permissionsSummary = [
      `role=${role.id}`,
      `writes=${role.permissions.allowWrites ? "allowed" : "denied"}`,
      `execute=${role.permissions.allowExecute ? "allowed" : "denied"}`,
      `maxRisk=${role.permissions.maxRisk}`,
      "network=denied",
      "secrets paths=denied",
    ].join("; ");

    store.appendEvent(args.task.id, "role_selected", {
      roleId: role.id,
      phase: args.phase,
      allowedTools: role.allowedTools,
      permissions: role.permissions,
      modelPolicy: role.modelPolicy,
    });

    const maxContextChars = Math.min(
      config.limits.maxContextChars,
      role.budgets.maxContextChars ?? config.limits.maxContextChars,
    );

    const result = await this.agentLoop.run({
      task: args.task,
      runId: run.id,
      provider: decision.provider,
      providerKind: decision.providerKind,
      model: decision.model,
      workspace: args.workspace,
      tools: roleTools,
      policy: rolePolicy,
      approvalGate: role.permissions.allowWrites || role.permissions.allowExecute
        ? args.approvalGate
        : undefined,
      store,
      logger,
      budgets: args.budgets,
      contextCompiler: this.contextCompiler,
      phase: args.phase,
      verification: args.verification,
      previousApproach: args.previousApproach,
      relatedMemoriesText: relatedMemoriesText || null,
      relatedSkillsText,
      roleId: role.id,
      roleInstructions: role.systemInstructions,
      permissionsSummary,
      maxContextChars,
      commandTimeoutMs: config.limits.commandTimeoutMs,
      maxCommandOutputChars: config.limits.maxCommandOutputChars,
      commandAllowlist: allowlist,
      sandbox,
      streamProgress: config.ui.streamProgress && decision.providerKind === "ollama",
      signal: args.signal,
    });

    store.updateTaskFields(args.task.id, {
      turnCount: args.budgets.getTurnCount(),
      repairCount: args.budgets.getRepairCount(),
      cloudCostUsd: args.budgets.getCloudCostUsd(),
    });

    store.updateRun(run.id, {
      status:
        result.stoppedReason === "provider_error"
          ? "failed"
          : result.stoppedReason === "cancelled"
            ? "cancelled"
            : "succeeded",
      endedAt: new Date().toISOString(),
      estimatedCostUsd: result.usageCostUsd || null,
      error: result.lastError ?? null,
    });

    return {
      assistantSummary: result.assistantSummary,
      stoppedReason: result.stoppedReason,
      lastError: result.lastError,
      providerKind: decision.providerKind,
    };
  }

  private async isLocalAvailable(model: string | null): Promise<boolean> {
    if (model === "fake-model" && this.deps.fake) return true;
    if (this.deps.fake && model === "fake-model") return true;
    try {
      const ping = await this.deps.ollama.ping?.();
      return ping?.ok ?? true;
    } catch {
      return false;
    }
  }

  private isCloudAvailable(): boolean {
    return Boolean(this.deps.openrouter && this.deps.config.openRouterApiKey);
  }

  private async captureDiff(
    workspace: Workspace,
    config: ResolvedConfig,
  ): Promise<string | null> {
    try {
      const result = await runAllowedCommand("git diff", {
        workspace,
        commandAllowlist: DEFAULT_COMMAND_ALLOWLIST,
        commandTimeoutMs: config.limits.commandTimeoutMs,
        maxCommandOutputChars: config.limits.maxCommandOutputChars,
        sandbox: { mode: "host", image: "", networkDisabled: true },
      });
      return result.stdout || null;
    } catch {
      return null;
    }
  }
}
