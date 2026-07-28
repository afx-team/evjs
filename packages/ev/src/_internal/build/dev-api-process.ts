export interface DevApiProcessCheckpoint {
  readonly hadProcess: boolean;
  readonly replacementGeneration: number;
}

export interface DevApiProcessControllerOptions<TProcess extends object> {
  expectExit(process: TProcess): void;
  requestStop(process: TProcess): void;
  stop(process: TProcess): Promise<void>;
}

/**
 * Owns the API child process across dev rebuilds and plan-update rollback.
 *
 * A replacement generation records intent before the current process is
 * stopped. That lets a caller distinguish an update that merely failed from
 * one that displaced the API process and therefore needs runtime restoration.
 */
export class DevApiProcessController<TProcess extends object> {
  #process: TProcess | null = null;
  #replacementGeneration = 0;

  constructor(
    private readonly options: DevApiProcessControllerOptions<TProcess>,
  ) {}

  get process(): TProcess | null {
    return this.#process;
  }

  checkpoint(): DevApiProcessCheckpoint {
    return {
      hadProcess: this.#process !== null,
      replacementGeneration: this.#replacementGeneration,
    };
  }

  clearUnexpectedExit(process: TProcess): boolean {
    if (this.#process !== process) return false;
    this.#process = null;
    return true;
  }

  requestStop(): void {
    const process = this.#process;
    if (!process) return;
    this.options.expectExit(process);
    this.options.requestStop(process);
  }

  async stop(): Promise<void> {
    const process = this.#process;
    if (!process) return;
    await this.#terminate(process);
  }

  async replace(
    start: () => TProcess,
    waitUntilReady: (process: TProcess) => Promise<void>,
  ): Promise<void> {
    this.#replacementGeneration++;
    await this.stop();

    const candidate = start();
    this.#process = candidate;

    try {
      await waitUntilReady(candidate);
    } catch (error) {
      try {
        await this.#terminate(candidate);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "[evjs] API server failed to start and its child process cleanup also failed.",
          { cause: error },
        );
      }
      throw error;
    }
  }

  async rollback(
    checkpoint: DevApiProcessCheckpoint,
    restartPrevious: () => Promise<void>,
  ): Promise<void> {
    if (checkpoint.replacementGeneration === this.#replacementGeneration) {
      return;
    }

    await this.stop();
    if (checkpoint.hadProcess) {
      await restartPrevious();
    }
  }

  async #terminate(process: TProcess): Promise<void> {
    this.options.expectExit(process);
    try {
      await this.options.stop(process);
    } catch (error) {
      // Unexpected-exit observation may have cleared the active reference
      // while termination was in flight. Retain the failed candidate so a
      // rollback or final dev cleanup can retry instead of orphaning it.
      if (this.#process === null) this.#process = process;
      throw error;
    }
    if (this.#process === process) this.#process = null;
  }
}
