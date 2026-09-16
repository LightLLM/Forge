import type { Command } from "commander";
import { loadConfig } from "../../config/load.js";
import {
  collectWorkspaceSignals,
  SkillLoader,
  SkillRegistry,
  SkillRouter,
} from "../../skills/index.js";
import { loadDotEnv, resolveWorkspace } from "../env.js";

export function registerSkills(program: Command): void {
  const skills = program.command("skills").description("List and match engineering skills");

  skills
    .command("list")
    .description("List available skills")
    .action(async () => {
      const { registry } = loadRegistry();
      const list = registry.list();
      if (list.length === 0) {
        console.log("No skills found.");
        return;
      }
      for (const s of list) {
        console.log(
          `${s.metadata.id.padEnd(18)} ${s.source.padEnd(10)} ${s.metadata.name} — ${s.metadata.description}`,
        );
      }
    });

  skills
    .command("inspect")
    .description("Show skill metadata and body")
    .argument("<id>", "Skill id")
    .action(async (id: string) => {
      const { registry } = loadRegistry();
      const skill = registry.get(id);
      if (!skill) {
        console.error(`Skill not found: ${id}`);
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify(skill.metadata, null, 2));
      console.log("---");
      console.log(`source: ${skill.source}`);
      console.log(`path: ${skill.rootPath}`);
      console.log("---");
      console.log(skill.body);
    });

  skills
    .command("match")
    .description("Show which skills would load for an objective")
    .argument("<objective>", "Task objective")
    .option("--phase <phase>", "implement|repair|escalate", "implement")
    .action(async (objective: string, opts: { phase: string }) => {
      const { registry, workspace, config } = loadRegistry();
      const phase = opts.phase as "implement" | "repair" | "escalate";
      const router = new SkillRouter(registry);
      const matches = router.route({
        objective,
        phase,
        signals: collectWorkspaceSignals(workspace),
        maxSkills: config.skills.maxSkills,
        include: config.skills.include,
        exclude: config.skills.exclude,
      });
      if (matches.length === 0) {
        console.log("No skills matched.");
        return;
      }
      for (const m of matches) {
        console.log(
          `${m.score.toString().padStart(3)}  ${m.skill.metadata.id}  (${m.reasons.join(", ")})`,
        );
      }
    });
}

function loadRegistry() {
  const workspace = resolveWorkspace();
  loadDotEnv(workspace);
  const config = loadConfig(workspace);
  const loaded = new SkillLoader().load(workspace, {
    extraPaths: config.skills.extraPaths,
    includeBuiltin: true,
  });
  return { registry: new SkillRegistry(loaded), workspace, config };
}
