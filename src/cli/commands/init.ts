import { mkdirSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import { defaultConfigJson } from "../../config/load.js";

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("Initialize project-local Forge configuration")
    .option("-f, --force", "Overwrite existing forge.config.json", false)
    .action((opts: { force: boolean }) => {
      const cwd = resolve(process.cwd());
      const forgeDir = join(cwd, ".forge");
      mkdirSync(forgeDir, { recursive: true });

      const configPath = join(cwd, "forge.config.json");
      if (existsSync(configPath) && !opts.force) {
        console.log(`Already exists: ${configPath} (use --force to overwrite)`);
      } else {
        writeFileSync(configPath, defaultConfigJson(), "utf8");
        console.log(`Wrote ${configPath}`);
      }

      const envExampleSrc = findEnvExample();
      const envExampleDest = join(cwd, ".env.example");
      if (envExampleSrc && !existsSync(envExampleDest)) {
        copyFileSync(envExampleSrc, envExampleDest);
        console.log(`Wrote ${envExampleDest}`);
      } else if (!existsSync(envExampleDest)) {
        writeFileSync(
          envExampleDest,
          `# Copy to .env (never commit .env)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=
OPENROUTER_API_KEY=
OPENROUTER_MODEL=
OPENROUTER_MAX_COST_USD=1.0
FORGE_MODE=local-preferred
FORGE_MAX_TURNS=20
FORGE_MAX_REPAIRS=2
FORGE_TIMEOUT_MINUTES=30
`,
          "utf8",
        );
        console.log(`Wrote ${envExampleDest}`);
      }

      console.log("Forge initialized. Next: set OLLAMA_MODEL, then run `forge doctor`.");
    });
}

function findEnvExample(): string | null {
  // fileURLToPath is required on Windows (URL.pathname is not a valid fs path).
  // init.js lives at dist/cli/commands/ → four levels up is package root.
  const packageRoot = fileURLToPath(new URL("../../../..", import.meta.url));
  const candidates = [
    join(resolve(process.cwd()), ".env.example"),
    join(packageRoot, ".env.example"),
  ];
  for (const c of candidates) {
    try {
      if (existsSync(c)) return c;
    } catch {
      // ignore
    }
  }
  return null;
}
