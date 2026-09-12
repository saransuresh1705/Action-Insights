import type { SchedulerStatus } from "../shared/contracts.js";
import type { ScanFacade } from "./http-server.js";

export interface SchedulerOptions {
  readonly now?: () => number;
  readonly setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  readonly clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  readonly initialDelayMilliseconds?: number;
}

export class AppOpenScheduler {
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  private readonly initialDelayMilliseconds: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextRunAt: string | undefined;

  public constructor(
    private readonly intervalMinutes: number,
    private readonly scans: ScanFacade,
    options: SchedulerOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
    this.initialDelayMilliseconds = options.initialDelayMilliseconds ?? 1_000;
  }

  public start(): void {
    if (this.timer !== null) return;
    this.schedule(this.initialDelayMilliseconds);
  }

  public stop(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.nextRunAt = undefined;
  }

  public status(): SchedulerStatus {
    return {
      active: this.timer !== null,
      intervalMinutes: this.intervalMinutes,
      mode: "app-open",
      ...(this.nextRunAt === undefined ? {} : { nextRunAt: this.nextRunAt }),
    };
  }

  private schedule(delay: number): void {
    this.nextRunAt = new Date(this.now() + delay).toISOString();
    this.timer = this.setTimer(() => {
      this.timer = null;
      if (this.scans.status().state !== "running") this.scans.start();
      this.schedule(this.intervalMinutes * 60_000);
    }, delay);
  }
}
