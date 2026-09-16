import type { ModelProvider } from "../models/provider.js";
import {
  DeterministicModelRouter,
  type ModelRouter,
  type RouterDecision,
  type RouterInput,
} from "../models/router.js";
import { ForgeError } from "../core/types.js";
import type { PerformanceStore } from "./performance-store.js";

export interface AdaptiveRouterInput extends RouterInput {
  taskCategory?: string;
  localCandidates?: string[];
  cloudCandidates?: string[];
}

/**
 * Performance-aware router that never overrides routing policy.
 * Picks the best-performing model only among candidates allowed by policy.
 */
export class AdaptiveModelRouter implements ModelRouter {
  private readonly base: DeterministicModelRouter;

  constructor(
    providers: {
      ollama: ModelProvider;
      openrouter: ModelProvider | null;
      fake?: ModelProvider;
    },
    private readonly performance: PerformanceStore,
  ) {
    this.base = new DeterministicModelRouter(providers);
  }

  select(input: AdaptiveRouterInput): RouterDecision {
    const policy = this.base.select(input);

    const providerKind = policy.providerKind;
    const candidates =
      providerKind === "openrouter"
        ? (input.cloudCandidates ?? [input.cloudModel]).filter(Boolean)
        : (input.localCandidates ?? [input.localModel]).filter(Boolean);

    if (candidates.length <= 1) {
      return policy;
    }

    // Policy envelope: adaptive must not switch provider kind
    const best = this.performance.bestModel(
      providerKind,
      candidates,
      input.taskCategory ?? "general",
    );

    // local-only must never pick cloud even if stats favor it (enforced by base already)
    if (input.mode === "local-only" && providerKind === "openrouter") {
      throw new ForgeError(
        "Adaptive router attempted cloud under local-only",
        "POLICY_VIOLATION",
      );
    }

    return {
      ...policy,
      model: best.model,
      reason: `${policy.reason}; adaptive pick ${best.model} (success=${best.successRate.toFixed(2)}, n=${best.samples})`,
    };
  }
}
