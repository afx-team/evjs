import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureWatchInputSnapshot,
  collectServerRouteWatchState,
  collectWatchFilesChangedSince,
  createWatchFilesPlan,
  didWatchInputChange,
  listConfigDependencyFiles,
  prepareWatchFilesPlan,
  readWatchInputSnapshot,
  resolveInitialDevWatchMode,
  watchFiles,
} from "../src/_internal/build/dev-watch.js";
import { resolveConfig } from "../src/config/index.js";

type WatchCallback = (
  eventType: fs.WatchEventType,
  filename: string | Buffer | null,
) => void;

interface WatchRecord {
  listener: WatchCallback;
  target: string;
  watcher: FakeWatcher;
}

class FakeWatcher extends EventEmitter {
  closeCalls = 0;

  close(): void {
    this.closeCalls += 1;
  }
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        fs.promises.rm(directory, { recursive: true, force: true }),
      ),
  );
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "evjs-dev-watch-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}

async function writeFile(file: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, "test", "utf-8");
}

function createErrnoError(code: string): NodeJS.ErrnoException {
  const error = new Error(`${code}: simulated watch failure`);
  return Object.assign(error, { code });
}

function mockWatch(
  createWatcher: (target: string) => FakeWatcher = () => new FakeWatcher(),
): WatchRecord[] {
  const records: WatchRecord[] = [];
  vi.spyOn(fs, "watch").mockImplementation(((...args: unknown[]) => {
    const target = path.resolve(String(args[0]));
    const listener = args.at(-1) as WatchCallback;
    const watcher = createWatcher(target);
    records.push({ listener, target, watcher });
    return watcher as unknown as fs.FSWatcher;
  }) as typeof fs.watch);
  return records;
}

