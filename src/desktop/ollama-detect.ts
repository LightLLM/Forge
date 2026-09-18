/**
 * Detect local Ollama for desktop onboarding / doctor (DESKTOP-4).
 */

export interface OllamaDetection {
  ok: boolean;
  baseUrl: string;
  models: string[];
  detail: string;
}

export async function detectOllama(
  baseUrl = "http://127.0.0.1:11434",
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<OllamaDetection> {
  const url = baseUrl.replace(/\/$/, "");
  const ctrl = new AbortController();
  const timer = setTimeout(
    () => ctrl.abort(),
    options.timeoutMs ?? 3_000,
  );
  const onAbort = () => ctrl.abort();
  options.signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(`${url}/api/tags`, { signal: ctrl.signal });
    if (!res.ok) {
      return {
        ok: false,
        baseUrl: url,
        models: [],
        detail: `HTTP ${res.status}`,
      };
    }
    const body = (await res.json()) as {
      models?: Array<{ name?: string; model?: string }>;
    };
    const models = (body.models ?? [])
      .map((m) => m.name || m.model || "")
      .filter(Boolean);
    return {
      ok: true,
      baseUrl: url,
      models,
      detail: models.length
        ? `${models.length} model(s)`
        : "running (no models pulled)",
    };
  } catch (err) {
    return {
      ok: false,
      baseUrl: url,
      models: [],
      detail: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
