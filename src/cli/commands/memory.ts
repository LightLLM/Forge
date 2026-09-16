import type { Command } from "commander";
import { loadConfig } from "../../config/load.js";
import type { MemoryKind } from "../../core/types.js";
import { MemoryService } from "../../memory/service.js";
import { openStore } from "../../persistence/factory.js";
import { loadDotEnv, resolveWorkspace } from "../env.js";

const MEMORY_KINDS: MemoryKind[] = [
  "project",
  "architecture",
  "decision",
  "convention",
  "failure",
  "solution",
  "dependency",
  "task",
  "run",
  "artifact",
  "session",
];

export function registerMemory(program: Command): void {
  const memory = program.command("memory").description("Inspect and manage engineering memory");

  memory
    .command("list")
    .description("List memories")
    .option("--kind <kind>", "Filter by kind")
    .option("--limit <n>", "Max results", "50")
    .action(async (opts: { kind?: string; limit: string }) => {
      const { store, projectId } = await openWorkspaceStore();
      try {
        const svc = new MemoryService(store);
        const kind = parseKind(opts.kind);
        const list = svc.list({
          projectId: projectId ?? undefined,
          kind,
          limit: Number(opts.limit) || 50,
        });
        if (list.length === 0) {
          console.log("No memories found.");
          return;
        }
        for (const m of list) {
          console.log(
            `${m.id}  ${m.kind.padEnd(12)}  ${m.title.slice(0, 70)}  ${m.createdAt}`,
          );
        }
      } finally {
        store.close();
      }
    });

  memory
    .command("search")
    .description("Search memories by keyword")
    .argument("<query>", "Search query")
    .option("--kind <kind>", "Filter by kind")
    .option("--limit <n>", "Max results", "20")
    .action(async (query: string, opts: { kind?: string; limit: string }) => {
      const { store, projectId } = await openWorkspaceStore();
      try {
        const svc = new MemoryService(store);
        const hits = svc.search(query, {
          projectId: projectId ?? undefined,
          kind: parseKind(opts.kind),
          limit: Number(opts.limit) || 20,
        });
        if (hits.length === 0) {
          console.log("No matching memories.");
          return;
        }
        for (const m of hits) {
          console.log(`${m.id}  [${m.kind}] ${m.title}`);
        }
      } finally {
        store.close();
      }
    });

  memory
    .command("inspect")
    .description("Show a memory record")
    .argument("<id>", "Memory ID")
    .action(async (id: string) => {
      const { store } = await openWorkspaceStore();
      try {
        const svc = new MemoryService(store);
        const m = svc.inspect(id);
        if (!m) {
          console.error(`Memory not found: ${id}`);
          process.exitCode = 1;
          return;
        }
        console.log(JSON.stringify(m, null, 2));
      } finally {
        store.close();
      }
    });

  memory
    .command("prune")
    .description("Delete old or excess memories")
    .option("--kind <kind>", "Filter by kind")
    .option("--older-than-days <n>", "Delete memories older than N days")
    .option("--keep-latest <n>", "Keep only the N newest (delete the rest)")
    .option("--dry-run", "Count without deleting", false)
    .action(
      async (opts: {
        kind?: string;
        olderThanDays?: string;
        keepLatest?: string;
        dryRun: boolean;
      }) => {
        const { store, projectId } = await openWorkspaceStore();
        try {
          const svc = new MemoryService(store);
          const olderThanDays =
            opts.olderThanDays != null ? Number(opts.olderThanDays) : undefined;
          const keepLatest =
            opts.keepLatest != null ? Number(opts.keepLatest) : undefined;
          if (olderThanDays == null && keepLatest == null) {
            console.error("Specify --older-than-days and/or --keep-latest");
            process.exitCode = 1;
            return;
          }
          const removed = svc.prune({
            projectId: projectId ?? undefined,
            kind: parseKind(opts.kind),
            olderThanDays,
            keepLatest,
            dryRun: opts.dryRun,
          });
          console.log(
            opts.dryRun
              ? `Would prune ${removed} memor${removed === 1 ? "y" : "ies"}`
              : `Pruned ${removed} memor${removed === 1 ? "y" : "ies"}`,
          );
        } finally {
          store.close();
        }
      },
    );

  memory
    .command("write")
    .description("Manually write a project/decision memory")
    .requiredOption("--kind <kind>", "Memory kind (project|decision|convention|...)")
    .requiredOption("--title <title>", "Title")
    .requiredOption("--content <content>", "Content body")
    .option("--tag <tag>", "Tag (repeatable)", collect, [])
    .action(
      async (opts: {
        kind: string;
        title: string;
        content: string;
        tag: string[];
      }) => {
        const kind = parseKind(opts.kind);
        if (!kind) {
          console.error(`Invalid kind. Expected one of: ${MEMORY_KINDS.join(", ")}`);
          process.exitCode = 1;
          return;
        }
        const { store, projectId } = await openWorkspaceStore();
        try {
          if (!projectId) {
            console.error("No project registered for this workspace. Run forge init / forge run first.");
            process.exitCode = 1;
            return;
          }
          const record = store.createMemory({
            projectId,
            kind,
            title: opts.title,
            content: opts.content,
            tags: opts.tag,
          });
          console.log(`Wrote ${record.kind} memory ${record.id}`);
        } finally {
          store.close();
        }
      },
    );
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

function parseKind(kind?: string): MemoryKind | undefined {
  if (!kind) return undefined;
  if ((MEMORY_KINDS as string[]).includes(kind)) return kind as MemoryKind;
  throw new Error(`Invalid memory kind: ${kind}`);
}

async function openWorkspaceStore() {
  const workspace = resolveWorkspace();
  loadDotEnv(workspace);
  const config = loadConfig(workspace);
  const store = await openStore(config);
  const project = store.getProjectByPath(workspace);
  return { store, projectId: project?.id ?? null, workspace };
}
