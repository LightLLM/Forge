import { randomUUID } from "node:crypto";
import type {
  ModelCapabilities,
  ModelRequest,
  ModelResponse,
  ToolCallProposal,
} from "../core/types.js";
import { ForgeError } from "../core/types.js";
import type { ModelProvider } from "./provider.js";

export interface OllamaProviderOptions {
  baseUrl: string;
  timeoutMs?: number;
}

interface OllamaChatMessage {
  role: string;
  content?: string;
  tool_calls?: Array<{
    id?: string;
    function?: { name?: string; arguments?: string | Record<string, unknown> };
  }>;
}

/**
 * Ollama local provider. Model name is never hard-coded — caller supplies it.
 */
export class OllamaProvider implements ModelProvider {
  readonly name = "ollama";
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: OllamaProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  capabilities(): ModelCapabilities {
    return {
      provider: "ollama",
      supportsTools: true,
      supportsStreaming: true,
      maxContextTokens: null,
      local: true,
    };
  }

  async ping(): Promise<{ ok: boolean; detail: string }> {
    try {
      const models = await this.listModels();
      return {
        ok: true,
        detail: `reachable; ${models.length} model(s)`,
      };
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async listModels(): Promise<string[]> {
    const res = await this.fetch("/api/tags", { method: "GET" });
    const data = (await res.json()) as {
      models?: Array<{ name?: string; model?: string }>;
    };
    return (data.models ?? [])
      .map((m) => m.name ?? m.model ?? "")
      .filter(Boolean);
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const tools =
      request.tools.length > 0
        ? request.tools.map((t) => ({
            type: "function",
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            },
          }))
        : undefined;

    const useStream = Boolean(request.onToken);
    const body = {
      model: request.model,
      stream: useStream,
      messages: request.messages.map((m) => ({
        role: m.role === "tool" ? "tool" : m.role,
        content: m.content,
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
        ...(m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0
          ? {
              tool_calls: m.toolCalls.map((tc) => ({
                id: tc.id,
                type: "function",
                function: {
                  name: tc.name,
                  arguments: tc.arguments ?? {},
                },
              })),
            }
          : {}),
      })),
      ...(tools ? { tools } : {}),
      options: {
        temperature: request.temperature ?? 0.2,
        ...(request.maxTokens ? { num_predict: request.maxTokens } : {}),
      },
    };

    let res: Response;
    try {
      res = await this.fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: request.signal,
      });
    } catch (err) {
      if (request.signal?.aborted) {
        return emptyCancelled(request.model);
      }
      throw new ForgeError(
        `Ollama request failed: ${err instanceof Error ? err.message : String(err)}`,
        "OLLAMA_UNAVAILABLE",
      );
    }

    if (!res.ok) {
      const text = await res.text();
      throw new ForgeError(
        `Ollama error ${res.status}: ${text.slice(0, 500)}`,
        "OLLAMA_ERROR",
        { status: res.status },
      );
    }

    if (useStream && res.body) {
      return this.consumeStream(res, request);
    }

    const data = (await res.json()) as {
      message?: OllamaChatMessage;
      prompt_eval_count?: number;
      eval_count?: number;
    };

    const message: OllamaChatMessage = data.message ?? { role: "assistant" };
    const toolCalls = parseToolCalls(message.tool_calls ?? []);

    return {
      content: message.content ?? null,
      toolCalls,
      finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
      usage: {
        provider: "ollama",
        model: request.model,
        promptTokens: data.prompt_eval_count ?? null,
        completionTokens: data.eval_count ?? null,
        estimatedCostUsd: 0,
        costKnown: true,
      },
      raw: data,
    };
  }

  private async consumeStream(
    res: Response,
    request: ModelRequest,
  ): Promise<ModelResponse> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let toolCalls: ToolCallProposal[] = [];
    let promptTokens: number | null = null;
    let completionTokens: number | null = null;
    let lastRaw: unknown;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let chunk: {
          message?: OllamaChatMessage;
          done?: boolean;
          prompt_eval_count?: number;
          eval_count?: number;
        };
        try {
          chunk = JSON.parse(trimmed) as typeof chunk;
        } catch {
          continue;
        }
        lastRaw = chunk;
        const piece = chunk.message?.content ?? "";
        if (piece) {
          content += piece;
          request.onToken?.(piece);
        }
        if (chunk.message?.tool_calls?.length) {
          toolCalls = parseToolCalls(chunk.message.tool_calls);
        }
        if (chunk.prompt_eval_count != null) promptTokens = chunk.prompt_eval_count;
        if (chunk.eval_count != null) completionTokens = chunk.eval_count;
      }
    }

    return {
      content: content || null,
      toolCalls,
      finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
      usage: {
        provider: "ollama",
        model: request.model,
        promptTokens,
        completionTokens,
        estimatedCostUsd: 0,
        costKnown: true,
      },
      raw: lastRaw,
    };
  }

  private async fetch(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const signals = [controller.signal];
    if (init.signal) signals.push(init.signal);

    const linked = AbortSignal.any
      ? AbortSignal.any(signals)
      : controller.signal;

    try {
      return await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: linked,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseToolCalls(
  calls: NonNullable<OllamaChatMessage["tool_calls"]>,
): ToolCallProposal[] {
  return calls
    .map((call) => {
      const name = call.function?.name;
      if (!name) return null;
      let args: Record<string, unknown> = {};
      const raw = call.function?.arguments;
      if (typeof raw === "string") {
        try {
          args = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          args = { raw };
        }
      } else if (raw && typeof raw === "object") {
        args = raw;
      }
      return {
        id: call.id ?? `call_${randomUUID().slice(0, 8)}`,
        name,
        arguments: args,
      };
    })
    .filter((x): x is ToolCallProposal => x != null);
}

function emptyCancelled(model: string): ModelResponse {
  return {
    content: null,
    toolCalls: [],
    finishReason: "cancelled",
    usage: {
      provider: "ollama",
      model,
      promptTokens: null,
      completionTokens: null,
      estimatedCostUsd: 0,
      costKnown: true,
    },
  };
}