async function waitForChange(
  changes: readonly string[],
  file: string,
): Promise<void> {
  const startedAt = Date.now();
  while (!changes.includes(file)) {
    if (Date.now() - startedAt > 2_000) {
      throw new Error(`Polling did not report ${file}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("resolveInitialDevWatchMode", () => {
  it("preselects polling only for the macOS Codex Seatbelt sandbox", () => {
    expect(resolveInitialDevWatchMode("darwin", "seatbelt")).toBe("polling");
    expect(resolveInitialDevWatchMode("darwin", "")).toBe("events");
    expect(resolveInitialDevWatchMode("darwin", "landlock")).toBe("events");
    expect(resolveInitialDevWatchMode("linux", "seatbelt")).toBe("events");
  });
});

describe("watchFiles", () => {
  it("lists every supported config candidate even when none exists", async () => {
    const root = await createTemporaryDirectory();

    expect(listConfigDependencyFiles(root)).toEqual([
      path.join(root, "ev.config.ts"),
      path.join(root, "ev.config.js"),
      path.join(root, "ev.config.mjs"),
    ]);
  });

  it("reconciles only common targets whose snapshots actually changed", async () => {
    const root = await createTemporaryDirectory();
    const first = path.join(root, "first.ts");
    const added = path.join(root, "added.ts");
    await writeFile(first);

    const baseline = prepareWatchFilesPlan(createWatchFilesPlan([first]));
    await fs.promises.writeFile(first, "changed", "utf-8");
    await writeFile(added);
    const current = prepareWatchFilesPlan(createWatchFilesPlan([first, added]));

    expect(collectWatchFilesChangedSince(baseline, current)).toEqual([first]);
    expect(collectWatchFilesChangedSince(current, current)).toEqual([]);
  });

  it("compares a lightweight input capture with a prepared plan", async () => {
    const root = await createTemporaryDirectory();
    const file = path.join(root, "dependency.ts");
    await writeFile(file);

    const baseline = captureWatchInputSnapshot(file);
    const unchanged = prepareWatchFilesPlan(createWatchFilesPlan([file]));
    expect(didWatchInputChange(baseline, unchanged, file)).toBe(false);

    await fs.promises.writeFile(file, "changed", "utf-8");
    const changed = prepareWatchFilesPlan(createWatchFilesPlan([file]));
    expect(didWatchInputChange(baseline, changed, file)).toBe(true);
  });

  it("canonicalizes dependency order without erasing recovery semantics", async () => {
    const root = await createTemporaryDirectory();
    const first = path.join(root, "first.ts");
    const second = path.join(root, "second.ts");
    await writeFile(first);
    await writeFile(second);

    const firstPlan = createWatchFilesPlan(
      [second, first, second],
      new Set([first]),
    );
    const reorderedPlan = createWatchFilesPlan(
      [first, second, first],
      new Set([first]),
    );
    const changedRecoveryPlan = createWatchFilesPlan(
      [first, second],
      new Set([second]),
    );

    expect(firstPlan.logicalTargets).toEqual([first, second]);
    expect(reorderedPlan.logicalTargets).toEqual(firstPlan.logicalTargets);
    expect(reorderedPlan.key).toBe(firstPlan.key);
    expect(changedRecoveryPlan.key).not.toBe(firstPlan.key);
  });

  it("reconciles a resource-unknown snapshot once it becomes readable", async () => {
    const root = await createTemporaryDirectory();
    const directory = path.join(root, "pages");
    await fs.promises.mkdir(directory);
    const originalReaddir = fs.readdirSync;
    vi.spyOn(fs, "readdirSync").mockImplementationOnce((() => {
      throw createErrnoError("EMFILE");
    }) as typeof fs.readdirSync);

    const baseline = prepareWatchFilesPlan(createWatchFilesPlan([directory]));
    vi.mocked(fs.readdirSync).mockImplementation(originalReaddir);
    const current = prepareWatchFilesPlan(createWatchFilesPlan([directory]));

    expect(collectWatchFilesChangedSince(baseline, current)).toEqual([
      directory,
    ]);
    expect(collectWatchFilesChangedSince(baseline, baseline)).toEqual([]);
  });

  it("keeps a missing snapshot stable when an equivalent ancestor replaces it", async () => {
    const root = await createTemporaryDirectory();
    const missing = path.join(root, "nested", "dependency.ts");
    const oldAncestor = path.join(root, "nested-old");
    await fs.promises.mkdir(path.dirname(missing));
    const recoverable = new Set([missing]);
    const baseline = prepareWatchFilesPlan(
      createWatchFilesPlan([missing], recoverable),
    );
    const baselineSnapshot = baseline.baselineSnapshots.get(missing);

    await fs.promises.rename(path.dirname(missing), oldAncestor);
    await fs.promises.mkdir(path.dirname(missing));

    const current = prepareWatchFilesPlan(
      createWatchFilesPlan([missing], recoverable),
    );

    expect(baselineSnapshot).toContain('"missing"');
    expect(current.baselineSnapshots.get(missing)).toBe(baselineSnapshot);
    expect(collectWatchFilesChangedSince(baseline, current)).toEqual([]);
  });

  it("snapshots file content and stable directory topology", async () => {
    const root = await createTemporaryDirectory();
    const directory = path.join(root, "pages");
    const file = path.join(directory, "page.ts");
    const replacement = path.join(root, "replacement.ts");
    await writeFile(file);

    const fileSnapshot = readWatchInputSnapshot(file);
    const directorySnapshot = readWatchInputSnapshot(directory);
    await fs.promises.writeFile(replacement, "test", "utf-8");
    await fs.promises.unlink(file);
    await fs.promises.rename(replacement, file);

    expect(readWatchInputSnapshot(file)).toBe(fileSnapshot);
    expect(readWatchInputSnapshot(directory)).toBe(directorySnapshot);

    await fs.promises.writeFile(file, "changed", "utf-8");
    expect(readWatchInputSnapshot(file)).not.toBe(fileSnapshot);
    expect(readWatchInputSnapshot(directory)).toBe(directorySnapshot);

    await fs.promises.mkdir(path.join(directory, "nested"));
    expect(readWatchInputSnapshot(directory)).not.toBe(directorySnapshot);
  });

  it.runIf(process.platform !== "win32")(
    "uses symbolic-link destinations as stable directory identity",
    async () => {
      const root = await createTemporaryDirectory();
      const firstTarget = path.join(root, "first.ts");
      const secondTarget = path.join(root, "second.ts");
      const link = path.join(root, "link.ts");
      await writeFile(firstTarget);
      await writeFile(secondTarget);
      await fs.promises.symlink(firstTarget, link, "file");

      const firstSnapshot = readWatchInputSnapshot(root);
      await fs.promises.unlink(link);
      await fs.promises.symlink(firstTarget, link, "file");
      expect(readWatchInputSnapshot(root)).toBe(firstSnapshot);

      await fs.promises.unlink(link);
      await fs.promises.symlink(secondTarget, link, "file");
      expect(readWatchInputSnapshot(root)).not.toBe(firstSnapshot);
    },
  );

  it.runIf(process.platform !== "win32")(
    "keeps a missing route-root fallback inside cwd when a parent symlink escapes",
    async () => {
      const cwd = await createTemporaryDirectory();
      const externalRoot = await createTemporaryDirectory();
      const sourceLink = path.join(cwd, "src");
      await fs.promises.symlink(externalRoot, sourceLink, "dir");

      const state = await collectServerRouteWatchState(cwd, resolveConfig({}));

      expect(state).toEqual({
        dependencies: [cwd],
        unsafeBoundary: sourceLink,
      });
    },
  );

  it("coalesces files with their directory and dispatches exact logical targets", async () => {
    const root = await createTemporaryDirectory();
    const directory = path.join(root, "pages");
    const first = path.join(directory, "first.ts");
    const second = path.join(directory, "second.ts");
    await writeFile(first);
    await writeFile(second);

    const records = mockWatch();
    const changes: string[] = [];
    const errors: Error[] = [];
    const stop = watchFiles(
      [directory, first, second, first],
      (file) => changes.push(file),
      { onError: (error) => errors.push(error) },
    );

    expect(records).toHaveLength(1);
    expect(records[0]?.target).toBe(directory);

    await fs.promises.writeFile(first, "changed", "utf-8");
    records[0]?.listener("change", path.basename(first));
    expect(changes).toEqual([first]);

    records[0]?.listener("change", path.basename(first));
    expect(changes).toEqual([first]);

    changes.length = 0;
    await writeFile(path.join(directory, "unrelated.ts"));
    records[0]?.listener("rename", "unrelated.ts");
    expect(changes).toEqual([directory]);

    changes.length = 0;
    records[0]?.listener("rename", null);
    expect(changes).toEqual([]);

    await fs.promises.unlink(second);
    records[0]?.listener("rename", null);
    expect(changes).toEqual([directory, second]);
    expect(errors).toEqual([]);

    stop();
    stop();
    expect(records[0]?.watcher.closeCalls).toBe(1);
  });

  it("deduplicates native events by the latest real input snapshot", async () => {
    const root = await createTemporaryDirectory();
    const file = path.join(root, "dependency.ts");
    await writeFile(file);

    const records = mockWatch();
    const changes: string[] = [];
    const stop = watchFiles(
      [file],
      (changedFile) => changes.push(changedFile),
      {
        onError: vi.fn(),
      },
    );

    await fs.promises.writeFile(file, "test", "utf-8");
    records[0]?.listener("change", path.basename(file));
    expect(changes).toEqual([]);

    await fs.promises.writeFile(file, "changed", "utf-8");
    records[0]?.listener("change", path.basename(file));
    records[0]?.listener("change", path.basename(file));
    records[0]?.listener("rename", null);
    expect(changes).toEqual([file]);
    stop();
  });

  it("filters ignored generated paths from snapshots and native events", async () => {
    const root = await createTemporaryDirectory();
    const authored = path.join(root, "ev.config.ts");
    const generatedRoot = path.join(root, ".ev");
    const generated = path.join(generatedRoot, "framework", "plan.json");
    await writeFile(authored);
    await writeFile(generated);
    const ignorePath = (candidate: string) =>
      candidate === generatedRoot ||
      candidate.startsWith(`${generatedRoot}${path.sep}`);
    const directorySnapshot = readWatchInputSnapshot(root, { ignorePath });

    const records = mockWatch();
    const changes: string[] = [];
    const plan = prepareWatchFilesPlan(createWatchFilesPlan([root, authored]), {
      ignorePath,
    });
    const stop = watchFiles(plan, (file) => changes.push(file), {
      ignorePath,
      onError: vi.fn(),
    });

    await fs.promises.writeFile(generated, "generated", "utf-8");
    records[0]?.listener("change", path.relative(root, generated));
    records[0]?.listener("rename", null);
    expect(readWatchInputSnapshot(root, { ignorePath })).toBe(
      directorySnapshot,
    );
    expect(changes).toEqual([]);

    await fs.promises.writeFile(authored, "changed", "utf-8");
    records[0]?.listener("change", path.basename(authored));
    expect(changes).toEqual([authored]);
    stop();
  });

  it("stops dispatching a shared event after an onChange callback closes it", async () => {
    const root = await createTemporaryDirectory();
    const directory = path.join(root, "pages");
    const file = path.join(directory, "page.ts");
    await writeFile(file);

    const records = mockWatch();
    const changes: string[] = [];
    let stop = () => {};
    stop = watchFiles(
      [directory, file],
      (changedFile) => {
        changes.push(changedFile);
        stop();
      },
      { onError: vi.fn() },
    );

    await fs.promises.unlink(file);
    records[0]?.listener("rename", null);

    expect(changes).toEqual([directory]);
    expect(records[0]?.watcher.closeCalls).toBe(1);
  });

  it("shares an ancestor watcher for overlapping recoverable missing targets", async () => {
    const root = await createTemporaryDirectory();
    const sourceRoot = path.join(root, "src");
    const apiRoot = path.join(sourceRoot, "apis");
    const usersRoute = path.join(apiRoot, "users");
    await fs.promises.mkdir(sourceRoot, { recursive: true });

    const records = mockWatch();
    const changes: string[] = [];
    const stop = watchFiles(
      [apiRoot, usersRoute],
      (file) => changes.push(file),
      {
        onError: vi.fn(),
        recoverableMissingTargets: new Set([apiRoot, usersRoute]),
      },
    );

    expect(records).toHaveLength(1);
    expect(records[0]?.target).toBe(sourceRoot);

    records[0]?.listener("rename", "pages");
    records[0]?.listener("rename", "apis-old");
    expect(changes).toEqual([]);

    await fs.promises.mkdir(apiRoot);
    records[0]?.listener("rename", "apis");
    expect(changes).toEqual([apiRoot, usersRoute]);

    changes.length = 0;
    records[0]?.listener("rename", null);
    expect(changes).toEqual([]);
    stop();
  });

  it.runIf(process.platform !== "win32")(
    "watches symbolic-link targets and atomic link replacements",
    async () => {
      const root = await createTemporaryDirectory();
      const target = path.join(root, "target.ts");
      const link = path.join(root, "link.ts");
      await writeFile(target);
      await fs.promises.symlink(target, link, "file");

      const records = mockWatch();
      const changes: string[] = [];
      const stop = watchFiles([link], (file) => changes.push(file), {
        onError: vi.fn(),
      });

      expect(records.map((record) => record.target).sort()).toEqual(
        [link, root].sort(),
      );
      const targetWatcher = records.find((record) => record.target === link);
      const parentWatcher = records.find((record) => record.target === root);

      await fs.promises.writeFile(target, "changed", "utf-8");
      targetWatcher?.listener("change", path.basename(target));
      expect(changes).toEqual([link]);

      changes.length = 0;
      parentWatcher?.listener("rename", "unrelated.ts");
      expect(changes).toEqual([]);
      const secondTarget = path.join(root, "second-target.ts");
      await fs.promises.writeFile(secondTarget, "second", "utf-8");
      await fs.promises.unlink(link);
      await fs.promises.symlink(secondTarget, link, "file");
      parentWatcher?.listener("rename", path.basename(link));
      expect(changes).toEqual([link]);
      stop();
    },
  );

  it.runIf(process.platform !== "win32")(
    "watches intermediate symbolic-link boundaries without unrelated invalidations",
    async () => {
      const root = await createTemporaryDirectory();
      const firstTarget = path.join(root, "first-target");
      const secondTarget = path.join(root, "second-target");
      const firstFile = path.join(firstTarget, "nested", "dependency.ts");
      const secondFile = path.join(secondTarget, "nested", "dependency.ts");
      const link = path.join(root, "linked-root");
      const logicalFile = path.join(link, "nested", "dependency.ts");
      await writeFile(firstFile);
      await writeFile(secondFile);
      await fs.promises.symlink(firstTarget, link, "dir");

      const firstPlan = createWatchFilesPlan([logicalFile]);
      const records = mockWatch();
      const changes: string[] = [];
      const stop = watchFiles([logicalFile], (file) => changes.push(file), {
        onError: vi.fn(),
      });
      const physicalRoot = await fs.promises.realpath(root);
      const boundaryWatcher = records.find(
        (record) => record.target === physicalRoot,
      );

      expect(records.map((record) => record.target)).toContain(
        path.dirname(logicalFile),
      );
      expect(records.map((record) => record.target)).not.toContain(
        path.parse(root).root,
      );
      expect(boundaryWatcher).toBeDefined();
      boundaryWatcher?.listener("rename", "unrelated");
      expect(changes).toEqual([]);

      await fs.promises.unlink(link);
      await fs.promises.symlink(secondTarget, link, "dir");
      boundaryWatcher?.listener("rename", path.basename(link));
      expect(changes).toEqual([logicalFile]);
      const secondPlan = createWatchFilesPlan([logicalFile]);
      expect(secondPlan.key).not.toBe(firstPlan.key);
      stop();
    },
  );

  it.runIf(process.platform !== "win32")(
    "watches missing targets below intermediate symbolic links",
    async () => {
      const root = await createTemporaryDirectory();
      const target = path.join(root, "target", "nested");
      const link = path.join(root, "linked-root");
      const missing = path.join(link, "nested", "missing.ts");
      await fs.promises.mkdir(target, { recursive: true });
      await fs.promises.symlink(path.join(root, "target"), link, "dir");

      const records = mockWatch();
      const changes: string[] = [];
      const stop = watchFiles([missing], (file) => changes.push(file), {
        onError: vi.fn(),
        recoverableMissingTargets: new Set([missing]),
      });
      const physicalRoot = await fs.promises.realpath(root);
      const boundaryWatcher = records.find(
        (record) => record.target === physicalRoot,
      );

      expect(records.map((record) => record.target)).toContain(
        path.join(link, "nested"),
      );
      boundaryWatcher?.listener("rename", "unrelated");
      expect(changes).toEqual([]);
      const secondTarget = path.join(root, "second-target", "nested");
      await fs.promises.mkdir(secondTarget, { recursive: true });
      await fs.promises.unlink(link);
      await fs.promises.symlink(path.dirname(secondTarget), link, "dir");
      boundaryWatcher?.listener("rename", path.basename(link));
      expect(changes).toEqual([missing]);
      stop();
    },
  );

  it.runIf(process.platform !== "win32")(
    "watches every symbolic link in a chained target resolution",
    async () => {
      const root = await createTemporaryDirectory();
      const shared = path.join(root, "shared");
      const firstTarget = path.join(root, "first-target");
      const secondTarget = path.join(root, "second-target");
      const outerLink = path.join(root, "outer-link");
      const innerLink = path.join(shared, "inner-link");
      const logicalFile = path.join(outerLink, "nested", "dependency.ts");
      await writeFile(path.join(firstTarget, "nested", "dependency.ts"));
      await writeFile(path.join(secondTarget, "nested", "dependency.ts"));
      await fs.promises.mkdir(shared);
      await fs.promises.symlink("../first-target", innerLink, "dir");
      await fs.promises.symlink("shared/inner-link", outerLink, "dir");

      const firstPlan = createWatchFilesPlan([logicalFile]);
      const records = mockWatch();
      const changes: string[] = [];
      const stop = watchFiles([logicalFile], (file) => changes.push(file), {
        onError: vi.fn(),
      });
      const physicalShared = await fs.promises.realpath(shared);
      const innerBoundaryWatcher = records.find(
        (record) => record.target === physicalShared,
      );

      expect(innerBoundaryWatcher).toBeDefined();
      innerBoundaryWatcher?.listener("rename", "unrelated");
      expect(changes).toEqual([]);

      await fs.promises.unlink(innerLink);
      await fs.promises.symlink("../second-target", innerLink, "dir");
      innerBoundaryWatcher?.listener("rename", path.basename(innerLink));
      expect(changes).toEqual([logicalFile]);
      const secondPlan = createWatchFilesPlan([logicalFile]);
      expect(secondPlan.key).not.toBe(firstPlan.key);
      stop();
    },
  );

  it("polls missing targets and immediate directory entries", async () => {
    const root = await createTemporaryDirectory();
    const directory = path.join(root, "pages");
    const missing = path.join(root, "apis");
    await fs.promises.mkdir(directory);

    const changes: string[] = [];
    const stop = watchFiles(
      [directory, missing],
      (file) => changes.push(file),
      {
        mode: "polling",
        onError: vi.fn(),
        recoverableMissingTargets: new Set([missing]),
      },
    );

    try {
      await writeFile(path.join(directory, "page.ts"));
      await fs.promises.mkdir(missing);
      await waitForChange(changes, directory);
      await waitForChange(changes, missing);
    } finally {
      stop();
    }
  });

  it("ignores unchanged polling snapshots and changes after stop", async () => {
    const root = await createTemporaryDirectory();
    const file = path.join(root, "stable.ts");
    await writeFile(file);

    const changes: string[] = [];
    const stop = watchFiles(
      [file],
      (changedFile) => changes.push(changedFile),
      {
        mode: "polling",
        onError: vi.fn(),
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(changes).toEqual([]);

    stop();
    stop();
    await fs.promises.writeFile(file, "changed", "utf-8");
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(changes).toEqual([]);
  });

  it("deduplicates polling writes with unchanged file content", async () => {
    const root = await createTemporaryDirectory();
    const file = path.join(root, "stable.ts");
    await writeFile(file);

    const changes: string[] = [];
    const stop = watchFiles(
      [file],
      (changedFile) => changes.push(changedFile),
      {
        mode: "polling",
        onError: vi.fn(),
      },
    );

    try {
      await fs.promises.writeFile(file, "test", "utf-8");
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(changes).toEqual([]);

      await fs.promises.writeFile(file, "changed", "utf-8");
      await waitForChange(changes, file);
      await fs.promises.writeFile(file, "changed", "utf-8");
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(changes).toEqual([file]);
    } finally {
      stop();
    }
  });

  it("runs polling cycles single-flight and reuses reads within each cycle", async () => {
    const root = await createTemporaryDirectory();
    const directory = path.join(root, "pages");
    const file = path.join(directory, "page.ts");
    await writeFile(file);

    const originalLstat = fs.promises.lstat;
    let directoryReads = 0;
    let fileReads = 0;
    let releaseDirectoryRead: (() => void) | undefined;
    const directoryReadCanFinish = new Promise<void>((resolve) => {
      releaseDirectoryRead = resolve;
    });
    let blockFirstDirectoryRead = true;
    vi.spyOn(fs.promises, "lstat").mockImplementation((async (
      ...args: unknown[]
    ) => {
      const target = path.resolve(String(args[0]));
      if (target === directory) {
        directoryReads += 1;
        if (blockFirstDirectoryRead) {
          blockFirstDirectoryRead = false;
          await directoryReadCanFinish;
        }
      }
      if (target === file) fileReads += 1;
      return Reflect.apply(originalLstat, fs.promises, args);
    }) as typeof fs.promises.lstat);

    const changes: string[] = [];
    const stop = watchFiles(
      [directory, file],
      (changedFile) => changes.push(changedFile),
      {
        mode: "polling",
        onError: vi.fn(),
      },
    );

    try {
      await vi.waitFor(() => expect(directoryReads).toBe(1));
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(directoryReads).toBe(1);

      await fs.promises.writeFile(file, "changed", "utf-8");
      releaseDirectoryRead?.();
      await waitForChange(changes, file);
      expect(fileReads).toBe(1);
    } finally {
      releaseDirectoryRead?.();
      stop();
    }
  });

  it.runIf(process.platform !== "win32")(
    "polls symbolic-link target edits and replacements",
    async () => {
      const root = await createTemporaryDirectory();
      const firstTarget = path.join(root, "first.ts");
      const secondTarget = path.join(root, "second.ts");
      const link = path.join(root, "link.ts");
      await writeFile(firstTarget);
      await fs.promises.writeFile(secondTarget, "second", "utf-8");
      await fs.promises.symlink(firstTarget, link, "file");

      const changes: string[] = [];
      const stop = watchFiles([link], (file) => changes.push(file), {
        mode: "polling",
        onError: vi.fn(),
      });

      try {
        await fs.promises.writeFile(firstTarget, "changed", "utf-8");
        await waitForChange(changes, link);
        changes.length = 0;

        await fs.promises.unlink(link);
        await fs.promises.symlink(secondTarget, link, "file");
        await waitForChange(changes, link);
      } finally {
        stop();
      }
    },
  );

  it.runIf(process.platform !== "win32")(
    "survives a missing target's symlink ancestor being atomically replaced",
    async () => {
      const root = await createTemporaryDirectory();
      const target = path.join(root, "target");
      const link = path.join(root, "link");
      const missing = path.join(link, "dependency.ts");
      await fs.promises.mkdir(target);
      await fs.promises.symlink(target, link, "dir");

      const originalRealpath = fs.promises.realpath;
      let replaced = false;
      vi.spyOn(fs.promises, "realpath").mockImplementation((async (
        ...args: unknown[]
      ) => {
        const result = await Reflect.apply(originalRealpath, fs.promises, args);
        if (!replaced && path.resolve(String(args[0])) === link) {
          replaced = true;
          await fs.promises.unlink(link);
          await fs.promises.mkdir(link);
        }
        return result;
      }) as typeof fs.promises.realpath);

      const changes: string[] = [];
      const errors: Error[] = [];
      const stop = watchFiles(
        [missing],
        (changedFile) => changes.push(changedFile),
        {
          mode: "polling",
          onError: (error) => errors.push(error),
          recoverableMissingTargets: new Set([missing]),
        },
      );

      try {
        await vi.waitFor(() => expect(replaced).toBe(true), {
          interval: 20,
          timeout: 2_000,
        });
        await waitForChange(changes, missing);
        await new Promise((resolve) => setTimeout(resolve, 250));
        changes.length = 0;

        await fs.promises.writeFile(missing, "created", "utf-8");
        await waitForChange(changes, missing);
        expect(errors).toEqual([]);
      } finally {
        stop();
      }
    },
  );

  it("backs off resource-limited polling targets without delaying healthy ones", async () => {
    vi.useFakeTimers();
    const root = await createTemporaryDirectory();
    const limited = path.join(root, "limited.ts");
    const healthy = path.join(root, "healthy.ts");
    await writeFile(limited);
    await writeFile(healthy);

    let resourceLimited = true;
    let limitedReads = 0;
    let healthyReads = 0;
    vi.spyOn(fs.promises, "lstat").mockImplementation((async (
      ...args: unknown[]
    ) => {
      const target = path.resolve(String(args[0]));
      if (target === limited) {
        limitedReads += 1;
        if (resourceLimited) throw createErrnoError("EMFILE");
      }
      if (target === healthy) healthyReads += 1;
      return fs.lstatSync(target, { bigint: true });
    }) as typeof fs.promises.lstat);
    vi.spyOn(fs.promises, "readFile").mockImplementation((async (
      ...args: unknown[]
    ) => fs.readFileSync(String(args[0]))) as typeof fs.promises.readFile);
    vi.spyOn(fs.promises, "realpath").mockImplementation((async (file) =>
      fs.realpathSync(file)) as typeof fs.promises.realpath);

    const changes: string[] = [];
    const errors: Error[] = [];
    const stop = watchFiles(
      [limited, healthy],
      (changedFile) => changes.push(changedFile),
      {
        mode: "polling",
        onError: (error) => errors.push(error),
      },
    );

    try {
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(200);
      await vi.advanceTimersByTimeAsync(400);
      expect(limitedReads).toBe(3);
      expect(healthyReads).toBe(7);
      expect(changes).toEqual([]);

      resourceLimited = false;
      await fs.promises.writeFile(limited, "changed after pressure", "utf-8");
      await vi.advanceTimersByTimeAsync(900);
      expect(limitedReads).toBeGreaterThanOrEqual(4);
      expect(changes).toEqual([limited]);
      expect(errors).toEqual([]);
    } finally {
      stop();
    }
  });

  it.each([
    "EACCES",
    "EPERM",
    "EIO",
  ])("closes partial watchers and reports fatal setup error %s", async (code) => {
    const root = await createTemporaryDirectory();
    const firstDirectory = path.join(root, "first");
    const secondDirectory = path.join(root, "second");
    const first = path.join(firstDirectory, "first.ts");
    const second = path.join(secondDirectory, "second.ts");
    await writeFile(first);
    await writeFile(second);

    const failure = createErrnoError(code);
    const records = mockWatch((target) => {
      if (target === secondDirectory) throw failure;
      return new FakeWatcher();
    });
    const errors: Error[] = [];

    let thrown: unknown;
    try {
      watchFiles([first, second], vi.fn(), {
        onError: (error) => errors.push(error),
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(errors[0]);
    expect((thrown as NodeJS.ErrnoException).code).toBe(code);
    expect((thrown as Error).message).toContain(secondDirectory);
    expect(errors).toHaveLength(1);
    expect(records).toHaveLength(1);
    expect(records[0]?.watcher.closeCalls).toBe(1);
  });

  it.each([
    "EMFILE",
    "ENFILE",
    "ENOSPC",
    "ENOSYS",
    "ENOTSUP",
    "EOPNOTSUPP",
    "ERR_FEATURE_UNAVAILABLE_ON_PLATFORM",
  ])("falls back to polling after native watch setup error %s", async (code) => {
    const root = await createTemporaryDirectory();
    const firstDirectory = path.join(root, "first");
    const secondDirectory = path.join(root, "second");
    const first = path.join(firstDirectory, "first.ts");
    const second = path.join(secondDirectory, "second.ts");
    await writeFile(first);
    await writeFile(second);

    const resourceError = createErrnoError(code);
    const records = mockWatch((target) => {
      if (target === secondDirectory) throw resourceError;
      return new FakeWatcher();
    });
    const changes: string[] = [];
    const onError = vi.fn();
    const onFallback = vi.fn();
    const stop = watchFiles([first, second], (file) => changes.push(file), {
      onError,
      onFallback,
    });

    expect(onError).not.toHaveBeenCalled();
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect((onFallback.mock.calls[0]?.[0] as NodeJS.ErrnoException).code).toBe(
      code,
    );
    expect(records[0]?.watcher.closeCalls).toBe(1);
    expect(changes).toEqual([]);
    try {
      await fs.promises.writeFile(first, "changed", "utf-8");
      await waitForChange(changes, first);
      expect(changes).toEqual([first]);
    } finally {
      stop();
    }
  });

  it.each([
    "target kind",
    "watch target identity",
  ] as const)("falls back to polling when the %s topology probe exhausts resources", async (probe) => {
    const root = await createTemporaryDirectory();
    const file = path.join(root, "dependency.ts");
    await writeFile(file);

    const originalLstat = fs.lstatSync;
    let failed = false;
    vi.spyOn(fs, "lstatSync").mockImplementation(((...args: unknown[]) => {
      const target = path.resolve(String(args[0]));
      const shouldFail =
        !failed &&
        (probe === "target kind" ? target === file : target === root);
      if (shouldFail) {
        failed = true;
        throw createErrnoError("EMFILE");
      }
      return Reflect.apply(originalLstat, fs, args);
    }) as typeof fs.lstatSync);
    const watchRecords = mockWatch();
    const changes: string[] = [];
    const onError = vi.fn();
    const onFallback = vi.fn();
    const stop = watchFiles(
      [file],
      (changedFile) => changes.push(changedFile),
      {
        onError,
        onFallback,
      },
    );

    expect(failed).toBe(true);
    expect(watchRecords).toEqual([]);
    expect(onError).not.toHaveBeenCalled();
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect((onFallback.mock.calls[0]?.[0] as NodeJS.ErrnoException).code).toBe(
      "EMFILE",
    );

    try {
      await fs.promises.writeFile(file, "changed", "utf-8");
      await waitForChange(changes, file);
    } finally {
      stop();
    }
  });

  it.each([
    "ENOENT",
    "ENOTDIR",
  ])("switches to polling after setup race %s", async (code) => {
    const root = await createTemporaryDirectory();
    const missingDirectory = path.join(root, "missing-race");
    const liveDirectory = path.join(root, "live");
    const missingRace = path.join(missingDirectory, "race.ts");
    const live = path.join(liveDirectory, "live.ts");
    await writeFile(missingRace);
    await writeFile(live);

    const records = mockWatch((target) => {
      if (target === missingDirectory) {
        fs.rmSync(missingDirectory, { force: true, recursive: true });
        if (code === "ENOTDIR") {
          fs.writeFileSync(missingDirectory, "not a directory", "utf-8");
        }
        throw createErrnoError(code);
      }
      return new FakeWatcher();
    });
    const changes: string[] = [];
    const onError = vi.fn();
    const stop = watchFiles([missingRace, live], (file) => changes.push(file), {
      onError,
    });

    expect(onError).not.toHaveBeenCalled();
    expect(records).toHaveLength(1);
    expect(records[0]?.target).toBe(liveDirectory);
    expect(records[0]?.watcher.closeCalls).toBe(1);
    expect(changes).toEqual([missingRace]);
    changes.length = 0;
    try {
      await fs.promises.writeFile(live, "changed", "utf-8");
      await waitForChange(changes, live);
      expect(changes).toEqual([live]);
    } finally {
      stop();
    }
  });

  it("recovers a synchronous EPERM when the planned watch target disappeared", async () => {
    const root = await createTemporaryDirectory();
    const staleDirectory = path.join(root, "stale");
    const liveDirectory = path.join(root, "live");
    const stale = path.join(staleDirectory, "dependency.ts");
    const live = path.join(liveDirectory, "dependency.ts");
    await writeFile(stale);
    await writeFile(live);

    mockWatch((target) => {
      if (target === staleDirectory) {
        fs.rmSync(staleDirectory, { force: true, recursive: true });
        throw createErrnoError("EPERM");
      }
      return new FakeWatcher();
    });
    const changes: string[] = [];
    const onError = vi.fn();
    const stop = watchFiles([stale, live], (file) => changes.push(file), {
      onError,
    });

    expect(onError).not.toHaveBeenCalled();
    expect(changes).toEqual([stale]);
    changes.length = 0;
    try {
      await fs.promises.writeFile(live, "changed", "utf-8");
      await waitForChange(changes, live);
      expect(changes).toEqual([live]);
    } finally {
      stop();
    }
  });

  it.each([
    "EMFILE",
    "ENFILE",
    "ENOSPC",
    "ENOSYS",
    "ENOTSUP",
    "EOPNOTSUPP",
    "ERR_FEATURE_UNAVAILABLE_ON_PLATFORM",
  ])("falls back to polling after asynchronous native watch error %s", async (code) => {
    const root = await createTemporaryDirectory();
    const first = path.join(root, "first", "first.ts");
    const second = path.join(root, "second", "second.ts");
    await writeFile(first);
    await writeFile(second);

    const records = mockWatch();
    const changes: string[] = [];
    const onError = vi.fn();
    const onFallback = vi.fn();
    const stop = watchFiles([first, second], (file) => changes.push(file), {
      onError,
      onFallback,
    });

    expect(records).toHaveLength(2);
    records[0]?.watcher.emit("error", createErrnoError(code));
    expect(onError).not.toHaveBeenCalled();
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(records.map((record) => record.watcher.closeCalls)).toEqual([1, 1]);
    expect(changes).toEqual([]);

    try {
      await fs.promises.writeFile(second, "changed", "utf-8");
      await waitForChange(changes, second);
      expect(changes).toEqual([second]);
    } finally {
      stop();
      stop();
    }
    records[0]?.listener("change", path.basename(first));
    expect(changes).toEqual([second]);
  });

  it("falls back to polling when a native watcher closes unexpectedly", async () => {
    const root = await createTemporaryDirectory();
    const first = path.join(root, "first", "first.ts");
    const second = path.join(root, "second", "second.ts");
    await writeFile(first);
    await writeFile(second);

    const records = mockWatch();
    const changes: string[] = [];
    const errors: Error[] = [];
    const onFallback = vi.fn();
    const stop = watchFiles(
      [first, second],
      (changedFile) => changes.push(changedFile),
      {
        onError: (error) => errors.push(error),
        onFallback,
      },
    );

    expect(records).toHaveLength(2);
    records[0]?.watcher.emit("close");
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback.mock.calls[0]?.[0].message).toContain(
      "closed unexpectedly",
    );
    expect(records.map((record) => record.watcher.closeCalls)).toEqual([1, 1]);
    expect(changes).toEqual([]);

    try {
      await fs.promises.writeFile(second, "changed", "utf-8");
      await waitForChange(changes, second);
      expect(errors).toEqual([]);
    } finally {
      stop();
    }

    records[1]?.watcher.emit("close");
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it("recovers an asynchronous EPERM after watch target replacement", async () => {
    const root = await createTemporaryDirectory();
    const staleDirectory = path.join(root, "stale");
    const movedDirectory = path.join(root, "stale-old");
    const liveDirectory = path.join(root, "live");
    const stale = path.join(staleDirectory, "dependency.ts");
    const live = path.join(liveDirectory, "dependency.ts");
    await writeFile(stale);
    await writeFile(live);

    const records = mockWatch();
    const changes: string[] = [];
    const onError = vi.fn();
    const stop = watchFiles([stale, live], (file) => changes.push(file), {
      onError,
    });
    const staleRecord = records.find(
      (record) => record.target === staleDirectory,
    );
    if (!staleRecord) throw new Error("Expected the stale directory watcher.");

    await fs.promises.rename(staleDirectory, movedDirectory);
    await fs.promises.mkdir(staleDirectory);
    staleRecord.watcher.emit("error", createErrnoError("EPERM"));

    expect(onError).not.toHaveBeenCalled();
    expect(changes).toEqual([stale]);
    expect(records.map((record) => record.watcher.closeCalls)).toEqual([1, 1]);
    changes.length = 0;
    try {
      await fs.promises.writeFile(live, "changed", "utf-8");
      await waitForChange(changes, live);
      expect(changes).toEqual([live]);
    } finally {
      stop();
    }
  });

  it("treats a permission failure during EPERM topology probing as fatal", async () => {
    const root = await createTemporaryDirectory();
    const directory = path.join(root, "watched");
    const file = path.join(directory, "dependency.ts");
    await writeFile(file);

    const records = mockWatch();
    const errors: Error[] = [];
    const stop = watchFiles([file], vi.fn(), {
      onError: (error) => errors.push(error),
    });
    const originalLstat = fs.lstatSync;
    vi.spyOn(fs, "lstatSync").mockImplementation(((...args: unknown[]) => {
      if (path.resolve(String(args[0])) === directory) {
        throw createErrnoError("EACCES");
      }
      return Reflect.apply(originalLstat, fs, args);
    }) as typeof fs.lstatSync);

    records[0]?.watcher.emit("error", createErrnoError("EPERM"));
    stop();

    expect(errors).toHaveLength(1);
    expect((errors[0] as NodeJS.ErrnoException | undefined)?.code).toBe(
      "EACCES",
    );
    expect(records[0]?.watcher.closeCalls).toBe(1);
  });

  it("invalidates a target changed while event watchers hand off to polling", async () => {
    const root = await createTemporaryDirectory();
    const file = path.join(root, "dependency.ts");
    await writeFile(file);

    const records = mockWatch();
    const changes: string[] = [];
    const stop = watchFiles(
      [file],
      (changedFile) => changes.push(changedFile),
      {
        onError: vi.fn(),
        onFallback: vi.fn(),
      },
    );
    const watcher = records[0]?.watcher;
    if (!watcher) throw new Error("Expected an event watcher.");
    watcher.close = () => {
      watcher.closeCalls += 1;
      fs.writeFileSync(file, "changed during handoff", "utf-8");
    };

    watcher.emit("error", createErrnoError("EMFILE"));

    expect(changes).toEqual([file]);
    expect(watcher.closeCalls).toBe(1);
    stop();
  });

  it.each([
    "EACCES",
    "EPERM",
    "EIO",
  ])("closes every watcher and reports asynchronous fatal error %s only once", async (code) => {
    const root = await createTemporaryDirectory();
    const first = path.join(root, "first", "first.ts");
    const second = path.join(root, "second", "second.ts");
    await writeFile(first);
    await writeFile(second);

    const records = mockWatch();
    const changes: string[] = [];
    const errors: Error[] = [];
    const stop = watchFiles([first, second], (file) => changes.push(file), {
      onError: (error) => errors.push(error),
    });

    records[0]?.watcher.emit("error", createErrnoError(code));
    records[1]?.watcher.emit("error", createErrnoError("EUNKNOWN"));
    stop();
    records[0]?.listener("change", path.basename(first));

    expect(errors).toHaveLength(1);
    expect((errors[0] as NodeJS.ErrnoException | undefined)?.code).toBe(code);
    expect(changes).toEqual([]);
    expect(records.map((record) => record.watcher.closeCalls)).toEqual([1, 1]);
  });

  it("stops polling and reports a polling snapshot failure only once", async () => {
    const root = await createTemporaryDirectory();
    const file = path.join(root, "polling-failure.ts");
    await writeFile(file);

    const originalLstat = fs.promises.lstat;
    let failPollingRead = false;
    vi.spyOn(fs.promises, "lstat").mockImplementation((async (
      ...args: unknown[]
    ) => {
      const target = args[0];
      if (failPollingRead && path.resolve(String(target)) === file) {
        throw createErrnoError("EACCES");
      }
      return Reflect.apply(originalLstat, fs.promises, args);
    }) as typeof fs.promises.lstat);
    const changes: string[] = [];
    const errors: Error[] = [];
    const stop = watchFiles(
      [file],
      (changedFile) => changes.push(changedFile),
      {
        mode: "polling",
        onError: (error) => errors.push(error),
      },
    );

    failPollingRead = true;
    await vi.waitFor(
      () => {
        expect(errors).toHaveLength(1);
      },
      { interval: 20, timeout: 2_000 },
    );
    expect((errors[0] as NodeJS.ErrnoException | undefined)?.code).toBe(
      "EACCES",
    );
    expect(errors[0]?.message).toContain(file);

    await new Promise((resolve) => setTimeout(resolve, 150));
    stop();
    stop();
    expect(errors).toHaveLength(1);
    expect(changes).toEqual([]);
  });

  it("retries polling snapshots after a transient resource error", async () => {
    const root = await createTemporaryDirectory();
    const file = path.join(root, "polling-resource-retry.ts");
    await writeFile(file);

    const originalLstat = fs.promises.lstat;
    let resourceFailures = 0;
    vi.spyOn(fs.promises, "lstat").mockImplementation((async (
      ...args: unknown[]
    ) => {
      if (resourceFailures === 0 && path.resolve(String(args[0])) === file) {
        resourceFailures += 1;
        throw createErrnoError("EMFILE");
      }
      return Reflect.apply(originalLstat, fs.promises, args);
    }) as typeof fs.promises.lstat);
    const changes: string[] = [];
    const errors: Error[] = [];
    const stop = watchFiles(
      [file],
      (changedFile) => changes.push(changedFile),
      {
        mode: "polling",
        onError: (error) => errors.push(error),
      },
    );

    try {
      await vi.waitFor(() => expect(resourceFailures).toBe(1), {
        interval: 20,
        timeout: 2_000,
      });
      await fs.promises.writeFile(file, "changed", "utf-8");
      await waitForChange(changes, file);
      expect(errors).toEqual([]);
    } finally {
      stop();
    }
  });
});
