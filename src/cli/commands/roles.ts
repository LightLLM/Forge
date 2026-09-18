import type { Command } from "commander";
import {
  getAgentRole,
  listAgentRoles,
  selectAgentRole,
  type AgentPhase,
} from "../../agents/index.js";

export function registerRoles(program: Command): void {
  const roles = program
    .command("roles")
    .description("Inspect specialized agent roles");

  roles
    .command("list")
    .description("List built-in agent roles")
    .action(() => {
      for (const r of listAgentRoles()) {
        console.log(
          `${r.id.padEnd(14)} writes=${String(r.permissions.allowWrites).padEnd(5)} exec=${String(r.permissions.allowExecute).padEnd(5)}  ${r.description}`,
        );
      }
    });

  roles
    .command("inspect")
    .description("Show role details")
    .argument("<id>", "Role id")
    .action((id: string) => {
      const role = getAgentRole(id);
      if (!role) {
        console.error(`Unknown role: ${id}`);
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify(role, null, 2));
    });

  roles
    .command("pipelines")
    .description("List multi-agent role pipelines")
    .action(async () => {
      const { listAgentPipelines } = await import("../../agents/index.js");
      for (const p of listAgentPipelines()) {
        console.log(`${p.id.padEnd(10)} ${p.stages.join(" → ")}`);
        console.log(`           ${p.description}`);
      }
    });

  roles
    .command("match")
    .description("Preview role selection for a phase/objective")
    .argument("<objective>", "Task objective")
    .option("--phase <phase>", "implement|repair|escalate|plan|architect|review", "implement")
    .action((objective: string, opts: { phase: string }) => {
      const role = selectAgentRole({
        phase: opts.phase as AgentPhase,
        objective,
      });
      console.log(`${role.id}  (${role.name})`);
      console.log(`tools: ${role.allowedTools.join(", ")}`);
      console.log(
        `permissions: writes=${role.permissions.allowWrites} execute=${role.permissions.allowExecute} maxRisk=${role.permissions.maxRisk}`,
      );
    });
}
