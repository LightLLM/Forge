import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { ArchitectureEvaluator } from "../src/architecture/index.js";
import { VerificationEngine } from "../src/verification/engine.js";
import { Workspace } from "../src/workspace/workspace.js";

describe("M16 architecture guardian", () => {
  it("passes when architecture rules are satisfied", () => {
    const root = resolve("fixtures/architecture-ok");
    const result = new ArchitectureEvaluator().evaluate(root);
    expect(result.ok).toBe(true);
    expect(result.rulesChecked).toBe(1);
  });

  it("gate: intentional architecture violation causes verification failure", async () => {
    const root = resolve("fixtures/architecture-violation");
    const evalResult = new ArchitectureEvaluator().evaluate(root);
    expect(evalResult.ok).toBe(false);
    expect(evalResult.violations[0]?.ruleId).toBe("ui-no-db");

    const engine = new VerificationEngine({
      typecheck: false,
      lint: false,
      test: false,
      build: false,
      gitDiffCheck: false,
      playwright: "off",
      browserQa: "off",
      architecture: "on",
      commandTimeoutMs: 5_000,
      maxCommandOutputChars: 10_000,
    });
    const verification = await engine.verify(new Workspace(root));
    expect(verification.status).toBe("failed");
    expect(verification.checks.some((c) => c.name === "architecture" && c.status === "failed")).toBe(
      true,
    );
  });
});
