import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import type { AnalysisFinding, AnalysisId, AnalysisReport } from "./types.js";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "coverage",
  ".forge",
  ".next",
  "build",
  "out",
]);

const SOURCE_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".md",
  ".json",
]);

function walkFiles(root: string, maxFiles = 2_000): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0 && out.length < maxFiles) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (SKIP_DIRS.has(ent.name)) continue;
      // Skip hidden dirs; allow hidden files like .env for security scan
      if (ent.name.startsWith(".") && ent.isDirectory()) continue;
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
      } else if (ent.isFile()) {
        out.push(full);
      }
    }
  }
  return out;
}

function readText(path: string, maxBytes = 200_000): string | null {
  try {
    const st = statSync(path);
    if (st.size > maxBytes) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function runTodoAnalysis(workspacePath: string): Omit<
  AnalysisReport,
  "analysisId" | "workspacePath" | "startedAt" | "finishedAt"
> {
  const findings: AnalysisFinding[] = [];
  const files = walkFiles(workspacePath).filter((f) =>
    SOURCE_EXTS.has(extname(f).toLowerCase()),
  );
  const re = /\b(TODO|FIXME|HACK|XXX)\b[:\s-]?(.*)$/gim;
  for (const file of files) {
    const text = readText(file);
    if (!text) continue;
    const lines = text.split(/\r?\n/);
    lines.forEach((line, idx) => {
      re.lastIndex = 0;
      const m = re.exec(line);
      if (!m) return;
      findings.push({
        severity: m[1]?.toUpperCase() === "FIXME" ? "medium" : "low",
        title: `${m[1]?.toUpperCase()} marker`,
        detail: (m[2] ?? line).trim().slice(0, 200),
        path: relative(workspacePath, file).replace(/\\/g, "/"),
        line: idx + 1,
      });
    });
  }
  return {
    summary: `Found ${findings.length} TODO/FIXME-style markers`,
    findings: findings.slice(0, 200),
    proposal:
      findings.length === 0
        ? "No TODO/FIXME markers found. No follow-up task proposed."
        : `Propose tracking ${findings.length} markers as engineering debt tasks. Do not auto-edit sources.`,
    metrics: { markers: findings.length, filesScanned: files.length },
  };
}

function runDependencyAudit(workspacePath: string): Omit<
  AnalysisReport,
  "analysisId" | "workspacePath" | "startedAt" | "finishedAt"
> {
  const findings: AnalysisFinding[] = [];
  const pkgPath = join(workspacePath, "package.json");
  if (!existsSync(pkgPath)) {
    findings.push({
      severity: "info",
      title: "No package.json",
      detail: "Workspace is not a Node package; dependency audit skipped.",
    });
    return {
      summary: "No package.json present",
      findings,
      proposal: "No Node dependency audit applicable.",
      metrics: { hasPackageJson: false },
    };
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const deps = Object.keys(pkg.dependencies ?? {});
  const devDeps = Object.keys(pkg.devDependencies ?? {});
  const hasLock =
    existsSync(join(workspacePath, "pnpm-lock.yaml")) ||
    existsSync(join(workspacePath, "package-lock.json")) ||
    existsSync(join(workspacePath, "yarn.lock"));
  if (!hasLock) {
    findings.push({
      severity: "medium",
      title: "Missing lockfile",
      detail: "No pnpm-lock.yaml / package-lock.json / yarn.lock found.",
      path: "package.json",
    });
  }
  for (const [name, range] of Object.entries(pkg.dependencies ?? {})) {
    if (typeof range === "string" && range.startsWith("*")) {
      findings.push({
        severity: "high",
        title: `Unbounded dependency: ${name}`,
        detail: `Range '${range}' is unsafe for reproducible builds.`,
        path: "package.json",
      });
    }
  }
  return {
    summary: `Audited ${deps.length} deps + ${devDeps.length} devDeps (lockfile=${hasLock})`,
    findings,
    proposal: hasLock
      ? "Dependencies look lockfile-backed. Review high-severity findings manually."
      : "Propose adding a lockfile and pinning critical dependencies. Do not rewrite package.json automatically.",
    metrics: {
      dependencies: deps.length,
      devDependencies: devDeps.length,
      hasLockfile: hasLock,
    },
  };
}

function runSecurityScan(workspacePath: string): Omit<
  AnalysisReport,
  "analysisId" | "workspacePath" | "startedAt" | "finishedAt"
> {
  const findings: AnalysisFinding[] = [];
  const patterns: { name: string; re: RegExp; severity: AnalysisFinding["severity"] }[] =
    [
      {
        name: "AWS-like access key",
        re: /AKIA[0-9A-Z]{16}/g,
        severity: "high",
      },
      {
        name: "Private key block",
        re: /-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----/g,
        severity: "high",
      },
      {
        name: "Generic API key assignment",
        re: /(api[_-]?key|secret|token)\s*[:=]\s*['"][^'"]{12,}['"]/gi,
        severity: "medium",
      },
    ];
  const files = walkFiles(workspacePath).filter((f) => {
    const ext = extname(f).toLowerCase();
    return SOURCE_EXTS.has(ext) || f.endsWith(".env") || f.includes(".env.");
  });
  for (const file of files) {
    const text = readText(file);
    if (!text) continue;
    const rel = relative(workspacePath, file).replace(/\\/g, "/");
    if (rel.includes("fixtures/") && rel.includes("fake-secret")) {
      // still report — fixtures intentionally trigger scanners
    }
    for (const p of patterns) {
      p.re.lastIndex = 0;
      if (p.re.test(text)) {
        findings.push({
          severity: p.severity,
          title: p.name,
          detail: `Pattern matched in ${rel}`,
          path: rel,
        });
      }
    }
  }
  return {
    summary: `Security heuristics flagged ${findings.length} finding(s)`,
    findings: findings.slice(0, 100),
    proposal:
      findings.length === 0
        ? "No heuristic secret patterns found."
        : "Propose rotating any real secrets and removing them from the tree. Forge will not rewrite files.",
    metrics: { findings: findings.length, filesScanned: files.length },
  };
}

function runRepoSummary(workspacePath: string): Omit<
  AnalysisReport,
  "analysisId" | "workspacePath" | "startedAt" | "finishedAt"
> {
  const files = walkFiles(workspacePath);
  const byExt: Record<string, number> = {};
  let bytes = 0;
  for (const f of files) {
    const ext = extname(f).toLowerCase() || "(none)";
    byExt[ext] = (byExt[ext] ?? 0) + 1;
    try {
      bytes += statSync(f).size;
    } catch {
      // ignore
    }
  }
  const top = Object.entries(byExt)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  return {
    summary: `Repository has ${files.length} files (~${Math.round(bytes / 1024)} KiB scanned)`,
    findings: top.map(([ext, n]) => ({
      severity: "info" as const,
      title: `Extension ${ext}`,
      detail: `${n} file(s)`,
    })),
    proposal: "Summary only — no code changes proposed.",
    metrics: {
      files: files.length,
      bytes,
      topExtension: top[0]?.[0] ?? "",
    },
  };
}

function runDeadCodeHints(workspacePath: string): Omit<
  AnalysisReport,
  "analysisId" | "workspacePath" | "startedAt" | "finishedAt"
> {
  const findings: AnalysisFinding[] = [];
  const files = walkFiles(workspacePath).filter((f) =>
    [".ts", ".tsx", ".js", ".jsx"].includes(extname(f).toLowerCase()),
  );
  const exportNames = new Map<string, string>();
  const importBlob: string[] = [];
  const exportRe =
    /export\s+(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+([A-Za-z0-9_]+)/g;
  for (const file of files) {
    const text = readText(file);
    if (!text) continue;
    importBlob.push(text);
    exportRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = exportRe.exec(text))) {
      const name = m[1]!;
      if (!exportNames.has(name)) {
        exportNames.set(name, relative(workspacePath, file).replace(/\\/g, "/"));
      }
    }
  }
  const allText = importBlob.join("\n");
  for (const [name, path] of exportNames) {
    // Count occurrences; declaration + possible re-exports. Heuristic only.
    const re = new RegExp(`\\b${name}\\b`, "g");
    const matches = allText.match(re);
    if (matches && matches.length <= 1) {
      findings.push({
        severity: "low",
        title: `Possibly unused export: ${name}`,
        detail: "Name appears only at declaration site (heuristic).",
        path,
      });
    }
  }
  return {
    summary: `Dead-code heuristics: ${findings.length} possibly unused export(s)`,
    findings: findings.slice(0, 50),
    proposal:
      findings.length === 0
        ? "No unused-export hints."
        : "Propose manual review of listed exports before deletion. Do not auto-delete.",
    metrics: { exportsChecked: exportNames.size, hints: findings.length },
  };
}

export function runAnalysis(
  analysisId: AnalysisId,
  workspacePath: string,
): AnalysisReport {
  const startedAt = new Date().toISOString();
  const root = resolve(workspacePath);
  let body: Omit<
    AnalysisReport,
    "analysisId" | "workspacePath" | "startedAt" | "finishedAt"
  >;
  switch (analysisId) {
    case "todo_analysis":
      body = runTodoAnalysis(root);
      break;
    case "dependency_audit":
      body = runDependencyAudit(root);
      break;
    case "security_scan":
      body = runSecurityScan(root);
      break;
    case "repo_summary":
      body = runRepoSummary(root);
      break;
    case "dead_code_hints":
      body = runDeadCodeHints(root);
      break;
    default: {
      const _exhaustive: never = analysisId;
      throw new Error(`Unhandled analysis: ${_exhaustive}`);
    }
  }
  const finishedAt = new Date().toISOString();
  return {
    analysisId,
    workspacePath: root,
    startedAt,
    finishedAt,
    ...body,
  };
}

/** Persist report under .forge/artifacts/jobs/ (proposal only — never applied). */
export function writeAnalysisArtifact(
  workspacePath: string,
  report: AnalysisReport,
  jobId?: string,
): string {
  const dir = join(resolve(workspacePath), ".forge", "artifacts", "jobs");
  mkdirSync(dir, { recursive: true });
  const stamp = report.finishedAt.replace(/[:.]/g, "-");
  const file = join(
    dir,
    `${report.analysisId}-${jobId ?? stamp}.json`,
  );
  writeFileSync(file, JSON.stringify(report, null, 2), "utf8");
  const proposalPath = join(
    resolve(workspacePath),
    ".forge",
    "proposals",
    `${report.analysisId}-${jobId ?? stamp}.md`,
  );
  mkdirSync(join(resolve(workspacePath), ".forge", "proposals"), {
    recursive: true,
  });
  writeFileSync(
    proposalPath,
    `# Proposal: ${report.analysisId}\n\n${report.summary}\n\n${report.proposal}\n\nFindings: ${report.findings.length}\n`,
    "utf8",
  );
  return file;
}
