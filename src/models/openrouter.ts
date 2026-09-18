import { randomUUID } from "node:crypto";
import type {
  ModelCapabilities,
  ModelRequest,
  ModelResponse,
  ToolCallProposal,
} from "../core/types.js";
import { ForgeError } from "../core/types.js";
import type { ModelProvider } from "./provider.js";

export interface OpenRouterProviderOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  siteUrl?: string;
  siteName?: string;
}

/**
 * Optional cloud escalation provider. Never used for local-only tasks.
 */
export class OpenRouterProvider implements ModelProvider {
  readonly name = "openrouter";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly siteUrl: string;
  private readonly siteName: string;

  constructor(options: OpenRouterProviderOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "https://openrouter.ai/api/v1").replace(
      /\/$/,
      "",
    );
    this.timeoutMs = options.timeoutMs ?? 180_000;
    this.siteUrl = options.siteUrl ?? "https://github.com/forge-local/forge";
    this.siteName = options.siteName ?? "Forge";
  }

  capabilities(): ModelCapabilities {
    return {
      provider: "openrouter",
      supportsTools: true,
      supportsStreaming: false,
      maxContextTokens: null,
      local: false,
    };
  }

  async ping(): Promise<{ ok: boolean; detail: string }> {
    if (!this.apiKey) return { ok: false, detail: "OPENROUTER_API_KEY not set" };
    try {
      const res = await this.fetch("/models", { method: "GET" });
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
      return { ok: true, detail: "API key accepted" };
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async listModels(): Promise<string[]> {
    const res = await this.fetch("/models", { method: "GET" });
    if (!res.ok) {
      throw new ForgeError(`OpenRouter list models failed: ${res.status}`, "OPENROUTER_ERROR");
    }
    const data = (await res.json()) as {
      data?: Array<{ id?: string }>;
    };
    return (data.data ?? []).map((m) => m.id ?? "").filter(Boolean).slice(0, 50);
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    if (!this.apiKey) {
      throw new ForgeError("OPENROUTER_API_KEY is not configured", "OPENROUTER_UNAVAILABLE");
    }

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

    const body = {
      model: request.model,
      messages: request.messages.map((m) => {
        if (m.role === "tool") {
          return {
            role: "tool",
            tool_call_id: m.toolCallId,
            content: m.content,
          };
        }
        if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
          return {
            role: "assistant",
            content: m.content || null,
            tool_calls: m.toolCalls.map((tc) => ({
              id: tc.id,
              type: "function",
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.arguments ?? {}),
              },
            })),
          };
        }
        return { role: m.role, content: m.content };
      }),
      temperature: request.temperature ?? 0.2,
      ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
      ...(tools ? { tools } : {}),
    };

    let res: Response;
    try {
      res = await this.fetch("/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "HTTP-Referer": this.siteUrl,
          "X-Title": this.siteName,
        },
        body: JSON.stringify(body),
        signal: request.signal,
      });
    } catch (err) {
      if (request.signal?.aborted) {
        return {
          content: null,
          toolCalls: [],
          finishReason: "cancelled",
          usage: {
            provider: "openrouter",
            model: request.model,
            promptTokens: null,
            completionTokens: null,
            estimatedCostUsd: null,
            costKnown: false,
          },
        };
      }
      throw new ForgeError(
        `OpenRouter request failed: ${err instanceof Error ? err.message : String(err)}`,
        "OPENROUTER_UNAVAILABLE",
      );
    }

    if (!res.ok) {
      const text = await res.text();
      throw new ForgeError(
        `OpenRouter error ${res.status}: ${text.slice(0, 500)}`,
        "OPENROUTER_ERROR",
        { status: res.status },
      );
    }

    const data = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            id?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
        finish_reason?: string;
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        cost?: number;
      };
    };

    const choice = data.choices?.[0];
    const message = choice?.message;
    const toolCalls: ToolCallProposal[] = (message?.tool_calls ?? [])
      .map((tc) => {
        const name = tc.function?.name;
        if (!name) return null;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function?.arguments ?? "{}") as Record<string, unknown>;
        } catch {
          args = { raw: tc.function?.arguments };
        }
        return {
          id: tc.id ?? `call_${randomUUID().slice(0, 8)}`,
          name,
          arguments: args,
        };
      })
      .filter((x): x is ToolCallProposal => x != null);

    const cost =
      typeof data.usage?.cost === "number" ? data.usage.cost : null;

    return {
      content: message?.content ?? null,
      toolCalls,
      finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
      usage: {
        provider: "openrouter",
        model: request.model,
        promptTokens: data.usage?.prompt_tokens ?? null,
        completionTokens: data.usage?.completion_tokens ?? null,
        estimatedCostUsd: cost,
        costKnown: cost != null,
      },
      raw: data,
    };
  }

  private async fetch(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const signal =
        init.signal && typeof AbortSignal.any === "function"
          ? AbortSignal.any([controller.signal, init.signal])
          : controller.signal;
      return await fetch(`${this.baseUrl}${path}`, { ...init, signal });
    } finally {
      clearTimeout(timer);
    }
  }
}
