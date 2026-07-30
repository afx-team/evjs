import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readUtoopackStatsSetVersion,
  readUtoopackStatsVersion,
  startUtoopackStatsMonitor,
} from "../src/adapter/stats-monitor.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        fs.promises.rm(directory, { force: true, recursive: true }),
      ),
  );
});

describe("startUtoopackStatsMonitor", () => {
  it("publishes client-only changes without activation", async () => {
    const { initialVersion, statsPath } = await createChangedStatsFile();
    const publish = vi.fn(() => readPublication([statsPath]));
    const monitor = startUtoopackStatsMonitor({
      statsPaths: [statsPath],
      initialVersion,
      publish,
      onError() {},
    });

    try {
      await waitFor(() => publish.mock.calls.length === 1);

      expect(publish).toHaveBeenCalledTimes(1);
    } finally {
      await monitor.close();
    }
  });

  it("publishes either compiler while activating only server changes", async () => {
    const directory = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "evjs-utoopack-stats-"),
    );
    temporaryDirectories.push(directory);
    const clientStatsPath = path.join(directory, "client-stats.json");
    const serverStatsPath = path.join(directory, "server-stats.json");
    await Promise.all([
      fs.promises.writeFile(clientStatsPath, "client-initial", "utf-8"),
      fs.promises.writeFile(serverStatsPath, "server-initial", "utf-8"),
    ]);
    const [initialVersion, initialActivationVersion] = await Promise.all([
      readUtoopackStatsSetVersion([clientStatsPath, serverStatsPath]),
      readUtoopackStatsVersion(serverStatsPath),
    ]);
    const publish = vi.fn(() =>
      readPublication([clientStatsPath, serverStatsPath], serverStatsPath),
    );
    const activate = vi.fn(async () => {});
    const monitor = startUtoopackStatsMonitor({
      statsPaths: [clientStatsPath, serverStatsPath],
      initialVersion,
      initialActivationVersion,
      publish,
      activate,
      onError() {},
    });

    try {
      await fs.promises.writeFile(clientStatsPath, "client-rebuild", "utf-8");
      await waitFor(() => publish.mock.calls.length === 1);
      expect(activate).not.toHaveBeenCalled();

      await fs.promises.writeFile(serverStatsPath, "server-rebuild", "utf-8");
      await waitFor(() => activate.mock.calls.length === 1);
      expect(publish).toHaveBeenCalledTimes(2);
    } finally {
      await monitor.close();
    }
  });

  it("retries an unconsumed stats version when publication fails", async () => {
    const { initialActivationVersion, initialVersion, statsPath } =
      await createChangedStatsFile();
    const publish = vi.fn(() => readPublication([statsPath], statsPath));
    publish.mockRejectedValueOnce(new Error("publication failed"));
    const activate = vi.fn(async () => {});
    const errors: Array<{ error: unknown; phase: "publish" | "activate" }> = [];
    const monitor = startUtoopackStatsMonitor({
      statsPaths: [statsPath],
      initialVersion,
      initialActivationVersion,
      publish,
      activate,
      onError(error, phase) {
        errors.push({ error, phase });
      },
    });

    try {
      await waitFor(() => activate.mock.calls.length === 1);

      expect(publish).toHaveBeenCalledTimes(2);
      expect(activate).toHaveBeenCalledTimes(1);
      expect(errors).toEqual([
        { error: new Error("publication failed"), phase: "publish" },
      ]);
    } finally {
      await monitor.close();
    }
  });

  it("retries activation without republishing a consumed stats version", async () => {
    const { initialActivationVersion, initialVersion, statsPath } =
      await createChangedStatsFile();
    const publish = vi.fn(() => readPublication([statsPath], statsPath));
    const activate = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("activation failed"))
      .mockResolvedValue(undefined);
    const errors: Array<{ error: unknown; phase: "publish" | "activate" }> = [];
    const monitor = startUtoopackStatsMonitor({
      statsPaths: [statsPath],
      initialVersion,
      initialActivationVersion,
      publish,
      activate,
      onError(error, phase) {
        errors.push({ error, phase });
      },
    });

    try {
      await waitFor(() => activate.mock.calls.length === 2);

      expect(publish).toHaveBeenCalledTimes(1);
      expect(activate).toHaveBeenCalledTimes(2);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.phase).toBe("activate");
      expect(errors[0]?.error).toEqual(new Error("activation failed"));
    } finally {
      await monitor.close();
    }
  });

  it("retries temporarily rejected facts before consuming their version", async () => {
    const { initialActivationVersion, initialVersion, statsPath } =
      await createChangedStatsFile();
    let rejectPublication = true;
    const publish = vi.fn(async () => {
      const publication = await readPublication([statsPath], statsPath);
      const published = !rejectPublication;
      rejectPublication = false;
      return { ...publication, published };
    });
    const activate = vi.fn(async () => {});
    const monitor = startUtoopackStatsMonitor({
      statsPaths: [statsPath],
      initialVersion,
      initialActivationVersion,
      publish,
      activate,
      onError() {},
    });

    try {
      await waitFor(() => activate.mock.calls.length === 1);

      expect(publish).toHaveBeenCalledTimes(2);
      expect(activate).toHaveBeenCalledTimes(1);
    } finally {
      await monitor.close();
    }
  });

  it("postpones an older pending activation while newer facts are rejected", async () => {
    const { initialActivationVersion, initialVersion, statsPath } =
      await createChangedStatsFile();
    let publishCalls = 0;
    let releaseLatestPublish!: () => void;
    const latestPublish = new Promise<void>((resolve) => {
      releaseLatestPublish = resolve;
    });
    const publish = vi.fn(async () => {
      publishCalls++;
      const publication = await readPublication([statsPath], statsPath);
      if (publishCalls === 2) {
        return { ...publication, published: false };
      }
      if (publishCalls === 3) await latestPublish;
      return publication;
    });
    const activate = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("activation failed"))
      .mockResolvedValue(undefined);
    const monitor = startUtoopackStatsMonitor({
      statsPaths: [statsPath],
      initialVersion,
      initialActivationVersion,
      publish,
      activate,
      onError() {},
    });

    try {
      await waitFor(() => activate.mock.calls.length === 1);
      await fs.promises.writeFile(
        statsPath,
        "newer-authoritative-version",
        "utf-8",
      );
      await waitFor(() => publish.mock.calls.length === 3);

      expect(activate).toHaveBeenCalledTimes(1);

      releaseLatestPublish();
      await waitFor(() => activate.mock.calls.length === 2);
      expect(publish).toHaveBeenCalledTimes(3);
    } finally {
      releaseLatestPublish();
      await monitor.close();
    }
  });

  it("publishes the latest client and server snapshot before activation", async () => {
    const directory = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "evjs-utoopack-stats-"),
    );
    temporaryDirectories.push(directory);
    const clientStatsPath = path.join(directory, "client-stats.json");
    const serverStatsPath = path.join(directory, "server-stats.json");
    await Promise.all([
      fs.promises.writeFile(clientStatsPath, "client-initial", "utf-8"),
      fs.promises.writeFile(serverStatsPath, "server-initial", "utf-8"),
    ]);
    const [initialVersion, initialActivationVersion] = await Promise.all([
      readUtoopackStatsSetVersion([clientStatsPath, serverStatsPath]),
      readUtoopackStatsVersion(serverStatsPath),
    ]);
    await fs.promises.writeFile(clientStatsPath, "client-first", "utf-8");
    let publishCount = 0;
    const publish = vi.fn(async () => {
      publishCount++;
      const publication = await readPublication(
        [clientStatsPath, serverStatsPath],
        serverStatsPath,
      );
      if (publishCount === 1) {
        await Promise.all([
          fs.promises.writeFile(
            clientStatsPath,
            "client-latest-version",
            "utf-8",
          ),
          fs.promises.writeFile(
            serverStatsPath,
            "server-latest-version",
            "utf-8",
          ),
        ]);
      }
      return publication;
    });
    const activate = vi.fn(async () => {});
    const monitor = startUtoopackStatsMonitor({
      statsPaths: [clientStatsPath, serverStatsPath],
      initialVersion,
      initialActivationVersion,
      publish,
      activate,
      onError() {},
    });

    try {
      await waitFor(() => activate.mock.calls.length === 1);

      expect(publish).toHaveBeenCalledTimes(2);
      expect(activate).toHaveBeenCalledTimes(1);
    } finally {
      await monitor.close();
    }
  });

  it("does not activate after close begins during publication", async () => {
    const { initialActivationVersion, initialVersion, statsPath } =
      await createChangedStatsFile();
    let releasePublish!: () => void;
    const publishReleased = new Promise<void>((resolve) => {
      releasePublish = resolve;
    });
    let markPublishStarted!: () => void;
    const publishStarted = new Promise<void>((resolve) => {
      markPublishStarted = resolve;
    });
    const publish = vi.fn(async () => {
      const publication = await readPublication([statsPath], statsPath);
      markPublishStarted();
      await publishReleased;
      return publication;
    });
    const activate = vi.fn(async () => {});
    const monitor = startUtoopackStatsMonitor({
      statsPaths: [statsPath],
      initialVersion,
      initialActivationVersion,
      publish,
      activate,
      onError() {},
    });

    try {
      await publishStarted;
      const closing = monitor.close();
      releasePublish();
      await closing;

      expect(publish).toHaveBeenCalledTimes(1);
      expect(activate).not.toHaveBeenCalled();
    } finally {
      releasePublish();
      await monitor.close();
    }
  });

  it("coalesces interval polls while publication is still running", async () => {
    vi.useFakeTimers();
    const { initialVersion, statsPath } = await createChangedStatsFile();
    let releaseFirstPublish!: () => void;
    const firstPublishReleased = new Promise<void>((resolve) => {
      releaseFirstPublish = resolve;
    });
    let markFirstPublishStarted!: () => void;
    const firstPublishStarted = new Promise<void>((resolve) => {
      markFirstPublishStarted = resolve;
    });
    const stat = vi.spyOn(fs.promises, "stat");
    const publish = vi.fn(async () => {
      const publication = await readPublication([statsPath]);
      markFirstPublishStarted();
      await firstPublishReleased;
      return publication;
    });
    const monitor = startUtoopackStatsMonitor({
      statsPaths: [statsPath],
      initialVersion,
      publish,
      onError() {},
    });

    try {
      await firstPublishStarted;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(publish).toHaveBeenCalledTimes(1);

      releaseFirstPublish();
      await monitor.ready;

      // Ten interval ticks become one dirty follow-up poll rather than ten
      // queued Promise continuations.
      expect(publish).toHaveBeenCalledTimes(1);
      expect(stat).toHaveBeenCalledTimes(4);
    } finally {
      releaseFirstPublish();
      await monitor.close();
      stat.mockRestore();
      vi.useRealTimers();
    }
  });
});

async function createChangedStatsFile(): Promise<{
  initialActivationVersion: string | undefined;
  initialVersion: string | undefined;
  statsPath: string;
}> {
  const directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "evjs-utoopack-stats-"),
  );
  temporaryDirectories.push(directory);
  const statsPath = path.join(directory, "stats.json");
  await fs.promises.writeFile(statsPath, "initial", "utf-8");
  const [initialVersion, initialActivationVersion] = await Promise.all([
    readUtoopackStatsSetVersion([statsPath]),
    readUtoopackStatsVersion(statsPath),
  ]);
  await fs.promises.writeFile(statsPath, "published-version", "utf-8");
  return { initialActivationVersion, initialVersion, statsPath };
}

async function readPublication(
  statsPaths: readonly string[],
  activationStatsPath?: string,
): Promise<{
  published: true;
  statsVersion: string | undefined;
  activationVersion: string | undefined;
}> {
  const [statsVersion, activationVersion] = await Promise.all([
    readUtoopackStatsSetVersion(statsPaths),
    activationStatsPath
      ? readUtoopackStatsVersion(activationStatsPath)
      : undefined,
  ]);
  return { published: true, statsVersion, activationVersion };
}

async function waitFor(
  condition: () => boolean,
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for the stats monitor.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
