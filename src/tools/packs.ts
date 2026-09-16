import { pathToFileURL } from "node:url";
import { resolve, isAbsolute } from "node:path";
import { existsSync } from "node:fs";
import { createRepositoryTools } from "./repository.js";
import type { RegisteredTool } from "./types.js";
import { ForgeError } from "../core/types.js";

export interface ToolPackConfig {
  /** Built-in pack names and/or paths to modules exporting createTools(). */
  packs: string[];
}

const BUILTIN: Record<string, () => RegisteredTool[]> = {
  repository: () => createRepositoryTools(),
};

/**
 * Load policy-gated tool packs. Pack modules cannot raise permissions —
 * they only contribute tool definitions that still pass through PolicyEngine.
 */
export async function loadToolPacks(
  workspaceRoot: string,
  packs: string[] = ["repository"],
): Promise<RegisteredTool[]> {
  const names = packs.length > 0 ? packs : ["repository"];
  const loaded: RegisteredTool[] = [];
  const seen = new Set<string>();

  for (const pack of names) {
    const tools = await loadOnePack(workspaceRoot, pack);
    for (const tool of tools) {
      if (seen.has(tool.name)) {
        throw new ForgeError(
          `Duplicate tool name '${tool.name}' from pack '${pack}'`,
          "TOOL_PACK_CONFLICT",
        );
      }
      seen.add(tool.name);
      loaded.push(tool);
    }
  }

  if (loaded.length === 0) {
    throw new ForgeError("No tools loaded from configured packs", "TOOL_PACKS_EMPTY");
  }
  return loaded;
}

async function loadOnePack(
  workspaceRoot: string,
  pack: string,
): Promise<RegisteredTool[]> {
  if (BUILTIN[pack]) {
    return BUILTIN[pack]!();
  }

  const abs = isAbsolute(pack) ? pack : resolve(workspaceRoot, pack);
  if (!existsSync(abs)) {
    throw new ForgeError(`Tool pack not found: ${pack}`, "TOOL_PACK_MISSING", {
      path: abs,
    });
  }

  const mod = (await import(pathToFileURL(abs).href)) as {
    createTools?: () => RegisteredTool[] | Promise<RegisteredTool[]>;
    tools?: RegisteredTool[];
    default?: { createTools?: () => RegisteredTool[] | Promise<RegisteredTool[]> };
  };

  if (typeof mod.createTools === "function") {
    return await mod.createTools();
  }
  if (typeof mod.default?.createTools === "function") {
    return await mod.default.createTools();
  }
  if (Array.isArray(mod.tools)) {
    return mod.tools;
  }

  throw new ForgeError(
    `Tool pack '${pack}' must export createTools() or tools[]`,
    "TOOL_PACK_INVALID",
  );
}
