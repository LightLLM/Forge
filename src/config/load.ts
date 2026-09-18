import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import type { RoutingMode } from "../core/types.js";

export const ForgeConfigSchema = z.object({
  mode: z.enum(["local-only", "local-preferred", "cloud-allowed"]).default("local-preferred"),
  local: z
    .object({
      provider: z.literal("ollama").default("ollama"),
      model: z.string().default(""),
      baseUrl: z.string().url().optional(),
    })
    .default({}),
  cloud: z
    .object({
      provider: z.literal("openrouter").default("openrouter"),
      model: z.string().default(""),
      maxCostUsd: z.number().nonnegative().optional(),
    })
    .default({}),
  limits: z
    .object({
      maxTurns: z.number().int().positive().default(20),
      maxRepairs: z.number().int().nonnegative().default(2),
      timeoutMinutes: z.number().positive().default(30),
      maxCloudCostUsd: z.number().nonnegative().default(1),
      maxToolCallsPerTurn: z.number().int().positive().default(20),
      maxContextChars: z.number().int().positive().default(48_000),
      maxCommandOutputChars: z.number().int().positive().default(50_000),
      commandTimeoutMs: z.number().int().positive().default(120_000),
    })
    .default({}),
  scheduler: z
    .object({
      /** Max concurrent DAG nodes (conservative default). */
      maxParallelWorkers: z.number().int().positive().default(2),
    })
    .default({}),
  daemon: z
    .object({
      /** Max concurrent daemon workers. */
      maxWorkers: z.number().int().positive().default(2),
      pollIntervalMs: z.number().int().positive().default(200),
      heartbeatIntervalMs: z.number().int().positive().default(2_000),
      /** Requeue running jobs whose heartbeat is older than this. */
      staleJobMs: z.number().int().positive().default(30_000),
      /** Fire due analysis schedules from the daemon loop. */
      schedulesEnabled: z.boolean().default(true),
    })
    .default({}),
  jobs: z
    .object({
      /** Default interval when CLI omits --every (ms). */
      defaultEveryMs: z.number().int().positive().default(86_400_000),
    })
    .default({}),
  agents: z
    .object({
      /** Enable specialized role selection for agent phases. */
      enabled: z.boolean().default(true),
      phaseRoles: z
        .object({
          implement: z
            .enum([
              "architect",
              "planner",
              "implementer",
              "debugger",
              "tester",
              "reviewer",
            ])
            .default("implementer"),
          repair: z
            .enum([
              "architect",
              "planner",
              "implementer",
              "debugger",
              "tester",
              "reviewer",
            ])
            .default("debugger"),
          escalate: z
            .enum([
              "architect",
              "planner",
              "implementer",
              "debugger",
              "tester",
              "reviewer",
            ])
            .default("debugger"),
        })
        .default({}),
    })
    .default({}),
  verification: z
    .object({
      typecheck: z.boolean().default(true),
      lint: z.boolean().default(true),
      test: z.boolean().default(true),
      build: z.boolean().default(false),
      gitDiffCheck: z.boolean().default(true),
      /** Auto-run Playwright when detected in package.json (or force on/off). */
      playwright: z.enum(["auto", "on", "off"]).default("auto"),
      /** Declarative Forge browser QA scenarios. */
      browserQa: z.enum(["auto", "on", "off"]).default("auto"),
      browserQaDriver: z.enum(["auto", "playwright", "stub"]).default("auto"),
      /** Architecture guardian (.forge/architecture.json). */
      architecture: z.enum(["auto", "on", "off"]).default("auto"),
    })
    .default({}),
  commands: z
    .object({
      allowlist: z.array(z.string()).optional(),
      /** Prefer Docker when available (`auto`), always host, or require Docker. Default host for portable local-first safety. */
      sandbox: z.enum(["auto", "host", "docker"]).default("host"),
      dockerImage: z.string().default("node:22-bookworm-slim"),
      dockerNetworkDisabled: z.boolean().default(true),
      dockerHardened: z.boolean().default(true),
      dockerMemoryLimit: z.string().default("2g"),
      dockerPidsLimit: z.number().int().positive().default(256),
    })
    .default({}),
  execution: z
    .object({
      /**
       * Preferred ExecutionBackend. `auto` uses Docker when available else local.
       * When unset in file, falls back to mapping from commands.sandbox.
       */
      backend: z.enum(["auto", "local", "docker", "remote"]).default("auto"),
      remote: z
        .object({
          endpoint: z.string().optional(),
          tokenEnv: z.string().default("FORGE_REMOTE_EXEC_TOKEN"),
        })
        .default({}),
    })
    .default({}),
  routing: z
    .object({
      /** Use performance history to pick among policy-allowed model candidates. */
      adaptive: z.boolean().default(false),
      localCandidates: z.array(z.string()).optional(),
      cloudCandidates: z.array(z.string()).optional(),
    })
    .default({}),
  git: z
    .object({
      createTaskBranch: z.boolean().default(false),
      /** Isolate each task in a git worktree under .forge/worktrees. */
      useWorktrees: z.boolean().default(false),
      /** Relative path from repo root for Forge worktrees. */
      worktreeBase: z.string().default(".forge/worktrees"),
      /** Acquire exclusive lease on the effective workspace path (also implied by useWorktrees). */
      acquireLease: z.boolean().default(false),
    })
    .default({}),
  approvals: z
    .object({
      /**
       * off — no extra gates (default)
       * prompt — ask on TTY for write/execute (FORGE_AUTO_APPROVE=1 to auto-yes)
       * queue — persist pending approval; resolve via `forge approve` / `forge deny`
       * deny-high-risk — automatically deny write/execute
       */
      mode: z.enum(["off", "prompt", "queue", "deny-high-risk"]).default("off"),
      risks: z
        .array(z.enum(["read", "write", "execute", "network"]))
        .default(["write", "execute"]),
      queueTimeoutMs: z.number().int().positive().default(900_000),
      queuePollMs: z.number().int().positive().default(1_000),
    })
    .default({}),
  tools: z
    .object({
      /** Built-in pack names (e.g. "repository") and/or paths to pack modules. */
      packs: z.array(z.string()).default(["repository"]),
    })
    .default({}),
  skills: z
    .object({
      /** Load and inject relevant skills into worker context. */
      enabled: z.boolean().default(true),
      /** Max skills injected per phase. */
      maxSkills: z.number().int().positive().default(4),
      /** Extra directories containing skill folders. */
      extraPaths: z.array(z.string()).default([]),
      /** Always include these skill ids when present. */
      include: z.array(z.string()).default([]),
      /** Never include these skill ids. */
      exclude: z.array(z.string()).default([]),
    })
    .default({}),
  mcp: z
    .object({
      servers: z
        .array(
          z.object({
            id: z
              .string()
              .min(1)
              .regex(/^[a-z0-9][a-z0-9_-]*$/i),
            command: z.string().min(1),
            args: z.array(z.string()).default([]),
            env: z.record(z.string()).optional(),
            cwd: z.string().optional(),
            enabled: z.boolean().default(false),
            /** Explicit allowlist — empty means no agent exposure. */
            allowedTools: z.array(z.string()).default([]),
            riskOverrides: z
              .record(z.enum(["read", "write", "execute", "network"]))
              .optional(),
            timeoutMs: z.number().int().positive().optional(),
            maxResultChars: z.number().int().positive().optional(),
          }),
        )
        .default([]),
    })
    .default({}),
  databaseUrl: z.string().optional(),
  ui: z
    .object({
      /** Stream model token progress to stderr during long local runs. */
      streamProgress: z.boolean().default(true),
    })
    .default({}),
});

