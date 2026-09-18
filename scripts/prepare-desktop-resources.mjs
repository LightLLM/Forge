/**
 * Prepare forge-core resources for electron-builder (DESKTOP-6+).
 * Copies dist, skills, package.json, and production node_modules into desktop/resources/forge.
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "desktop", "resources", "forge");

if (!existsSync(join(root, "dist", "cli", "index.js"))) {
  console.error("Run pnpm build before prepare-desktop-resources");
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, "dist"), join(out, "dist"), { recursive: true });
cpSync(join(root, "skills"), join(out, "skills"), { recursive: true });
cpSync(join(root, "package.json"), join(out, "package.json"));

// Minimal production dependencies required by dist/
const deps = ["zod", "commander", "postgres"];
for (const dep of deps) {
  const from = join(root, "node_modules", dep);
  if (!existsSync(from)) {
    console.warn(`missing dependency ${dep}`);
    continue;
  }
  cpSync(from, join(out, "node_modules", dep), { recursive: true });
}

// Copy transitive zod deps if present as nested — pnpm structure may use .pnpm
// Fallback: run npm pack style by spawning pnpm deploy when available
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
writeFileSync(
  join(out, "FORGE_DESKTOP_RESOURCES.json"),
  JSON.stringify(
    {
      productVersion: pkg.version,
      preparedAt: new Date().toISOString(),
      note: "Packaged Forge Core for Electron extraResources",
    },
    null,
    2,
  ),
);

console.log(`Prepared ${out}`);
