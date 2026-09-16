import { resolve } from "node:path";
import type { Command } from "commander";
import { loadConfig } from "../../config/load.js";
import { openStore } from "../../persistence/factory.js";
import { loadDotEnv, resolveWorkspace } from "../env.js";

export function registerApprovals(program: Command): void {
  program
    .command("approvals")
    .description("List pending approvals (optionally for a task)")
    .argument("[task-id]", "Optional task ID filter")
    .option("--all", "Include resolved approvals for a task", false)
    .action(async (taskId: string | undefined, opts: { all: boolean }) => {
      const workspace = resolveWorkspace();
      loadDotEnv(workspace);
      const config = loadConfig(workspace);
      const store = await openStore(config);
      try {
        let list;
        if (opts.all && taskId) {
          list = store.listApprovals(taskId);
        } else {
          list = store.listPendingApprovals(taskId);
        }
        if (list.length === 0) {
          console.log("No approvals found.");
          return;
        }
        for (const a of list) {
          console.log(
            `${a.id}  ${a.status.padEnd(8)}  task=${a.taskId.slice(0, 8)}  ${a.action}  ${a.reason ?? ""}`,
          );
        }
      } finally {
        store.close();
      }
    });

  program
    .command("approve")
    .description("Approve a queued high-risk tool call")
    .argument("<approval-id>", "Approval ID")
    .action(async (approvalId: string) => {
      await resolveOne(approvalId, "approved");
    });

  program
    .command("deny")
    .description("Deny a queued high-risk tool call")
    .argument("<approval-id>", "Approval ID")
    .action(async (approvalId: string) => {
      await resolveOne(approvalId, "denied");
    });
}

async function resolveOne(
  approvalId: string,
  status: "approved" | "denied",
): Promise<void> {
  const workspace = resolveWorkspace();
  loadDotEnv(workspace);
  const config = loadConfig(workspace);
  const store = await openStore(config);
  try {
    const existing = store.getApproval(approvalId);
    if (!existing) {
      console.error(`Approval not found: ${approvalId}`);
      process.exitCode = 1;
      return;
    }
    if (existing.status !== "pending") {
      console.error(`Approval already ${existing.status}`);
      process.exitCode = 1;
      return;
    }
    const updated = store.resolveApproval(approvalId, status);
    console.log(`${updated.status}: ${updated.id} (${updated.action})`);
  } finally {
    store.close();
  }
}

void resolve;
