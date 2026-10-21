import type { Project } from "@utoo/pack/cjs/core/types.js";
import { describe, expect, it, vi } from "vitest";
import { startUtoopackServerEndpointWatch } from "../src/adapter/development/server-endpoint-watch.js";

type Entries = Awaited<ReturnType<Project["writeAllEntrypointsToDisk"]>>;
type Endpoint = NonNullable<Entries["apps"]>[number];
type Written = Awaited<ReturnType<Endpoint["writeToDisk"]>>;
type Change = { issues: Written["issues"] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function channel<T>() {
  const values: T[] = [];
  let waiting: ReturnType<typeof deferred<IteratorResult<T>>> | undefined;
  let closed = false;
  const close = vi.fn(async (): Promise<IteratorResult<T>> => {
    closed = true;
    waiting?.resolve({ done: true, value: undefined });
    return { done: true, value: undefined };
  });
  const stream: AsyncIterableIterator<T> = {
    [Symbol.asyncIterator]() {
      return this;
    },
    next() {
      if (values.length)
        return Promise.resolve({ done: false, value: values.shift() as T });
      if (closed) return Promise.resolve({ done: true, value: undefined });
      waiting = deferred<IteratorResult<T>>();
      return waiting.promise;
    },
    return: close,
  };
  return Object.assign(stream, {
    return: close,
    fail(error: unknown) {
      waiting?.reject(error);
    },
    push(value: T) {
      if (closed) return;
      if (waiting) {
        const next = waiting;
        waiting = undefined;
        next.resolve({ done: false, value });
      } else values.push(value);
    },
  });
}
const written = (issues: Written["issues"] = []): Written => ({
  type: "node",
  clientPaths: [],
  serverPaths: [],
  config: {},
  issues,
});
const diagnostic: Written["issues"] = [
  {
    severity: "error",
    title: "Broken module",
    stage: "compile",
    filePath: "page.ts",
    documentationLink: "",
    importTraces: [],
  },
];
function endpoint() {
  const changes = channel<Change>();
  const value: Endpoint = {
    serverChanged: vi.fn(async () => changes),
    clientChanged: vi.fn(async () => changes),
    writeToDisk: vi.fn(async () => written()),
  };
  return {
    value,
    changes,
    write: vi.mocked(value.writeToDisk),
    subscribe: vi.mocked(value.serverChanged),
  };
}
function fixture() {
  const entries = channel<Entries>();
  const project = {
    entrypointsSubscribe: vi.fn(() => entries),
    writeAllEntrypointsToDisk: vi.fn(
      async (): Promise<Entries> => ({ issues: [] }),
    ),
  };
  const onBuild = vi.fn(async () => {});
  const onError = vi.fn();
  const watch = startUtoopackServerEndpointWatch(project, { onBuild, onError });
  return { entries, project, onBuild, onError, watch };
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("Utoopack server endpoint watch", () => {
  it("waits for every write and host acknowledgement before writing the next batch", async () => {
    const f = fixture();
    const a = endpoint();
    const b = endpoint();
    const first = deferred<Written>();
    const second = deferred<Written>();
    const publication = deferred<void>();
    a.write.mockImplementationOnce(() => first.promise);
    b.write.mockImplementationOnce(() => second.promise);
    f.onBuild.mockImplementationOnce(() => publication.promise);
    f.entries.push({ apps: [a.value, b.value], issues: [] });
    try {
      await vi.waitFor(() => expect(b.write).toHaveBeenCalledOnce());
      expect(a.subscribe).toHaveBeenCalledWith(true);
      expect(b.subscribe).toHaveBeenCalledWith(true);
      first.resolve(written());
      await flush();
      expect(f.project.writeAllEntrypointsToDisk).not.toHaveBeenCalled();
      expect(f.onBuild).not.toHaveBeenCalled();
      second.resolve(written());
      await vi.waitFor(() => expect(f.onBuild).toHaveBeenCalledOnce());
      expect(f.project.writeAllEntrypointsToDisk).toHaveBeenCalledOnce();
      a.changes.push({ issues: [] });
      b.changes.push({ issues: [] });
      a.changes.push({ issues: [] });
      await flush();
      expect(a.write).toHaveBeenCalledOnce();
      expect(b.write).toHaveBeenCalledOnce();
      publication.resolve();
      await f.watch.ready;
      await vi.waitFor(() => expect(f.onBuild).toHaveBeenCalledTimes(2));
      expect(a.write).toHaveBeenCalledTimes(2);
      expect(b.write).toHaveBeenCalledTimes(2);
    } finally {
      first.resolve(written());
      second.resolve(written());
      publication.resolve();
      await f.watch.close();
    }
  });

  it("coalesces shared notifications into one complete output publication", async () => {
    const f = fixture();
    const a = endpoint();
    const b = endpoint();
    f.entries.push({ apps: [a.value], libraries: [b.value], issues: [] });
    try {
      await f.watch.ready;
      a.changes.push({ issues: [] });
      b.changes.push({ issues: [] });
      await vi.waitFor(() => expect(f.onBuild).toHaveBeenCalledTimes(2));
      expect(a.write).toHaveBeenCalledTimes(2);
      expect(b.write).toHaveBeenCalledTimes(2);
      expect(f.project.writeAllEntrypointsToDisk).toHaveBeenCalledTimes(2);
    } finally {
      await f.watch.close();
    }
  });

  it.each([
    "error",
    "fatal",
    "bug",
  ])("publishes initial %s diagnostics, then keeps later ones unpublished until recovery", async (severity) => {
    const diagnosticIssues = diagnostic.map((issue) => ({
      ...issue,
      severity,
    }));
    const f = fixture();
    const a = endpoint();
    a.write.mockResolvedValueOnce(written(diagnosticIssues));
    f.entries.push({ apps: [a.value], issues: [] });
    try {
      // The first batch still publishes so client pages are not blocked.
      await f.watch.ready;
      expect(f.onError).toHaveBeenCalledOnce();
      expect(f.onBuild).toHaveBeenCalledOnce();
      expect(f.project.writeAllEntrypointsToDisk).toHaveBeenCalledOnce();
      a.write.mockResolvedValueOnce(written(diagnosticIssues));
      a.changes.push({ issues: [] });
      await vi.waitFor(() => expect(f.onError).toHaveBeenCalledTimes(2));
      expect(f.onBuild).toHaveBeenCalledOnce();
      expect(f.project.writeAllEntrypointsToDisk).toHaveBeenCalledOnce();
      f.project.writeAllEntrypointsToDisk.mockResolvedValueOnce({
        issues: diagnosticIssues,
      });
      a.changes.push({ issues: [] });
      await vi.waitFor(() => expect(f.onError).toHaveBeenCalledTimes(3));
      expect(f.onBuild).toHaveBeenCalledOnce();
      a.changes.push({ issues: [] });
      await vi.waitFor(() => expect(f.onBuild).toHaveBeenCalledTimes(2));
    } finally {
      await f.watch.close();
    }
  });

  it("discards a topology superseded while its endpoint write is pending", async () => {
    const f = fixture();
    const old = endpoint();
    const next = endpoint();
    const writing = deferred<Written>();
    old.write.mockImplementationOnce(() => writing.promise);
    f.entries.push({ apps: [old.value], issues: [] });
    try {
      await vi.waitFor(() => expect(old.write).toHaveBeenCalledOnce());
      f.entries.push({ apps: [next.value], issues: [] });
      await flush();
      expect(old.changes.return).toHaveBeenCalledOnce();
      writing.resolve(written());
      await f.watch.ready;
      expect(next.write).toHaveBeenCalledOnce();
      expect(f.project.writeAllEntrypointsToDisk).toHaveBeenCalledOnce();
      expect(f.onBuild).toHaveBeenCalledOnce();
    } finally {
      writing.resolve(written());
      await f.watch.close();
    }
  });

  it.each([
    "before",
    "after",
  ])("reports a fatal subscription failure %s readiness", async (stage) => {
    const f = fixture();
    const a = endpoint();
    const b = endpoint();
    const error = new Error("Native subscription failed");
    if (stage === "before") b.subscribe.mockRejectedValueOnce(error);
    f.entries.push({ apps: [a.value, b.value], issues: [] });
    try {
      if (stage === "after") {
        await f.watch.ready;
        a.changes.fail(error);
      } else
        await expect(f.watch.ready).rejects.toThrow(
          "Native subscription failed",
        );
      await expect(f.watch.failure).rejects.toThrow(
        "Native subscription failed",
      );
      expect(f.onError).toHaveBeenCalledOnce();
      expect(f.onBuild).toHaveBeenCalledTimes(stage === "before" ? 0 : 1);
    } finally {
      await f.watch.close();
    }
    expect(a.changes.return).toHaveBeenCalledOnce();
  });

  it("closes late subscriptions once without awaiting a blocked entrypoints return", async () => {
    const f = fixture();
    const a = endpoint();
    const creating = deferred<Awaited<ReturnType<Endpoint["serverChanged"]>>>();
    a.subscribe.mockImplementationOnce(() => creating.promise);
    vi.mocked(f.entries.return).mockImplementationOnce(
      () => new Promise(() => {}),
    );
    f.entries.push({ apps: [a.value], issues: [] });
    await vi.waitFor(() => expect(a.subscribe).toHaveBeenCalledOnce());
    const closing = f.watch.close();
    expect(f.watch.close()).toBe(closing);
    await expect(f.watch.ready).rejects.toThrow("closed before publication");
    const failed = vi.fn();
    void f.watch.failure.catch(failed);
    creating.resolve(a.changes);
    await closing;
    await flush();
    expect(failed).not.toHaveBeenCalled();
    expect(a.changes.return).toHaveBeenCalledOnce();
    expect(f.entries.return).toHaveBeenCalledOnce();
    expect(f.onBuild).not.toHaveBeenCalled();
  });
});
