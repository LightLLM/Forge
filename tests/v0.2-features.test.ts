import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createApprovalGate,
  DenyHighRiskGate,
  riskNeedsApproval,
} from "../src/policy/approvals.js";
import { DefaultPolicyEngine, authorizeAndExecute } from "../src/policy/engine.js";
import { createRepositoryTools } from "../src/tools/repository.js";
import { buildDockerRunArgs } from "../src/tools/sandbox.js";
import { rankRelevantFiles } from "../src/context/relevance.js";
import { Workspace } from "../src/workspace/workspace.js";
import { ForgeConfigSchema } from "../src/config/load.js";
import { rootLogger } from "../src/telemetry/logger.js";

describe("approval gates", () => {
  const tools = createRepositoryTools();
  const writeTool = tools.find((t) => t.name === "write_file");

  it("riskNeedsApproval respects mode", () => {
    expect(
      riskNeedsApproval({ mode: "off", risks: ["write"] }, "write"),
    ).toBe(false);
    expect(
      riskNeedsApproval({ mode: "deny-high-risk", risks: ["write"] }, "write"),
    ).toBe(true);
    expect(
      riskNeedsApproval({ mode: "prompt", risks: ["execute"] }, "write"),
    ).toBe(false);
  });

  it("deny-high-risk blocks writes after policy allow", async () => {
    const policy = new DefaultPolicyEngine({
      allowWrites: true,
      allowExecute: true,
      approvals: { mode: "deny-high-risk", risks: ["write", "execute"] },
    });
    const gate = new DenyHighRiskGate();
    const dir = mkdtempSync(join(tmpdir(), "forge-appr-"));
    try {
      const result = await authorizeAndExecute(
        {
          id: "1",
          name: "write_file",
          arguments: { path: "a.ts", content: "x" },
        },
        writeTool,
        policy,
        {
          workspace: new Workspace(dir),
          taskId: "t",
          runId: "r",
          logger: rootLogger,
          commandTimeoutMs: 1000,
          maxCommandOutputChars: 1000,
          commandAllowlist: [],
        },
        gate,
      );
      expect(result.denied).toBe(true);
      expect(result.denialReason).toMatch(/denied/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("createApprovalGate returns deny gate for deny-high-risk", async () => {
    const gate = createApprovalGate({
      mode: "deny-high-risk",
      risks: ["write"],
    });
    expect(await gate.decide({
      taskId: "t",
      toolName: "write_file",
      risk: "write",
      summary: "path: a.ts",
    })).toBe("denied");
  });
});

describe("hardened docker args", () => {
  it("includes security flags when hardened", () => {
    const args = buildDockerRunArgs("pnpm test", "C:/proj", {
      mode: "docker",
      image: "node:22-bookworm-slim",
      networkDisabled: true,
      hardened: true,
    });
    expect(args).toContain("--security-opt");
    expect(args).toContain("no-new-privileges");
    expect(args).toContain("--cap-drop");
    expect(args).toContain("ALL");
    expect(args).toContain("--read-only");
    expect(args).toContain("--network");
    expect(args).toContain("none");
  });

  it("can disable hardening", () => {
    const args = buildDockerRunArgs("pnpm test", "/proj", {
      mode: "docker",
      image: "node:22",
      networkDisabled: false,
      hardened: false,
    });
    expect(args).not.toContain("--cap-drop");
    expect(args).not.toContain("--read-only");
  });
});

describe("relevance ranking", () => {
  it("prefers entrypoints and keyword hits", () => {
    const dir = mkdtempSync(join(tmpdir(), "forge-rel-"));
    try {
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "x", main: "src/index.ts" }),
      );
      writeFileSync(join(dir, "src", "index.ts"), `export * from "./signup.js";\n`);
      writeFileSync(join(dir, "src", "signup.ts"), `export function signup() {}\n`);
      writeFileSync(join(dir, "src", "unrelated.ts"), `export const n = 1;\n`);
      const ws = new Workspace(dir);
      const ranked = rankRelevantFiles(ws, {
        keywords: ["signup"],
        changedPaths: ["src/signup.ts"],
      });
      expect(ranked[0]).toBeDefined();
      expect(ranked.some((p) => p.includes("signup"))).toBe(true);
      expect(ranked).toContain("src/index.ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("v0.2 config", () => {
  it("defaults approvals off and docker hardened", () => {
    const cfg = ForgeConfigSchema.parse({});
    expect(cfg.approvals.mode).toBe("off");
    expect(cfg.commands.dockerHardened).toBe(true);
  });
});
