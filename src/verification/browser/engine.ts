import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type {
  BrowserAction,
  BrowserDriver,
  BrowserQaResult,
  BrowserScenario,
  BrowserStepResult,
} from "./types.js";
import { StubBrowserDriver } from "./stub-driver.js";
import { PlaywrightBrowserDriver } from "./playwright-driver.js";

export interface BrowserQaOptions {
  workspaceRoot: string;
  artifactDir?: string;
  /** Prefer playwright when installed; otherwise stub. */
  driver?: "auto" | "playwright" | "stub";
  baseUrlOverride?: string;
}

/**
 * Runs declarative browser QA scenarios. Results are deterministic verification —
 * never trust model claims about UI state.
 */
export class BrowserQaEngine {
  constructor(private readonly options: BrowserQaOptions) {}

  loadScenarios(): BrowserScenario[] {
    const roots = [
      join(this.options.workspaceRoot, ".forge", "browserqa"),
      join(this.options.workspaceRoot, "browserqa"),
    ];
    const out: BrowserScenario[] = [];
    for (const root of roots) {
      if (!existsSync(root)) continue;
      for (const name of readdirSync(root)) {
        if (!name.endsWith(".json")) continue;
        try {
          const raw = JSON.parse(
            readFileSync(join(root, name), "utf8"),
          ) as BrowserScenario;
          if (raw?.id && Array.isArray(raw.actions)) out.push(raw);
        } catch {
          // skip invalid
        }
      }
    }
    return out;
  }

  async runScenario(
    scenario: BrowserScenario,
    driver?: BrowserDriver,
  ): Promise<BrowserQaResult> {
    const artifactDir =
      this.options.artifactDir ??
      join(
        this.options.workspaceRoot,
        ".forge",
        "artifacts",
        "browserqa",
        scenario.id,
      );
    mkdirSync(artifactDir, { recursive: true });

    const active = driver ?? (await this.createDriver());
    const steps: BrowserStepResult[] = [];
    const screenshots: string[] = [];

    try {
      let baseUrl = this.options.baseUrlOverride ?? scenario.baseUrl ?? "";
      if (!baseUrl && active instanceof StubBrowserDriver) {
        baseUrl = await active.startLocalFixture();
      }
      if (!baseUrl) {
        throw new Error("Browser QA requires scenario.baseUrl or stub driver");
      }

      await active.start({
        baseUrl,
        viewport: scenario.viewport,
        artifactDir,
      });

      for (const action of scenario.actions) {
        const step = await this.runAction(active, action, artifactDir, screenshots);
        steps.push(step);
        if (!step.ok) {
          return {
            scenarioId: scenario.id,
            status: "failed",
            steps,
            consoleErrors: active.consoleErrors(),
            networkFailures: active.networkFailures(),
            screenshots,
            summary: `Browser QA failed at ${action.type}: ${step.detail}`,
            driver: active.name,
          };
        }
      }

      const consoleErrors = active.consoleErrors();
      const networkFailures = active.networkFailures();
      const ok = consoleErrors.length === 0 && networkFailures.length === 0;
      return {
        scenarioId: scenario.id,
        status: ok ? "passed" : "failed",
        steps,
        consoleErrors,
        networkFailures,
        screenshots,
        summary: ok
          ? `Browser QA passed (${steps.length} steps, driver=${active.name})`
          : "Browser QA completed steps but found console/network issues",
        driver: active.name,
      };
    } finally {
      await active.close().catch(() => undefined);
    }
  }

  async runAll(): Promise<BrowserQaResult[]> {
    const scenarios = this.loadScenarios();
    const results: BrowserQaResult[] = [];
    for (const s of scenarios) {
      results.push(await this.runScenario(s));
    }
    return results;
  }

  private async createDriver(): Promise<BrowserDriver> {
    const mode = this.options.driver ?? "auto";
    if (mode === "stub") return new StubBrowserDriver();
    if (mode === "playwright") return new PlaywrightBrowserDriver();
    if (await PlaywrightBrowserDriver.isAvailable()) {
      return new PlaywrightBrowserDriver();
    }
    return new StubBrowserDriver();
  }

  private async runAction(
    driver: BrowserDriver,
    action: BrowserAction,
    artifactDir: string,
    screenshots: string[],
  ): Promise<BrowserStepResult> {
    const started = Date.now();
    try {
      switch (action.type) {
        case "navigate":
          await driver.navigate(action.target ?? "/");
          break;
        case "click":
          await driver.click(action.target ?? "");
          break;
        case "type":
          await driver.type(action.target ?? "", action.value ?? "");
          break;
        case "waitForText":
        case "assertText": {
          const body = await driver.textContent();
          const expected = action.expected ?? action.value ?? "";
          if (!body.includes(expected)) {
            return {
              action,
              ok: false,
              detail: `Expected text not found: ${expected}`,
              durationMs: Date.now() - started,
            };
          }
          break;
        }
        case "assertUrl": {
          const url = await driver.url();
          const expected = action.expected ?? action.value ?? "";
          if (!url.includes(expected)) {
            return {
              action,
              ok: false,
              detail: `URL ${url} does not include ${expected}`,
              durationMs: Date.now() - started,
            };
          }
          break;
        }
        case "screenshot": {
          const file = join(
            artifactDir,
            action.value ?? action.name ?? `shot-${screenshots.length + 1}.png`,
          );
          await driver.screenshot(file);
          screenshots.push(file);
          break;
        }
        default:
          return {
            action,
            ok: false,
            detail: `Unknown action ${(action as BrowserAction).type}`,
            durationMs: Date.now() - started,
          };
      }
      return {
        action,
        ok: true,
        detail: "ok",
        durationMs: Date.now() - started,
      };
    } catch (err) {
      return {
        action,
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      };
    }
  }
}

export function loadScenarioFile(path: string): BrowserScenario {
  return JSON.parse(readFileSync(path, "utf8")) as BrowserScenario;
}
