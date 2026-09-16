import { z } from "zod";
import { defineTool } from "./types.js";
import {
  executeCommand,
  type SandboxOptions,
} from "./sandbox.js";

export const DEFAULT_COMMAND_ALLOWLIST = [
  "pnpm",
  "npm",
  "node",
  "npx",
  "tsc",
  "vitest",
  "eslint",
  "prettier",
  "playwright",
  "git status",
  "git diff",
  "git log",
  "git branch",
  "git rev-parse",
  "git show",
];

const DANGEROUS_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-zA-Z]*r|-[a-zA-Z]*f)/i,
  /\bdel\s+\/[sf]/i,
  /\brmdir\b/i,
  /\bformat\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\b(curl|wget)\b.*\|\s*(sh|bash|powershell)/i,
  /\bpowershell\b.*-enc/i,
  /\breg\s+delete\b/i,
  /\bchmod\s+777\b/i,
  /\bchown\b/i,
  /\bsudo\b/i,
  /\bdoas\b/i,
  />\s*\/etc\//i,
  /\bkill\s+-9\b/i,
  /\bmkfs\b/i,
  /\bdiskpart\b/i,
  /\b:()\s*{\s*:\|:\s*&};:/, // fork bomb
];

export function isCommandAllowed(command: string, allowlist: string[]): {
  allowed: boolean;
  reason?: string;
} {
  const trimmed = command.trim();
  if (!trimmed) return { allowed: false, reason: "Empty command" };

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { allowed: false, reason: `Dangerous command pattern: ${pattern}` };
    }
  }

  // Reject shell chaining / redirection escapes that broaden authority.
  if (/[;&`|$]/.test(trimmed) || /\n|\r/.test(trimmed)) {
    // Allow simple git pipes? No — keep strict for v0.
    if (/[;&`]/.test(trimmed) || /\n|\r/.test(trimmed)) {
      return {
        allowed: false,
        reason: "Shell chaining/metacharacters are not allowed",
      };
    }
  }

  const normalized = trimmed.replace(/\s+/g, " ");
  const ok = allowlist.some((entry) => {
    const e = entry.trim().replace(/\s+/g, " ");
    return normalized === e || normalized.startsWith(`${e} `);
  });

  if (!ok) {
    return {
      allowed: false,
      reason: `Command not in allowlist: ${normalized.split(" ")[0]}`,
    };
  }
  return { allowed: true };
}

export function createRepositoryTools() {
  const listFiles = defineTool({
    name: "list_files",
    description: "List files in the workspace (skips node_modules, .git, dist).",
    risk: "read",
    inputSchema: z.object({
      directory: z.string().default("."),
      maxEntries: z.number().int().positive().max(2000).default(500),
    }),
    async execute(input, ctx) {
      const files = ctx.workspace.listFiles(input.directory, {
        maxEntries: input.maxEntries,
      });
      return { files, count: files.length };
    },
  });

  const readFile = defineTool({
    name: "read_file",
    description: "Read a UTF-8 text file from the workspace.",
    risk: "read",
    inputSchema: z.object({
      path: z.string().min(1),
    }),
    async execute(input, ctx) {
      const content = ctx.workspace.readFile(input.path);
      return { path: input.path, content };
    },
  });

  const searchRepository = defineTool({
    name: "search_repository",
    description: "Search workspace text files for a query string (case-insensitive).",
    risk: "read",
    inputSchema: z.object({
      query: z.string().min(1),
      maxResults: z.number().int().positive().max(100).default(30),
    }),
    async execute(input, ctx) {
      const files = ctx.workspace.listFiles(".", { maxEntries: 1000 });
      const q = input.query.toLowerCase();
      const maxResults = input.maxResults ?? 30;
      const matches: Array<{ path: string; line: number; text: string }> = [];
      for (const file of files) {
        if (matches.length >= maxResults) break;
        if (!/\.(ts|tsx|js|jsx|json|md|css|html|yml|yaml|toml|txt)$/i.test(file)) {
          continue;
        }
        let content: string;
        try {
          content = ctx.workspace.readFile(file, 200_000);
        } catch {
          continue;
        }
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? "";
          if (line.toLowerCase().includes(q)) {
            matches.push({ path: file, line: i + 1, text: line.slice(0, 240) });
            if (matches.length >= maxResults) break;
          }
        }
      }
      return { matches, count: matches.length };
    },
  });

  const gitStatus = defineTool({
    name: "git_status",
    description: "Show git status --short in the workspace.",
    risk: "read",
    inputSchema: z.object({}),
    async execute(_input, ctx) {
      return runAllowedCommand("git status --short", ctx);
    },
  });

  const gitDiff = defineTool({
    name: "git_diff",
    description: "Show git diff (unstaged + staged summary).",
    risk: "read",
    inputSchema: z.object({
      staged: z.boolean().default(false),
    }),
    async execute(input, ctx) {
      const cmd = input.staged ? "git diff --cached" : "git diff";
      return runAllowedCommand(cmd, ctx);
    },
  });

  const writeFile = defineTool({
    name: "write_file",
    description: "Write or overwrite a text file inside the workspace.",
    risk: "write",
    inputSchema: z.object({
      path: z.string().min(1),
      content: z.string(),
    }),
    async execute(input, ctx) {
      ctx.workspace.writeFile(input.path, input.content);
      return { path: input.path, bytes: Buffer.byteLength(input.content, "utf8") };
    },
  });

  const applyPatch = defineTool({
    name: "apply_patch",
    description:
      "Apply a simple unified-ish patch by replacing exact oldText with newText in a file.",
    risk: "write",
    inputSchema: z.object({
      path: z.string().min(1),
      oldText: z.string().min(1),
      newText: z.string(),
    }),
    async execute(input, ctx) {
      const current = ctx.workspace.readFile(input.path);
      if (!current.includes(input.oldText)) {
        throw new Error(`oldText not found in ${input.path}`);
      }
      const occurrences = current.split(input.oldText).length - 1;
      if (occurrences !== 1) {
        throw new Error(
          `oldText must match exactly once (found ${occurrences}) in ${input.path}`,
        );
      }
      const next = current.replace(input.oldText, input.newText);
      ctx.workspace.writeFile(input.path, next);
      return { path: input.path, replaced: true };
    },
  });

  const runCommand = defineTool({
    name: "run_command",
    description:
      "Run an allowlisted development command inside the workspace. No arbitrary shell.",
    risk: "execute",
    inputSchema: z.object({
      command: z.string().min(1),
    }),
    async execute(input, ctx) {
      return runAllowedCommand(input.command, ctx);
    },
  });

  return [
    listFiles,
    readFile,
    searchRepository,
    gitStatus,
    gitDiff,
    writeFile,
    applyPatch,
    runCommand,
  ];
}

export async function runAllowedCommand(
  command: string,
  ctx: {
    workspace: { root: string };
    commandAllowlist: string[];
    commandTimeoutMs: number;
    maxCommandOutputChars: number;
    signal?: AbortSignal;
    sandbox?: SandboxOptions;
  },
): Promise<{
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  backend: "host" | "docker";
}> {
  const decision = isCommandAllowed(command, ctx.commandAllowlist);
  if (!decision.allowed) {
    throw new Error(decision.reason ?? "Command not allowed");
  }

  return executeCommand(command, {
    workspaceRoot: ctx.workspace.root,
    commandTimeoutMs: ctx.commandTimeoutMs,
    maxCommandOutputChars: ctx.maxCommandOutputChars,
    signal: ctx.signal,
    sandbox: ctx.sandbox,
  });
}