export type ForgeConfig = z.infer<typeof ForgeConfigSchema>;

export interface ResolvedConfig extends ForgeConfig {
  ollamaBaseUrl: string;
  openRouterApiKey: string | null;
  dbPath: string;
  workspacePath: string;
  databaseUrl?: string;
}

export interface CliOverrides {
  mode?: RoutingMode;
  localModel?: string;
  cloudModel?: string;
  maxTurns?: number;
  maxRepairs?: number;
  timeoutMinutes?: number;
  maxCloudCostUsd?: number;
}

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

function loadJsonConfig(workspacePath: string): unknown {
  const path = join(workspacePath, "forge.config.json");
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as unknown;
}

export function loadConfig(
  workspacePath: string,
  overrides: CliOverrides = {},
): ResolvedConfig {
  const fileConfig = loadJsonConfig(workspacePath);
  const parsed = ForgeConfigSchema.parse(fileConfig);

  const mode =
    overrides.mode ??
    (readEnv("FORGE_MODE") as RoutingMode | undefined) ??
    parsed.mode;

  const localModel =
    overrides.localModel ??
    readEnv("OLLAMA_MODEL") ??
    readEnv("FORGE_LOCAL_MODEL") ??
    parsed.local.model;
  const cloudModel =
    overrides.cloudModel ??
    readEnv("OPENROUTER_MODEL") ??
    readEnv("FORGE_CLOUD_MODEL") ??
    parsed.cloud.model;

  const maxTurns =
    overrides.maxTurns ??
    (readEnv("FORGE_MAX_TURNS") ? Number(readEnv("FORGE_MAX_TURNS")) : undefined) ??
    parsed.limits.maxTurns;

  const maxRepairs =
    overrides.maxRepairs ??
    (readEnv("FORGE_MAX_REPAIRS")
      ? Number(readEnv("FORGE_MAX_REPAIRS"))
      : undefined) ??
    parsed.limits.maxRepairs;

  const timeoutMinutes =
    overrides.timeoutMinutes ??
    (readEnv("FORGE_TIMEOUT_MINUTES")
      ? Number(readEnv("FORGE_TIMEOUT_MINUTES"))
      : undefined) ??
    parsed.limits.timeoutMinutes;

  const maxCloudCostUsd =
    overrides.maxCloudCostUsd ??
    (readEnv("OPENROUTER_MAX_COST_USD")
      ? Number(readEnv("OPENROUTER_MAX_COST_USD"))
      : undefined) ??
    parsed.cloud.maxCostUsd ??
    parsed.limits.maxCloudCostUsd;

  const ollamaBaseUrl =
    readEnv("OLLAMA_BASE_URL") ??
    parsed.local.baseUrl ??
    "http://localhost:11434";

  const openRouterApiKey = readEnv("OPENROUTER_API_KEY") ?? null;

  const dbPath = resolve(
    workspacePath,
    readEnv("FORGE_DB_PATH") ?? ".forge/forge.db",
  );

  const databaseUrl = readEnv("FORGE_DATABASE_URL") ?? parsed.databaseUrl;

  return {
    ...parsed,
    mode,
    local: { ...parsed.local, model: localModel, baseUrl: ollamaBaseUrl },
    cloud: { ...parsed.cloud, model: cloudModel, maxCostUsd: maxCloudCostUsd },
    limits: {
      ...parsed.limits,
      maxTurns,
      maxRepairs,
      timeoutMinutes,
      maxCloudCostUsd,
    },
    ollamaBaseUrl,
    openRouterApiKey,
    dbPath,
    databaseUrl,
    workspacePath: resolve(workspacePath),
  };
}

