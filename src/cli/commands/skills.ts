import type { Command } from "commander";
import { loadConfig } from "../../config/load.js";
import {
  collectWorkspaceSignals,
  SkillLoader,
  SkillRegistry,
  SkillRouter,
} from "../../skills/index.js";
import {
  proposalsDir,
  SkillImprovementService,
} from "../../skills/improvement.js";
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

  skills
    .command("propose")
    .description("Record a skill improvement proposal (never auto-installs)")
    .requiredOption("--title <title>", "Proposal title")
    .requiredOption("--rationale <text>", "Why this change")
    .option("--content <json>", "Proposed skill.json content", "{}")
    .option("--kind <kind>", "skill|context_strategy|...", "skill")
    .action(
      (opts: { title: string; rationale: string; content: string; kind: string }) => {
        const { config } = loadRegistry();
        const svc = new SkillImprovementService(config.dbPath);
        svc.initialize();
        const proposal = svc.propose({
          kind: opts.kind as "skill",
          title: opts.title,
          rationale: opts.rationale,
          proposedContent: opts.content,
        });
        svc.close();
        console.log(
          `${proposal.id}  pending  security=${proposal.securityImpacting}  ${proposal.title}`,
        );
      },
    );

  skills
    .command("proposals")
    .description("List skill improvement proposals")
    .option("--status <status>", "pending|approved|rejected|installed")
    .action((opts: { status?: string }) => {
      const { config } = loadRegistry();
      const svc = new SkillImprovementService(config.dbPath);
      svc.initialize();
      const list = svc.list(opts.status as "pending" | undefined);
      svc.close();
      if (list.length === 0) {
        console.log("No proposals.");
        return;
      }
      for (const p of list) {
        console.log(
          `${p.id}  ${p.status.padEnd(10)}  sec=${p.securityImpacting}  ${p.title}`,
        );
      }
    });

  skills
    .command("apply-proposal")
    .description("Approve and/or install a skill proposal (human only)")
    .argument("<id>", "Proposal id")
    .option("--approve", "Mark approved as operator", false)
    .option("--install", "Install after approval", false)
    .option("--as <who>", "Decision maker", "operator")
    .action(
      (id: string, opts: { approve: boolean; install: boolean; as: string }) => {
        const { config, workspace } = loadRegistry();
        const svc = new SkillImprovementService(config.dbPath);
        svc.initialize();
        if (opts.approve) {
          const p = svc.resolve(id, "approved", opts.as);
          console.log(`approved: ${p.id} by ${p.decisionMaker}`);
        }
        if (opts.install) {
          const result = svc.install(id, proposalsDir(workspace));
          console.log(`installed: ${result.path}`);
        }
        if (!opts.approve && !opts.install) {
          console.error("Specify --approve and/or --install");
          process.exitCode = 1;
        }
        svc.close();
      },
    );
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
