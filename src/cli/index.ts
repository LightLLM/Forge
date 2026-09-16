#!/usr/bin/env node
import { Command } from "commander";
import { registerInit } from "./commands/init.js";
import { registerDoctor } from "./commands/doctor.js";
import { registerRun } from "./commands/run.js";
import { registerStatus } from "./commands/status.js";
import { registerInspect } from "./commands/inspect.js";
import { registerModels } from "./commands/models.js";
import { registerApprovals } from "./commands/approvals.js";
import { registerMemory } from "./commands/memory.js";
import { registerSkills } from "./commands/skills.js";
import { registerMcp } from "./commands/mcp.js";
import { registerWorktrees } from "./commands/worktrees.js";
import { registerGraph } from "./commands/graph.js";
import { registerRoles } from "./commands/roles.js";
import { registerBrowserQa } from "./commands/browserqa.js";
import { registerDaemon } from "./commands/daemon.js";
import { registerJobs } from "./commands/jobs.js";
import { registerExec } from "./commands/exec.js";
import { registerGoal } from "./commands/goal.js";

const program = new Command();

program
  .name("forge")
  .description("Local-first hybrid autonomous software-engineering harness")
  .version("0.14.0");

registerInit(program);
registerDoctor(program);
registerRun(program);
registerStatus(program);
registerInspect(program);
registerModels(program);
registerApprovals(program);
registerMemory(program);
registerSkills(program);
registerMcp(program);
registerWorktrees(program);
registerGraph(program);
registerRoles(program);
registerBrowserQa(program);
registerDaemon(program);
registerJobs(program);
registerExec(program);
registerGoal(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`forge: ${message}`);
  process.exitCode = 1;
});
