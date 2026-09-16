import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { VerificationCheck, VerificationResult } from "../core/types.js";
import {
  DEFAULT_COMMAND_ALLOWLIST,
  runAllowedCommand,
} from "../tools/repository.js";
import type { SandboxOptions } from "../tools/sandbox.js";
import type { Workspace } from "../workspace/workspace.js";
import { BrowserQaEngine } from "./browser/index.js";
import { ArchitectureEvaluator } from "../architecture/index.js";

export interface VerificationOptions {
  typecheck: boolean;
  lint: boolean;
  test: boolean;
  build: boolean;
  gitDiffCheck: boolean;
  playwright: "auto" | "on" | "off";
  /** Forge declarative browser QA scenarios (.forge/browserqa/*.json). */
  browserQa: "auto" | "on" | "off";
  browserQaDriver?: "auto" | "playwright" | "stub";
  /**
   * Architecture guardian (.forge/architecture.json).
   * auto — run when policy file present; on — require policy; off — skip.
   * Defaults to auto when omitted.
   */
  architecture?: "auto" | "on" | "off";
  commandTimeoutMs: number;
  maxCommandOutputChars: number;
  commandAllowlist?: string[];
  packageManager?: "pnpm" | "npm";
  sandbox?: SandboxOptions;
}

/**
 * Independent verification. Model self-reports are never treated as proof.
 */
export class VerificationEngine {
  constructor(private readonly options: VerificationOptions) {}

  async verify(workspace: Workspace): Promise<VerificationResult> {
    const pkg = readPackageJson(workspace.root);
    const scripts = pkg.scripts ?? {};
    const pm = this.options.packageManager ?? detectPackageManager(workspace.root);
    const allowlist = [
      ...DEFAULT_COMMAND_ALLOWLIST,
      ...(this.options.commandAllowlist ?? []),
      `${pm} test`,
      `${pm} run`,
      `${pm} exec`,
      "npx playwright",
    ];

    const checks: VerificationCheck[] = [];

    if (this.options.gitDiffCheck) {
      checks.push(
        await this.runCheck("git_diff_check", "git diff --check", workspace, allowlist),
      );
    }

    if (this.options.typecheck) {
      const cmd = pickCommand(scripts, pm, ["typecheck", "type-check"], "tsc --noEmit");
      if (cmd) {
        checks.push(await this.runCheck("typecheck", cmd, workspace, allowlist));
      } else {
        checks.push({ name: "typecheck", status: "skipped" });
      }
    }

    if (this.options.lint) {
      const cmd = pickCommand(scripts, pm, ["lint"], null);
      if (cmd) {
        checks.push(await this.runCheck("lint", cmd, workspace, allowlist));
      } else {
        checks.push({ name: "lint", status: "skipped" });
      }
    }

    if (this.options.test) {
      const cmd = pickCommand(scripts, pm, ["test"], null);
      if (cmd) {
        checks.push(await this.runCheck("tests", cmd, workspace, allowlist));
      } else {
        checks.push({ name: "tests", status: "skipped" });
      }
    }

    if (this.options.build) {
      const cmd = pickCommand(scripts, pm, ["build"], null);
      if (cmd) {
        checks.push(await this.runCheck("build", cmd, workspace, allowlist));
      } else {
        checks.push({ name: "build", status: "skipped" });
      }
    }

    const playwrightCmd = resolvePlaywrightCommand(
      this.options.playwright,
      pkg,
      scripts,
      pm,
    );
    if (playwrightCmd) {
      checks.push(await this.runCheck("playwright", playwrightCmd, workspace, allowlist));
    } else if (this.options.playwright === "on") {
      checks.push({
        name: "playwright",
        status: "failed",
        stderr: "Playwright forced on but no script/dependency detected",
      });
    }

    const browserQaCheck = await this.runBrowserQa(workspace);
    if (browserQaCheck) checks.push(browserQaCheck);

    const architectureCheck = this.runArchitecture(workspace);
    if (architectureCheck) checks.push(architectureCheck);

    const failed = checks.filter((c) => c.status === "failed");
    const runnable = checks.filter((c) => c.status !== "skipped");
    const status: VerificationResult["status"] =
      runnable.length === 0
        ? "skipped"
        : failed.length > 0
          ? "failed"
          : "passed";

    return {
      status,
      checks,
      summary:
        status === "passed"
          ? `All ${runnable.length} check(s) passed`
          : status === "skipped"
            ? "No verification checks configured or available"
            : `${failed.length} check(s) failed: ${failed.map((f) => f.name).join(", ")}`,
    };
  }

