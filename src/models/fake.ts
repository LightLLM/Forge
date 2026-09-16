import { randomUUID } from "node:crypto";
import type {
  ModelCapabilities,
  ModelRequest,
  ModelResponse,
  ToolCallProposal,
} from "../core/types.js";
import type { ModelProvider } from "./provider.js";

export type FakeScriptStep =
  | {
      type: "tool_calls";
      toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
      content?: string;
    }
  | { type: "message"; content: string }
  | { type: "error"; message: string };

/**
 * Deterministic provider for tests. Scripts are consumed in order per generate() call.
 */
export class FakeModelProvider implements ModelProvider {
  readonly name = "fake";
  private cursor = 0;
  private readonly script: FakeScriptStep[];

  constructor(script: FakeScriptStep[] = []) {
    this.script = script;
  }

  capabilities(): ModelCapabilities {
    return {
      provider: "fake",
      supportsTools: true,
      supportsStreaming: false,
      maxContextTokens: 128_000,
      local: true,
    };
  }

  async listModels(): Promise<string[]> {
    return ["fake-model"];
  }

  async ping(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: "fake provider ready" };
  }

  reset(script?: FakeScriptStep[]): void {
    if (script) {
      this.script.splice(0, this.script.length, ...script);
    }
    this.cursor = 0;
  }

  remaining(): number {
    return this.script.length - this.cursor;
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    if (request.signal?.aborted) {
      return {
        content: null,
        toolCalls: [],
        finishReason: "cancelled",
        usage: {
          provider: "fake",
          model: request.model,
          promptTokens: 0,
          completionTokens: 0,
          estimatedCostUsd: 0,
          costKnown: true,
        },
      };
    }

    const step = this.script[this.cursor];
    this.cursor += 1;

    if (!step) {
      return {
        content: "No further scripted actions. Marking done.",
        toolCalls: [],
        finishReason: "stop",
        usage: usage(request.model, 10, 5),
      };
    }

    if (step.type === "error") {
      throw new Error(step.message);
    }

    if (step.type === "message") {
      return {
        content: step.content,
        toolCalls: [],
        finishReason: "stop",
        usage: usage(request.model, 20, 10),
      };
    }

    const toolCalls: ToolCallProposal[] = step.toolCalls.map((tc) => ({
      id: `call_${randomUUID().slice(0, 8)}`,
      name: tc.name,
      arguments: tc.arguments,
    }));

    return {
      content: step.content ?? null,
      toolCalls,
      finishReason: "tool_calls",
      usage: usage(request.model, 30, 15),
    };
  }
}

function usage(model: string, prompt: number, completion: number) {
  return {
    provider: "fake" as const,
    model,
    promptTokens: prompt,
    completionTokens: completion,
    estimatedCostUsd: 0,
    costKnown: true,
  };
}
