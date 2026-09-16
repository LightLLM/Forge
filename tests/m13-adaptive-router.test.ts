import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AdaptiveModelRouter } from "../src/routing/adaptive-router.js";
import { PerformanceStore } from "../src/routing/performance-store.js";
import { DeterministicModelRouter } from "../src/models/router.js";
import { ForgeError } from "../src/core/types.js";
import type { ModelProvider } from "../src/models/provider.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const d of tempDirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

function mkdtemp(): string {
  const d = mkdtempSync(join(tmpdir(), "forge-m13-"));
  tempDirs.push(d);
  return d;
}

function stubProvider(name: string): ModelProvider {
  return {
    name,
    capabilities: () => ({
      provider: name === "openrouter" ? "openrouter" : "ollama",
      supportsTools: true,
      supportsStreaming: false,
      maxContextTokens: null,
      local: name !== "openrouter",
    }),
    generate: async () => ({
      content: "ok",
      toolCalls: [],
      finishReason: "stop",
      usage: {
        provider: name === "openrouter" ? "openrouter" : "ollama",
        model: "x",
        promptTokens: 1,
        completionTokens: 1,
        estimatedCostUsd: 0,
        costKnown: true,
      },
    }),
  };
}

describe("M13 adaptive router", () => {
  it("gate: picks higher-performing model among policy-allowed local candidates", () => {
    const dir = mkdtemp();
    const perf = new PerformanceStore(join(dir, "forge.db"));
    perf.initialize();
    for (let i = 0; i < 5; i++) {
      perf.record({
        providerKind: "ollama",
        model: "fast-local",
        taskCategory: "coding",
        success: true,
        latencyMs: 50,
        costUsd: 0,
      });
      perf.record({
        providerKind: "ollama",
        model: "slow-local",
        taskCategory: "coding",
        success: false,
        latencyMs: 200,
        costUsd: 0,
      });
    }

    const router = new AdaptiveModelRouter(
      { ollama: stubProvider("ollama"), openrouter: stubProvider("openrouter") },
      perf,
    );

    const d = router.select({
      mode: "local-only",
      localModel: "slow-local",
      cloudModel: "cloud/gpt",
      localAvailable: true,
      cloudAvailable: true,
      localCandidates: ["slow-local", "fast-local"],
      taskCategory: "coding",
    });
    expect(d.providerKind).toBe("ollama");
    expect(d.model).toBe("fast-local");
    expect(d.reason).toMatch(/adaptive/i);
    perf.close();
  });

  it("gate: local-only policy is never overridden by cloud performance", () => {
    const dir = mkdtemp();
    const perf = new PerformanceStore(join(dir, "forge.db"));
    perf.initialize();
    for (let i = 0; i < 10; i++) {
      perf.record({
        providerKind: "openrouter",
        model: "cloud-star",
        taskCategory: "general",
        success: true,
        latencyMs: 10,
        costUsd: 0.01,
      });
      perf.record({
        providerKind: "ollama",
        model: "local-weak",
        taskCategory: "general",
        success: false,
        latencyMs: 500,
        costUsd: 0,
      });
    }

    const adaptive = new AdaptiveModelRouter(
      { ollama: stubProvider("ollama"), openrouter: stubProvider("openrouter") },
      perf,
    );
    const base = new DeterministicModelRouter({
      ollama: stubProvider("ollama"),
      openrouter: stubProvider("openrouter"),
    });

    const d = adaptive.select({
      mode: "local-only",
      localModel: "local-weak",
      cloudModel: "cloud-star",
      localAvailable: true,
      cloudAvailable: true,
      localCandidates: ["local-weak"],
    });
    expect(d.providerKind).not.toBe("openrouter");

    expect(() =>
      base.select({
        mode: "local-only",
        localModel: "local-weak",
        cloudModel: "cloud-star",
        localAvailable: true,
        cloudAvailable: true,
        escalate: true,
      }),
    ).toThrow(ForgeError);

    expect(() =>
      adaptive.select({
        mode: "local-only",
        localModel: "local-weak",
        cloudModel: "cloud-star",
        localAvailable: true,
        cloudAvailable: true,
        escalate: true,
      }),
    ).toThrow(ForgeError);

    perf.close();
  });
});
