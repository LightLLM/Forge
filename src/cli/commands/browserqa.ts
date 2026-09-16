import type { Command } from "commander";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { loadConfig } from "../../config/load.js";
import {
  BrowserQaEngine,
  loadScenarioFile,
  StubBrowserDriver,
} from "../../verification/browser/index.js";
import { loadDotEnv, resolveWorkspace } from "../env.js";

export function registerBrowserQa(program: Command): void {
  const cmd = program
    .command("browserqa")
    .description("Run Forge declarative browser QA scenarios");

  cmd
    .command("list")
    .description("List browser QA scenarios")
    .action(() => {
      const workspace = resolveWorkspace();
      const engine = new BrowserQaEngine({ workspaceRoot: workspace });
      const list = engine.loadScenarios();
      if (list.length === 0) {
        console.log("No scenarios found in .forge/browserqa or browserqa/");
        return;
      }
      for (const s of list) {
        console.log(`${s.id.padEnd(24)} ${s.name} (${s.actions.length} actions)`);
      }
    });

  cmd
    .command("run")
    .description("Run browser QA scenarios")
    .argument("[scenario-id]", "Optional scenario id (default: all)")
    .option("--driver <driver>", "auto|playwright|stub", "auto")
    .option("--workspace <path>", "Workspace path")
    .action(
      async (
        scenarioId: string | undefined,
        opts: { driver: string; workspace?: string },
      ) => {
        const workspace = resolve(opts.workspace ?? resolveWorkspace());
        loadDotEnv(workspace);
        loadConfig(workspace);
        const driver = opts.driver as "auto" | "playwright" | "stub";
        const engine = new BrowserQaEngine({
          workspaceRoot: workspace,
          driver,
        });

        try {
          let results;
          if (scenarioId) {
            const all = engine.loadScenarios();
            const scenario = all.find((s) => s.id === scenarioId);
            if (!scenario) {
              const path = resolve(workspace, scenarioId);
              if (!existsSync(path)) {
                console.error(`Scenario not found: ${scenarioId}`);
                process.exitCode = 1;
                return;
              }
              results = [await engine.runScenario(loadScenarioFile(path))];
            } else {
              results = [await engine.runScenario(scenario)];
            }
          } else {
            results = await engine.runAll();
          }

          if (results.length === 0) {
            console.log("No scenarios to run.");
            return;
          }
          for (const r of results) {
            console.log(
              `${r.status === "passed" ? "✓" : "✗"} ${r.scenarioId} [${r.driver}] ${r.summary}`,
            );
            for (const shot of r.screenshots) {
              console.log(`    screenshot: ${shot}`);
            }
          }
          if (results.some((r) => r.status !== "passed")) process.exitCode = 1;
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
          process.exitCode = 1;
        }
      },
    );

  cmd
    .command("demo")
    .description("Run built-in login demo with stub driver (no Playwright required)")
    .action(async () => {
      const workspace = resolveWorkspace();
      const scenario = {
        id: "demo-login",
        name: "Built-in login demo",
        actions: [
          { type: "navigate" as const, target: "/" },
          { type: "assertText" as const, expected: "Sign in" },
          { type: "type" as const, target: "#username", value: "demo" },
          { type: "type" as const, target: "#password", value: "demo" },
          { type: "screenshot" as const, value: "demo-before.png" },
          { type: "click" as const, target: "#login-btn" },
          { type: "assertText" as const, expected: "Login successful" },
          { type: "screenshot" as const, value: "demo-after.png" },
        ],
      };
      const engine = new BrowserQaEngine({
        workspaceRoot: workspace,
        driver: "stub",
      });
      const result = await engine.runScenario(scenario, new StubBrowserDriver());
      console.log(JSON.stringify(result, null, 2));
      if (result.status !== "passed") process.exitCode = 1;
    });
}
