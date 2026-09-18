import { z } from "zod";
import type { ToolRisk } from "../core/types.js";
import type { Workspace } from "../workspace/workspace.js";
import type { Logger } from "../telemetry/logger.js";
import type { SandboxOptions } from "./sandbox.js";
import type { PersistenceStore } from "../persistence/store.js";
import type { MemoryService } from "../memory/service.js";
import type { SkillRegistry } from "../skills/registry.js";
import type { TodoBoard } from "./todo-board.js";

export interface ToolServices {
  store?: PersistenceStore;
  memory?: MemoryService;
  projectId?: string;
  skillRegistry?: SkillRegistry;
  todos?: TodoBoard;
  /** When true, network-risk tools may run (still gated by PolicyEngine). */
  allowNetwork?: boolean;
}

export interface ToolContext {
  workspace: Workspace;
  taskId: string;
  runId: string;
  logger: Logger;
  signal?: AbortSignal;
  commandTimeoutMs: number;
  maxCommandOutputChars: number;
  commandAllowlist: string[];
  sandbox?: SandboxOptions;
  services?: ToolServices;
}

export interface ForgeTool<I, O> {
  name: string;
  description: string;
  risk: ToolRisk;
  inputSchema: z.ZodType<I>;
  execute(input: I, ctx: ToolContext): Promise<O>;
}

export interface RegisteredTool {
  name: string;
  description: string;
  risk: ToolRisk;
  inputSchema: z.ZodType<unknown>;
  jsonSchema: Record<string, unknown>;
  execute(input: unknown, ctx: ToolContext): Promise<unknown>;
}

export function defineTool<I, O>(tool: ForgeTool<I, O>): RegisteredTool {
  return {
    name: tool.name,
    description: tool.description,
    risk: tool.risk,
    inputSchema: tool.inputSchema as z.ZodType<unknown>,
    jsonSchema: zodToJsonSchema(tool.inputSchema),
    async execute(input: unknown, ctx: ToolContext): Promise<unknown> {
      const parsed = tool.inputSchema.parse(input);
      return tool.execute(parsed, ctx);
    },
  };
}

/** Minimal Zod → JSON Schema for tool definitions sent to models. */
function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value);
      if (!(value instanceof z.ZodOptional) && !(value instanceof z.ZodDefault)) {
        required.push(key);
      }
    }
    return {
      type: "object",
      properties,
      ...(required.length ? { required } : {}),
      additionalProperties: false,
    };
  }
  if (schema instanceof z.ZodString) return { type: "string" };
  if (schema instanceof z.ZodNumber) return { type: "number" };
  if (schema instanceof z.ZodBoolean) return { type: "boolean" };
  if (schema instanceof z.ZodArray) {
    return { type: "array", items: zodToJsonSchema(schema.element as z.ZodTypeAny) };
  }
  if (schema instanceof z.ZodOptional) {
    return zodToJsonSchema(schema.unwrap() as z.ZodTypeAny);
  }
  if (schema instanceof z.ZodDefault) {
    return zodToJsonSchema(schema.removeDefault() as z.ZodTypeAny);
  }
  if (schema instanceof z.ZodEnum) {
    return { type: "string", enum: schema.options };
  }
  return { type: "object" };
}
