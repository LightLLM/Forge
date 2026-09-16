import type {
  ModelCapabilities,
  ModelRequest,
  ModelResponse,
} from "../core/types.js";

export interface ModelProvider {
  readonly name: string;
  generate(request: ModelRequest): Promise<ModelResponse>;
  capabilities(): ModelCapabilities;
  listModels?(): Promise<string[]>;
  ping?(): Promise<{ ok: boolean; detail: string }>;
}
