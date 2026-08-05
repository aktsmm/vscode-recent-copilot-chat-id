export interface TimerPort {
  set(callback: () => void, delay: number): unknown;
  clear(handle: unknown): void;
}

const systemTimers: TimerPort = {
  set: (callback, delay) => setTimeout(callback, delay),
  clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

export class VisibleRefreshScheduler {
  private handle: unknown;
  private visible = false;
  private disposed = false;

  constructor(
    private readonly refresh: () => void,
    private readonly interval = 60_000,
    private readonly timers: TimerPort = systemTimers,
  ) {}

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.cancel();
    if (visible && !this.disposed) {
      this.schedule();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.visible = false;
    this.cancel();
  }

  private schedule(): void {
    this.handle = this.timers.set(() => {
      this.handle = undefined;
      if (!this.disposed && this.visible) {
        this.refresh();
        this.schedule();
      }
    }, this.interval);
  }

  private cancel(): void {
    if (this.handle !== undefined) {
      this.timers.clear(this.handle);
      this.handle = undefined;
    }
  }
}
