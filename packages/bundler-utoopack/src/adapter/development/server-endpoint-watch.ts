import type { Project } from "@utoo/pack/cjs/core/types.js";

type WatchProject = Pick<
  Project,
  "entrypointsSubscribe" | "writeAllEntrypointsToDisk"
>;
type Entrypoints = Awaited<
  ReturnType<WatchProject["writeAllEntrypointsToDisk"]>
>;
type Endpoint = NonNullable<Entrypoints["apps"]>[number];
type Subscription = Awaited<ReturnType<Endpoint["serverChanged"]>>;

interface ServerEndpointWatchOptions {
  /** Resolves only after the host has published output and refreshed its runtime. */
  onBuild(): Promise<void>;
  onError(error: unknown): void;
}

/** Own endpoint writes and await publication before admitting the next batch. */
export function startUtoopackServerEndpointWatch(
  project: WatchProject,
  options: ServerEndpointWatchOptions,
): { ready: Promise<void>; failure: Promise<never>; close(): Promise<void> } {
  let closed = false;
  let failed = false;
  let generation = 0;
  let queue = Promise.resolve();
  let closePromise: Promise<void> | undefined;
  let resolveReady!: () => void;
  let rejectReady!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  void ready.catch(() => {});
  let rejectFailure!: (error: unknown) => void;
  const failure = new Promise<never>((_resolve, reject) => {
    rejectFailure = reject;
  });
  void failure.catch(() => {});
  const subscriptions = new Set<Subscription>();
  let entrypoints: ReturnType<WatchProject["entrypointsSubscribe"]> | undefined;
  const isCurrent = (current: number) =>
    !closed && !failed && current === generation;
  const report = (error: unknown, fatal = false) => {
    if (closed || failed) return;
    if (fatal) {
      failed = true;
      generation += 1;
      rejectReady(error);
      rejectFailure(error);
    }
    options.onError(error);
  };
  const enqueue = (work: () => Promise<void>, fatal = false) => {
    queue = queue.then(work).catch((error) => report(error, fatal));
  };
  const cancelSubscriptions = async () => {
    const previous = [...subscriptions];
    subscriptions.clear();
    await Promise.all(previous.map((subscription) => subscription.return?.()));
  };

  async function install(entries: Entrypoints, current: number): Promise<void> {
    if (!isCurrent(current)) return;
    const endpoints = [
      ...new Set([...(entries.apps ?? []), ...(entries.libraries ?? [])]),
    ];
    const results = await Promise.allSettled(
      endpoints.map((endpoint) => endpoint.serverChanged(true)),
    );
    const created = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    for (const subscription of created) subscriptions.add(subscription);
    if (!isCurrent(current)) {
      await cancelSubscriptions();
      return;
    }
    const rejected = results.find((result) => result.status === "rejected");
    if (rejected?.status === "rejected") {
      await cancelSubscriptions();
      report(rejected.reason, true);
      return;
    }
    let queued = false;
    let dirty = false;
    const scheduleWrite = () => {
      if (!isCurrent(current)) return;
      dirty = true;
      if (queued) return;
      queued = true;
      enqueue(async () => {
        dirty = false;
        try {
          if (!isCurrent(current)) return;
          // Even a rejected endpoint write must not leave sibling writes running
          // when the next batch begins or the Project is released.
          const writes = await Promise.allSettled(
            endpoints.map((endpoint) => endpoint.writeToDisk()),
          );
          const rejected = writes.find(
            (result) => result.status === "rejected",
          );
          if (rejected?.status === "rejected") throw rejected.reason;
          for (const result of writes)
            if (result.status === "fulfilled") assertNoErrors(result.value);
          if (!isCurrent(current) || dirty) return;
          assertNoErrors(await project.writeAllEntrypointsToDisk());
          if (!isCurrent(current) || dirty) return;
          await options.onBuild();
          if (isCurrent(current)) resolveReady();
        } finally {
          queued = false;
          if (dirty) scheduleWrite();
        }
      });
    };
    for (const subscription of created) {
      void (async () => {
        try {
          for await (const change of subscription) {
            if (!isCurrent(current)) return;
            scheduleWrite();
            try {
              assertNoErrors(change);
            } catch (error) {
              report(error);
            }
          }
          if (isCurrent(current))
            throw new Error(
              "[evjs] Utoopack server endpoint subscription ended unexpectedly.",
            );
        } catch (error) {
          if (isCurrent(current)) report(error, true);
        }
      })();
    }
    try {
      assertNoErrors(entries);
      scheduleWrite();
    } catch (error) {
      report(error);
    }
  }

  void (async () => {
    try {
      entrypoints = project.entrypointsSubscribe();
      for await (const entries of entrypoints) {
        if (closed || failed) break;
        const current = ++generation;
        const cancellation = cancelSubscriptions();
        void cancellation.catch(() => {});
        enqueue(async () => {
          await cancellation;
          await install(entries, current);
        }, true);
      }
      if (!closed && !failed)
        throw new Error(
          "[evjs] Utoopack entrypoints subscription ended unexpectedly.",
        );
    } catch (error) {
      report(error, true);
    }
  })();

  return {
    ready,
    failure,
    close() {
      closePromise ??= (async () => {
        closed = true;
        generation += 1;
        rejectReady(
          new Error(
            "[evjs] Utoopack server endpoint watch closed before publication.",
          ),
        );
        // Some Pack versions queue generator.return() behind a native event.
        // Project shutdown runs alongside this cleanup and owns that final exit.
        void entrypoints?.return?.().catch(() => {});
        const results = await Promise.allSettled([
          cancelSubscriptions(),
          queue,
        ]);
        results.push(...(await Promise.allSettled([cancelSubscriptions()])));
        const errors = results.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        );
        if (errors.length)
          throw new AggregateError(
            errors,
            "[evjs] Failed to close Utoopack server endpoint subscriptions.",
          );
      })();
      return closePromise;
    },
  };
}

function assertNoErrors(result: {
  issues: Array<{ severity: string; title: unknown }>;
}): void {
  const errors = result.issues.filter((issue) =>
    ["bug", "fatal", "error"].includes(issue.severity),
  );
  if (errors.length) {
    throw new Error(
      `[evjs] Utoopack server compilation failed: ${errors.map((issue) => (typeof issue.title === "string" ? issue.title : JSON.stringify(issue.title))).join("\n")}`,
    );
  }
}
