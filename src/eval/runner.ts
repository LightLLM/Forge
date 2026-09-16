import { randomUUID } from "node:crypto";
import { FakeModelProvider, type FakeScriptStep } from "../models/fake.js";
import type {
  EvalCaseResult,
  EvalDataset,
  EvalModelSummary,
  EvalRunReport,
} from "./types.js";

function scriptForProfile(profile: string): FakeScriptStep[] {
  switch (profile) {
    case "success":
      return [{ type: "message", content: "ok: task completed successfully" }];
    case "fail_tools":
      return [{ type: "tool_calls", toolCalls: [{ name: "wrong_tool", arguments: {} }] }];
    case "fail_message":
      return [{ type: "message", content: "error: could not complete" }];
    default:
      return [{ type: "message", content: "unknown profile" }];
  }
}

/**
 * Deterministic evaluation runner — compares fake model profiles without live APIs.
 */
export class EvalRunner {
  async run(dataset: EvalDataset): Promise<EvalRunReport> {
    const startedAt = new Date().toISOString();
    const results: EvalCaseResult[] = [];

    for (const model of dataset.models) {
      for (const testCase of dataset.cases) {
        const t0 = Date.now();
        const provider = new FakeModelProvider(scriptForProfile(model.profile));
        try {
          const response = await provider.generate({
            model: model.id,
            messages: [{ role: "user", content: testCase.prompt }],
            tools: [],
          });
          const latencyMs = Date.now() - t0;
          let passed = false;
          let detail = "";
          if (testCase.expectContent) {
            passed = (response.content ?? "").includes(testCase.expectContent);
            detail = passed ? "content matched" : `expected '${testCase.expectContent}'`;
          } else if (testCase.expectTool) {
            passed = response.toolCalls.some((t) => t.name === testCase.expectTool);
            detail = passed ? "tool matched" : `expected tool '${testCase.expectTool}'`;
          } else {
            passed = response.finishReason !== "cancelled";
            detail = passed ? "response received" : "cancelled";
          }
          results.push({ caseId: testCase.id, modelId: model.id, passed, detail, latencyMs });
        } catch (err) {
          results.push({
            caseId: testCase.id,
            modelId: model.id,
            passed: false,
            detail: err instanceof Error ? err.message : String(err),
            latencyMs: Date.now() - t0,
          });
        }
      }
    }

    return {
      runId: randomUUID(),
      datasetId: dataset.id,
      startedAt,
      finishedAt: new Date().toISOString(),
      results,
      summaries: summarize(results, dataset.models.map((m) => m.id)),
    };
  }
}

function summarize(results: EvalCaseResult[], modelIds: string[]): EvalModelSummary[] {
  return modelIds.map((modelId) => {
    const rows = results.filter((r) => r.modelId === modelId);
    const passed = rows.filter((r) => r.passed).length;
    return {
      modelId,
      passed,
      failed: rows.length - passed,
      passRate: rows.length === 0 ? 0 : passed / rows.length,
      avgLatencyMs:
        rows.length === 0
          ? 0
          : Math.round(rows.reduce((s, r) => s + r.latencyMs, 0) / rows.length),
    };
  });
}
