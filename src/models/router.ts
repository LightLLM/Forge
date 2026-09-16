import type { ProviderKind, RoutingMode } from "../core/types.js";
import { ForgeError } from "../core/types.js";
import type { ModelProvider } from "./provider.js";

export interface RouterDecision {
  provider: ModelProvider;
  providerKind: ProviderKind;
  model: string;
  reason: string;
  escalated: boolean;
}

export interface RouterInput {
  mode: RoutingMode;
  localModel: string;
  cloudModel: string;
  preferCloud?: boolean;
  escalate?: boolean;
  escalationReason?: string;
  localAvailable: boolean;
  cloudAvailable: boolean;
}

export interface ModelRouter {
  select(input: RouterInput): RouterDecision;
}

/**
 * Deterministic routing rules — replaceable strategy, no AI-based routing in v0.
 */
export class DeterministicModelRouter implements ModelRouter {
  constructor(
    private readonly providers: {
      ollama: ModelProvider;
      openrouter: ModelProvider | null;
      fake?: ModelProvider;
    },
  ) {}

  select(input: RouterInput): RouterDecision {
    // Test hook: explicit fake provider for local (non-escalated) runs
    if (
      this.providers.fake &&
      input.localModel === "fake-model" &&
      !input.escalate &&
      !input.preferCloud
    ) {
      return {
        provider: this.providers.fake,
        providerKind: "fake",
        model: "fake-model",
        reason: "fake provider selected for tests",
        escalated: false,
      };
    }

    if (input.mode === "local-only") {
      if (input.escalate || input.preferCloud) {
        throw new ForgeError(
          "Cannot escalate to cloud in local-only mode",
          "CLOUD_FORBIDDEN",
        );
      }
      if (!input.localAvailable) {
        throw new ForgeError(
          "Ollama unavailable and cloud use is forbidden (local-only)",
          "LOCAL_UNAVAILABLE",
        );
      }
      return {
        provider: this.providers.ollama,
        providerKind: "ollama",
        model: requireModel(input.localModel, "local"),
        reason: "local-only policy",
        escalated: false,
      };
    }

    if (input.mode === "local-preferred") {
      if (input.escalate || input.preferCloud) {
        return this.cloudDecision(input, input.escalationReason ?? "escalation requested");
      }
      if (input.localAvailable) {
        return {
          provider: this.providers.ollama,
          providerKind: "ollama",
          model: requireModel(input.localModel, "local"),
          reason: "local-preferred: trying Ollama first",
          escalated: false,
        };
      }
      return this.cloudDecision(input, "Ollama unavailable; falling back to cloud");
    }

    // cloud-allowed
    if (input.escalate || input.preferCloud || !input.localAvailable) {
      return this.cloudDecision(
        input,
        input.escalationReason ??
          (input.preferCloud ? "cloud preferred by policy" : "local unavailable"),
      );
    }
    return {
      provider: this.providers.ollama,
      providerKind: "ollama",
      model: requireModel(input.localModel, "local"),
      reason: "cloud-allowed: local still preferred when healthy",
      escalated: false,
    };
  }

  private cloudDecision(input: RouterInput, reason: string): RouterDecision {
    if (!this.providers.openrouter || !input.cloudAvailable) {
      throw new ForgeError(
        "Cloud provider unavailable or not configured",
        "CLOUD_UNAVAILABLE",
        { reason },
      );
    }
    return {
      provider: this.providers.openrouter,
      providerKind: "openrouter",
      model: requireModel(input.cloudModel, "cloud"),
      reason,
      escalated: true,
    };
  }
}

function requireModel(model: string, kind: string): string {
  if (!model || !model.trim()) {
    throw new ForgeError(
      `No ${kind} model configured. Set OLLAMA_MODEL / OPENROUTER_MODEL or forge.config.json`,
      "MODEL_NOT_CONFIGURED",
    );
  }
  return model.trim();
}
