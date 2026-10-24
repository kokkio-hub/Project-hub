/**
 * Work that continues after a response has been sent, such as emailing a
 * password reset link. Tracked so that tests and a graceful shutdown can wait
 * for it to finish.
 */
export class BackgroundJobs {
  private readonly pending = new Set<Promise<void>>();

  run(label: string, task: () => Promise<void>): void {
    const promise = (async () => {
      try {
        await task();
      } catch (error) {
        console.error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
    this.pending.add(promise);
    void promise.finally(() => this.pending.delete(promise));
  }

  /** Resolves once every job, including jobs started meanwhile, has finished. */
  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }
}