  private async runCheck(
    name: string,
    command: string,
    workspace: Workspace,
    allowlist: string[],
  ): Promise<VerificationCheck> {
    const started = Date.now();
    try {
      const result = await runAllowedCommand(command, {
        workspace,
        commandAllowlist: allowlist,
        commandTimeoutMs: this.options.commandTimeoutMs,
        maxCommandOutputChars: this.options.maxCommandOutputChars,
        sandbox: this.options.sandbox,
      });
      const ok = !result.timedOut && result.exitCode === 0;
      return {
        name,
        status: ok ? "passed" : "failed",
        exitCode: result.exitCode ?? undefined,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: Date.now() - started,
        command: `${command} [${result.backend}]`,
      };
    } catch (err) {
      return {
        name,
        status: "failed",
        stderr: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
        command,
      };
    }
  }

  private runArchitecture(workspace: Workspace): VerificationCheck | null {
    const mode = this.options.architecture ?? "auto";
    if (mode === "off") return null;

    const hasPolicy =
      existsSync(join(workspace.root, ".forge", "architecture.json")) ||
      existsSync(join(workspace.root, "architecture.json"));

    if (mode === "auto" && !hasPolicy) return null;
    if (mode === "on" && !hasPolicy) {
      return {
        name: "architecture",
        status: "failed",
        stderr:
          "architecture forced on but no .forge/architecture.json or architecture.json",
      };
    }

    const started = Date.now();
    try {
      const result = new ArchitectureEvaluator().evaluate(workspace.root);
      if (result.rulesChecked === 0) {
        return {
          name: "architecture",
          status: "skipped",
          durationMs: Date.now() - started,
        };
      }
      if (result.ok) {
        return {
          name: "architecture",
          status: "passed",
          stdout: `${result.rulesChecked} rule(s) checked`,
          durationMs: Date.now() - started,
        };
      }
      return {
        name: "architecture",
        status: "failed",
        stderr: result.violations
          .map((v) => `${v.ruleId}: ${v.fromFile} → ${v.toFile} (${v.description})`)
          .join("\n"),
        durationMs: Date.now() - started,
      };
    } catch (err) {
      return {
        name: "architecture",
        status: "failed",
        stderr: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      };
    }
  }

  private async runBrowserQa(workspace: Workspace): Promise<VerificationCheck | null> {
    const mode = this.options.browserQa ?? "auto";
    if (mode === "off") return null;

    const hasScenarios =
      existsSync(join(workspace.root, ".forge", "browserqa")) ||
      existsSync(join(workspace.root, "browserqa"));
    if (mode === "auto" && !hasScenarios) return null;
    if (mode === "on" && !hasScenarios) {
      return {
        name: "browser_qa",
        status: "failed",
        stderr:
          "browserQa forced on but no scenarios in .forge/browserqa or browserqa/",
      };
    }

    const started = Date.now();
    try {
      const engine = new BrowserQaEngine({
        workspaceRoot: workspace.root,
        driver: this.options.browserQaDriver ?? "auto",
      });
      const results = await engine.runAll();
      if (results.length === 0) {
        return {
          name: "browser_qa",
          status: "skipped",
          durationMs: Date.now() - started,
        };
      }
      const failed = results.filter((r) => r.status === "failed");
      return {
        name: "browser_qa",
        status: failed.length === 0 ? "passed" : "failed",
        stdout: results.map((r) => r.summary).join("\n"),
        stderr: failed.map((r) => r.summary).join("\n") || undefined,
        durationMs: Date.now() - started,
        command: `browserqa:${results.map((r) => r.scenarioId).join(",")}`,
      };
    } catch (err) {
      return {
        name: "browser_qa",
        status: "failed",
        stderr: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      };
    }
  }
}

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPackageJson(root: string): PackageJson {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) return {};
  try {
    return JSON.parse(readFileSync(pkgPath, "utf8")) as PackageJson;
  } catch {
    return {};
  }
}

export function hasPlaywright(pkg: PackageJson): boolean {
  const deps = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  };
  if ("@playwright/test" in deps || "playwright" in deps) return true;
  const scripts = pkg.scripts ?? {};
  return Object.values(scripts).some((s) => /\bplaywright\b/i.test(s));
}

function resolvePlaywrightCommand(
  mode: "auto" | "on" | "off",
  pkg: PackageJson,
  scripts: Record<string, string>,
  pm: "pnpm" | "npm",
): string | null {
  if (mode === "off") return null;
  const detected = hasPlaywright(pkg);
  if (mode === "auto" && !detected) return null;
  if (mode === "on" && !detected) return null;

  const scriptCmd = pickCommand(
    scripts,
    pm,
    ["test:e2e", "e2e", "playwright", "test:playwright"],
    null,
  );
  if (scriptCmd) return scriptCmd;
  return "npx playwright test";
}

function detectPackageManager(root: string): "pnpm" | "npm" {
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
  return "npm";
}

function pickCommand(
  scripts: Record<string, string>,
  pm: "pnpm" | "npm",
  scriptNames: string[],
  fallback: string | null,
): string | null {
  for (const name of scriptNames) {
    if (scripts[name]) {
      return pm === "pnpm" ? `pnpm run ${name}` : `npm run ${name}`;
    }
  }
  return fallback;
}
