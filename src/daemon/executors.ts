import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { JobExecutor } from "./types.js";
import { ForgeError } from "../core/types.js";
import {
  assertAnalysisId,
  runAnalysis,
  writeAnalysisArtifact,
} from "../jobs/index.js";

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    if (signal.aborted) {
      reject(new ForgeError("Job aborted", "JOB_ABORTED"));
      return;
    }
    const timer = setTimeout(() => resolvePromise(), ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ForgeError("Job aborted", "JOB_ABORTED"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Built-in executors for daemon jobs (tests + lightweight CLI work + analyses).
 */
export function createBuiltinExecutor(): JobExecutor {
  return async (ctx) => {
    const { job, signal, heartbeat, workspacePath } = ctx;
    heartbeat();
    switch (job.kind) {
      case "echo": {
        const message =
          typeof job.payload.message === "string" ? job.payload.message : "ok";
        return { echoed: message };
      }
      case "sleep": {
        const ms =
          typeof job.payload.ms === "number" && job.payload.ms >= 0
            ? job.payload.ms
            : 100;
        const step = Math.min(100, Math.max(10, Math.floor(ms / 5) || 10));
        let left = ms;
        while (left > 0) {
          if (signal.aborted) {
            throw new ForgeError("Job aborted", "JOB_ABORTED");
          }
          const chunk = Math.min(step, left);
          await sleep(chunk, signal);
          left -= chunk;
          heartbeat();
        }
        return { sleptMs: ms };
      }
      case "write_file": {
        const rel =
          typeof job.payload.path === "string" ? job.payload.path : "daemon-out.txt";
        const content =
          typeof job.payload.content === "string" ? job.payload.content : "";
        const abs = resolve(workspacePath, rel);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, content, "utf8");
        heartbeat();
        return { path: abs, bytes: Buffer.byteLength(content, "utf8") };
      }
      case "analysis": {
        const rawId = job.payload.analysisId;
        if (typeof rawId !== "string") {
          throw new ForgeError(
            "analysis job requires payload.analysisId",
            "INVALID_JOB_PAYLOAD",
          );
        }
        assertAnalysisId(rawId);
        const report = runAnalysis(rawId, workspacePath);
        heartbeat();
        const artifactPath = writeAnalysisArtifact(workspacePath, report, job.id);
        heartbeat();
        return {
          analysisId: report.analysisId,
          summary: report.summary,
          findings: report.findings.length,
          artifactPath,
          proposal: report.proposal,
          metrics: report.metrics,
        };
      }
      case "agent_task":
        throw new ForgeError(
          "agent_task executor is not wired in this daemon build; use forge run for interactive agent tasks",
          "JOB_KIND_UNSUPPORTED",
        );
      default:
        throw new ForgeError(`Unhandled job kind`, "INVALID_JOB_KIND", {
          kind: job.kind,
        });
    }
  };
}