export function defaultConfigJson(): string {
  return `${JSON.stringify(
    {
      mode: "local-preferred",
      local: {
        provider: "ollama",
        model: "",
      },
      cloud: {
        provider: "openrouter",
        model: "",
      },
      limits: {
        maxTurns: 20,
        maxRepairs: 2,
        timeoutMinutes: 30,
        maxCloudCostUsd: 1,
      },
      scheduler: {
        maxParallelWorkers: 2,
      },
      daemon: {
        maxWorkers: 2,
        pollIntervalMs: 200,
        heartbeatIntervalMs: 2000,
        staleJobMs: 30000,
        schedulesEnabled: true,
      },
      jobs: {
        defaultEveryMs: 86400000,
      },
      agents: {
        enabled: true,
        phaseRoles: {
          implement: "implementer",
          repair: "debugger",
          escalate: "debugger",
        },
      },
      verification: {
        typecheck: true,
        lint: true,
        test: true,
        build: false,
        gitDiffCheck: true,
        playwright: "auto",
        browserQa: "auto",
        browserQaDriver: "auto",
        architecture: "auto",
      },
      commands: {
        sandbox: "host",
        dockerImage: "node:22-bookworm-slim",
        dockerNetworkDisabled: true,
        dockerHardened: true,
        dockerMemoryLimit: "2g",
        dockerPidsLimit: 256,
      },
      execution: {
        backend: "auto",
        remote: {
          tokenEnv: "FORGE_REMOTE_EXEC_TOKEN",
        },
      },
      routing: {
        adaptive: false,
      },
      git: {
        createTaskBranch: false,
        useWorktrees: false,
        worktreeBase: ".forge/worktrees",
        acquireLease: false,
      },
      approvals: {
        mode: "off",
        risks: ["write", "execute"],
      },
      tools: {
        packs: ["repository"],
      },
      skills: {
        enabled: true,
        maxSkills: 4,
      },
      mcp: {
        servers: [],
      },
      ui: {
        streamProgress: true,
      },
    },
    null,
    2,
  )}\n`;
}
