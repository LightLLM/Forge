import { describe, expect, it } from "vitest";
import { BudgetTracker } from "../src/core/budgets/tracker.js";

describe("BudgetTracker", () => {
  it("enforces max turns", () => {
    const b = new BudgetTracker({
      maxTurns: 2,
      maxRepairs: 2,
      timeoutMs: 60_000,
      cloudBudgetUsd: 1,
    });
    expect(b.beginTurn()).toBeNull();
    expect(b.beginTurn()).toBeNull();
    expect(b.beginTurn()).toBe("max_turns");
  });

  it("enforces max repairs", () => {
    const b = new BudgetTracker({
      maxTurns: 10,
      maxRepairs: 1,
      timeoutMs: 60_000,
      cloudBudgetUsd: null,
    });
    expect(b.beginRepair()).toBeNull();
    expect(b.beginRepair()).toBe("max_repairs");
  });

  it("enforces timeout", () => {
    const b = new BudgetTracker(
      {
        maxTurns: 10,
        maxRepairs: 2,
        timeoutMs: 1,
        cloudBudgetUsd: null,
      },
      0,
      0,
      0,
      Date.now() - 100,
    );
    expect(b.checkTimeout()).toBe("timeout");
    expect(b.beginTurn()).toBe("timeout");
  });

  it("enforces cloud budget", () => {
    const b = new BudgetTracker({
      maxTurns: 10,
      maxRepairs: 2,
      timeoutMs: 60_000,
      cloudBudgetUsd: 0.5,
    });
    expect(b.addCloudCost(0.4)).toBeNull();
    expect(b.addCloudCost(0.2)).toBe("cloud_budget");
    expect(b.wouldExceedCloudBudget(0.01)).toBe(true);
  });

  it("enforces tool calls per turn", () => {
    const b = new BudgetTracker({
      maxTurns: 10,
      maxRepairs: 2,
      timeoutMs: 60_000,
      cloudBudgetUsd: null,
      maxToolCallsPerTurn: 2,
    });
    b.beginTurn();
    expect(b.recordToolCall()).toBeNull();
    expect(b.recordToolCall()).toBeNull();
    expect(b.recordToolCall()).toBe("tool_calls_per_turn");
  });
});
