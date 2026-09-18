import { z } from "zod";
import { defineTool } from "./types.js";
import type { RegisteredTool } from "./types.js";
import type { MemoryKind } from "../core/types.js";
import { SkillLoader, SkillRegistry } from "../skills/index.js";

const MEMORY_KINDS = [
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
] as const satisfies readonly MemoryKind[];

/**
 * Hermes-inspired agent utilities: memory, todos, skills, session search, clarify, web.
 * Network tools require ToolContext.services.allowNetwork and policy allowNetwork.
 */
export function createAgentTools(): RegisteredTool[] {
  const memorySearch = defineTool({
    name: "memory_search",
    description: "Search persistent project memory by keyword. Read-only.",
    risk: "read",
    inputSchema: z.object({
      query: z.string().min(1),
      limit: z.number().int().positive().max(50).optional(),
    }),
    async execute(input, ctx) {
      const memory = ctx.services?.memory;
      const projectId = ctx.services?.projectId;
      if (!memory || !projectId) throw new Error("Memory service unavailable");
      return {
        hits: memory.search(input.query, { projectId, limit: input.limit ?? 10 }).map((m) => ({
          id: m.id,
          kind: m.kind,
          title: m.title,
          content: m.content.slice(0, 800),
          tags: m.tags,
        })),
      };
    },
  });

  const memoryAdd = defineTool({
    name: "memory",
    description:
      "Add a lasting memory (decision/convention/solution/etc.) for this project.",
    risk: "write",
    inputSchema: z.object({
      title: z.string().min(1).max(200),
      content: z.string().min(1).max(8000),
      kind: z.enum(MEMORY_KINDS).optional(),
      tags: z.array(z.string()).optional(),
    }),
    async execute(input, ctx) {
      const store = ctx.services?.store;
      const projectId = ctx.services?.projectId;
      if (!store || !projectId) throw new Error("Memory store unavailable");
      const record = store.createMemory({
        projectId,
        kind: input.kind ?? "decision",
        title: input.title.trim(),
        content: input.content.trim(),
        tags: input.tags ?? [],
        sourceTaskId: ctx.taskId,
      });
      return { saved: { id: record.id, kind: record.kind, title: record.title } };
    },
  });

  const todo = defineTool({
    name: "todo",
    description:
      "Task checklist for the current run (Hermes-style). action=add|list|complete|clear.",
    risk: "read",
    inputSchema: z.object({
      action: z.enum(["add", "list", "complete", "clear"]),
      text: z.string().optional(),
      id: z.string().optional(),
    }),
    async execute(input, ctx) {
      const board = ctx.services?.todos;
      if (!board) throw new Error("Todo board unavailable");
      if (input.action === "list") return { items: board.list(ctx.taskId) };
      if (input.action === "clear") return { cleared: board.clear(ctx.taskId) };
      if (input.action === "add") {
        const text = (input.text ?? "").trim();
        if (!text) throw new Error("text required");
        return { item: board.add(ctx.taskId, text) };
      }
      const id = (input.id ?? "").trim();
      if (!id) throw new Error("id required");
      const item = board.complete(ctx.taskId, id);
      if (!item) throw new Error(`Todo not found: ${id}`);
      return { item };
    },
  });

  const skillsList = defineTool({
    name: "skills_list",
    description: "List available Forge skills (builtin + workspace).",
    risk: "read",
    inputSchema: z.object({
      query: z.string().optional(),
    }),
    async execute(input, ctx) {
      const registry = getSkillRegistry(ctx.workspace.root, ctx.services?.skillRegistry);
      let skills = registry.list().map((s) => ({
        id: s.metadata.id,
        name: s.metadata.name,
        description: s.metadata.description,
        tags: s.metadata.tags ?? [],
        source: s.source,
      }));
      const q = (input.query ?? "").trim().toLowerCase();
      if (q) {
        skills = skills.filter(
          (s) =>
            s.id.includes(q) ||
            s.name.toLowerCase().includes(q) ||
            s.description.toLowerCase().includes(q) ||
            s.tags.some((t) => t.toLowerCase().includes(q)),
        );
      }
      return { skills };
    },
  });

  const skillView = defineTool({
    name: "skill_view",
    description: "Load full content of a skill by id.",
    risk: "read",
    inputSchema: z.object({
      id: z.string().min(1),
    }),
    async execute(input, ctx) {
      const registry = getSkillRegistry(ctx.workspace.root, ctx.services?.skillRegistry);
      const skill = registry.get(input.id);
      if (!skill) throw new Error(`Skill not found: ${input.id}`);
      return {
        id: skill.metadata.id,
        name: skill.metadata.name,
        description: skill.metadata.description,
        tags: skill.metadata.tags ?? [],
        source: skill.source,
        body: skill.body.slice(0, 12_000),
      };
    },
  });

  const sessionSearch = defineTool({
    name: "session_search",
    description:
      "Search prior tasks and memories for this project (cross-session recall).",
    risk: "read",
    inputSchema: z.object({
      query: z.string().min(1),
      limit: z.number().int().positive().max(30).optional(),
    }),
    async execute(input, ctx) {
      const store = ctx.services?.store;
      const projectId = ctx.services?.projectId;
      const memory = ctx.services?.memory;
      if (!store || !projectId) throw new Error("Store unavailable");
      const q = input.query.toLowerCase();
      const limit = input.limit ?? 10;
      const tasks = store
        .listTasks(100)
        .filter((t) => t.projectId === projectId)
        .filter(
          (t) =>
            t.objective.toLowerCase().includes(q) ||
            (t.error ?? "").toLowerCase().includes(q) ||
            (t.plan ?? "").toLowerCase().includes(q),
        )
        .slice(0, limit)
        .map((t) => ({
          id: t.id,
          status: t.status,
          objective: t.objective.slice(0, 240),
          error: t.error,
          completedAt: t.completedAt,
        }));
      const memories = memory
        ? memory.search(input.query, { projectId, limit }).map((m) => ({
            id: m.id,
            kind: m.kind,
            title: m.title,
            content: m.content.slice(0, 400),
          }))
        : [];
      return { tasks, memories };
    },
  });

  const clarify = defineTool({
    name: "clarify",
    description:
      "Ask the user a clarifying question (optionally with choices). Creates a pending approval the user can answer in the Approvals panel.",
    risk: "read",
    inputSchema: z.object({
      question: z.string().min(1).max(2000),
      choices: z.array(z.string().min(1).max(200)).max(6).optional(),
    }),
    async execute(input, ctx) {
      const store = ctx.services?.store;
      if (!store) throw new Error("Store unavailable");
      const summary = input.choices?.length
        ? `${input.question}\nChoices: ${input.choices.map((c, i) => `${i + 1}) ${c}`).join(" | ")}`
        : input.question;
      const approval = store.createApproval(ctx.taskId, "clarify", summary);
      ctx.logger.info("clarify requested", {
        approvalId: approval.id,
        question: input.question.slice(0, 200),
      });
      return {
        awaitingUser: true,
        approvalId: approval.id,
        question: input.question,
        choices: input.choices ?? [],
        hint: "User must respond via Approvals. Prefer pausing until clarified.",
      };
    },
  });

  const webSearch = defineTool({
    name: "web_search",
    description:
      "Search the public web (DuckDuckGo Instant Answer). Requires tools.allowNetwork=true.",
    risk: "network",
    inputSchema: z.object({
      query: z.string().min(1).max(300),
    }),
    async execute(input, ctx) {
      assertNetwork(ctx);
      const url = new URL("https://api.duckduckgo.com/");
      url.searchParams.set("q", input.query);
      url.searchParams.set("format", "json");
      url.searchParams.set("no_redirect", "1");
      url.searchParams.set("no_html", "1");
      const res = await fetch(url, {
        signal: ctx.signal,
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
      const data = (await res.json()) as {
        AbstractText?: string;
        AbstractURL?: string;
        Heading?: string;
        Answer?: string;
        RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
      };
      const related = (data.RelatedTopics ?? [])
        .filter((t) => t.Text)
        .slice(0, 8)
        .map((t) => ({ text: t.Text, url: t.FirstURL }));
      return {
        heading: data.Heading ?? null,
        answer: data.Answer || data.AbstractText || null,
        url: data.AbstractURL ?? null,
        related,
      };
    },
  });

  const webExtract = defineTool({
    name: "web_extract",
    description:
      "Fetch a public https URL and return truncated plain text. Requires tools.allowNetwork=true.",
    risk: "network",
    inputSchema: z.object({
      url: z.string().url(),
      maxChars: z.number().int().positive().max(50_000).optional(),
    }),
    async execute(input, ctx) {
      assertNetwork(ctx);
      const parsed = new URL(input.url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new Error("Only http(s) URLs allowed");
      }
      if (isPrivateHost(parsed.hostname)) {
        throw new Error("Private/local hosts are not allowed");
      }
      const signals = [AbortSignal.timeout(20_000)];
      if (ctx.signal) signals.push(ctx.signal);
      const res = await fetch(parsed, {
        signal: AbortSignal.any(signals),
        headers: { "User-Agent": "ForgeAgent/1.2 (+local-first; web_extract)" },
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ctype = res.headers.get("content-type") ?? "";
      const raw = await res.text();
      const text = stripHtml(raw).slice(0, input.maxChars ?? 12_000);
      return {
        url: parsed.toString(),
        contentType: ctype,
        text,
        truncated: raw.length > text.length,
      };
    },
  });

  return [
    memorySearch,
    memoryAdd,
    todo,
    skillsList,
    skillView,
    sessionSearch,
    clarify,
    webSearch,
    webExtract,
  ];
}

function getSkillRegistry(
  workspaceRoot: string,
  existing?: SkillRegistry,
): SkillRegistry {
  if (existing) return existing;
  const loaded = new SkillLoader().load(workspaceRoot, { includeBuiltin: true });
  return new SkillRegistry(loaded);
}

function assertNetwork(ctx: { services?: { allowNetwork?: boolean } }): void {
  if (!ctx.services?.allowNetwork) {
    throw new Error(
      "Network tools disabled. Set tools.allowNetwork=true in forge.config.json (or FORGE_ALLOW_NETWORK=1).",
    );
  }
}

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "0.0.0.0" || h === "::1") return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  return false;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}
