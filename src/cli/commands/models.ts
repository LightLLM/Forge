import { resolve } from "node:path";
import type { Command } from "commander";
import { loadConfig } from "../../config/load.js";
import { OllamaProvider } from "../../models/ollama.js";
import { OpenRouterProvider } from "../../models/openrouter.js";
import { loadDotEnv } from "../env.js";

export function registerModels(program: Command): void {
  program
    .command("models")
    .description("Show configured and available models")
    .action(async () => {
      const workspace = resolve(process.cwd());
      loadDotEnv(workspace);
      const config = loadConfig(workspace);

      console.log("Configured");
      console.log(`  mode         : ${config.mode}`);
      console.log(`  local model  : ${config.local.model || "(unset)"}`);
      console.log(`  cloud model  : ${config.cloud.model || "(unset)"}`);
      console.log(`  ollama URL   : ${config.ollamaBaseUrl}`);
      console.log(
        `  openrouter   : ${config.openRouterApiKey ? "API key set" : "API key not set"}`,
      );

      console.log("\nOllama");
      const ollama = new OllamaProvider({ baseUrl: config.ollamaBaseUrl });
      const ping = await ollama.ping();
      if (!ping.ok) {
        console.log(`  unavailable: ${ping.detail}`);
      } else {
        const models = await ollama.listModels();
        if (models.length === 0) {
          console.log("  (no models pulled)");
        } else {
          for (const m of models) {
            const marker = m === config.local.model ? " *" : "";
            console.log(`  - ${m}${marker}`);
          }
        }
      }

      console.log("\nOpenRouter");
      if (!config.openRouterApiKey) {
        console.log("  skipped (no API key)");
      } else {
        const or = new OpenRouterProvider({ apiKey: config.openRouterApiKey });
        try {
          const models = await or.listModels();
          console.log(`  sample (${Math.min(models.length, 15)} of ${models.length}):`);
          for (const m of models.slice(0, 15)) {
            const marker = m === config.cloud.model ? " *" : "";
            console.log(`  - ${m}${marker}`);
          }
        } catch (err) {
          console.log(
            `  error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      console.log("");
    });
}
