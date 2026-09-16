import { describe, expect, it } from "vitest";
import { DeterministicModelRouter } from "../src/models/router.js";
import { FakeModelProvider } from "../src/models/fake.js";
import { ForgeError } from "../src/core/types.js";
import type { ModelProvider } from "../src/models/provider.js";

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
        estimatedCostUsd: name === "openrouter" ? 0.01 : 0,
        costKnown: true,
      },
    }),
  };
}

describe("DeterministicModelRouter", () => {
  const fake = new FakeModelProvider();
  const ollama = stubProvider("ollama");
  const openrouter = stubProvider("openrouter");
  const router = new DeterministicModelRouter({ ollama, openrouter, fake });

  it("local-only stays on ollama", () => {
    const d = router.select({
      mode: "local-only",
      localModel: "llama3",
      cloudModel: "openai/gpt-4o",
      localAvailable: true,
      cloudAvailable: true,
    });
    expect(d.providerKind).toBe("ollama");
    expect(d.escalated).toBe(false);
  });

  it("local-only refuses escalation", () => {
    expect(() =>
      router.select({
        mode: "local-only",
        localModel: "llama3",
        cloudModel: "openai/gpt-4o",
        localAvailable: true,
        cloudAvailable: true,
        escalate: true,
      }),
    ).toThrow(ForgeError);
  });

  it("local-only fails when ollama unavailable", () => {
    expect(() =>
      router.select({
        mode: "local-only",
        localModel: "llama3",
        cloudModel: "openai/gpt-4o",
        localAvailable: false,
        cloudAvailable: true,
      }),
    ).toThrow(/local-only/i);
  });

  it("local-preferred escalates after failure", () => {
    const d = router.select({
      mode: "local-preferred",
      localModel: "llama3",
      cloudModel: "openai/gpt-4o",
      localAvailable: true,
      cloudAvailable: true,
      escalate: true,
      escalationReason: "repairs exhausted",
    });
    expect(d.providerKind).toBe("openrouter");
    expect(d.escalated).toBe(true);
  });

  it("local-preferred uses local first", () => {
    const d = router.select({
      mode: "local-preferred",
      localModel: "llama3",
      cloudModel: "openai/gpt-4o",
      localAvailable: true,
      cloudAvailable: true,
    });
    expect(d.providerKind).toBe("ollama");
  });

  it("cloud-allowed can choose cloud when local unavailable", () => {
    const d = router.select({
      mode: "cloud-allowed",
      localModel: "llama3",
      cloudModel: "openai/gpt-4o",
      localAvailable: false,
      cloudAvailable: true,
    });
    expect(d.providerKind).toBe("openrouter");
  });

  it("fails when cloud unavailable on escalate", () => {
    const noCloud = new DeterministicModelRouter({ ollama, openrouter: null });
    expect(() =>
      noCloud.select({
        mode: "local-preferred",
        localModel: "llama3",
        cloudModel: "openai/gpt-4o",
        localAvailable: true,
        cloudAvailable: false,
        escalate: true,
      }),
    ).toThrow(ForgeError);
  });

  it("selects fake provider for tests", () => {
    const d = router.select({
      mode: "local-only",
      localModel: "fake-model",
      cloudModel: "",
      localAvailable: true,
      cloudAvailable: false,
    });
    expect(d.providerKind).toBe("fake");
  });

  it("does not force fake when escalating", () => {
    const d = router.select({
      mode: "local-preferred",
      localModel: "fake-model",
      cloudModel: "openai/gpt-4o",
      localAvailable: true,
      cloudAvailable: true,
      escalate: true,
    });
    expect(d.providerKind).toBe("openrouter");
    expect(d.escalated).toBe(true);
  });
});
