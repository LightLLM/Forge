import type { JobStore } from "../daemon/job-store.js";
import type { Logger } from "../telemetry/logger.js";
import { ScheduleStore } from "./schedule-store.js";
import type { ScheduleRecord } from "./types.js";

export interface JobSchedulerOptions {
  scheduleStore: ScheduleStore;
  jobStore: JobStore;
  logger?: Logger;
}

/**
 * Turns due schedules into durable daemon jobs (`kind: analysis`).
 * Does not execute work — the daemon worker pool runs analyses.
 */
export class JobScheduler {
  private readonly schedules: ScheduleStore;
  private readonly jobs: JobStore;
  private readonly logger?: Logger;

  constructor(options: JobSchedulerOptions) {
    this.schedules = options.scheduleStore;
    this.jobs = options.jobStore;
    this.logger = options.logger;
  }

  /**
   * Enqueue one analysis job immediately (not via schedule).
   */
  enqueueNow(
    analysisId: ScheduleRecord["analysisId"],
    payload: Record<string, unknown> = {},
  ) {
    return this.jobs.enqueue({
      kind: "analysis",
      payload: { analysisId, ...payload, source: "manual" },
    });
  }

  /**
   * Scan due schedules and enqueue analysis jobs. Returns enqueued schedule ids.
   */
  tick(now = new Date()): { fired: ScheduleRecord[]; jobIds: string[] } {
    const due = this.schedules.listDue(now);
    const fired: ScheduleRecord[] = [];
    const jobIds: string[] = [];
    for (const schedule of due) {
      const job = this.jobs.enqueue({
        kind: "analysis",
        payload: {
          analysisId: schedule.analysisId,
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          source: "schedule",
          ...schedule.payload,
        },
      });
      const updated = this.schedules.markFired(schedule.id, job.id, now);
      fired.push(updated);
      jobIds.push(job.id);
      this.logger?.info("schedule fired", {
        scheduleId: schedule.id,
        analysisId: schedule.analysisId,
        jobId: job.id,
      });
    }
    return { fired, jobIds };
  }
}
