import fs from "node:fs";
import path from "node:path";
import { getLogger } from "@logtape/logtape";
import type { execa } from "execa";

export type ApiProcess = ReturnType<typeof execa>;

export const API_READY_MARKER = "__EVJS_API_READY__";

const DEV_DIST_LOCK_FILE = ".evjs-dev.lock";
const MANIFEST_FILE = "manifest.json";
const logger = getLogger(["evjs", "ev"]);

interface DevDistLock {
  command: "dev";
  distDir: string;
  pid: number;
  startedAt: string;
}

function normalizeAssetName(name: string | undefined): string | undefined {
  return name?.replace(/^\.\//, "");
}

function getDevDistLockPath(cwd: string, distDir: string): string {
  return path.resolve(cwd, distDir, DEV_DIST_LOCK_FILE);
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readDevDistLock(
  cwd: string,
  distDir: string,
): Promise<DevDistLock | undefined> {
  const lockPath = getDevDistLockPath(cwd, distDir);
  try {
    return JSON.parse(
      await fs.promises.readFile(lockPath, "utf-8"),
    ) as DevDistLock;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    logger.warn`Failed to read dev dist lock: ${err}`;
    return undefined;
  }
}

export async function assertNoActiveDevDistLock(
  cwd: string,
  distDir: string,
): Promise<void> {
  const lock = await readDevDistLock(cwd, distDir);
  if (!lock) return;

  if (isProcessAlive(lock.pid)) {
    throw new Error(
      `[evjs] Cannot write to "${distDir}" because ev dev is using it in process ${lock.pid}. Stop ev dev first or run build in a separate workspace.`,
    );
  }

  await fs.promises.rm(getDevDistLockPath(cwd, distDir), { force: true });
}

export async function writeDevDistLock(
  cwd: string,
  distDir: string,
): Promise<() => Promise<void>> {
  const lockPath = getDevDistLockPath(cwd, distDir);
  await fs.promises.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.promises.writeFile(
    lockPath,
    JSON.stringify(
      {
        command: "dev",
        distDir,
        pid: process.pid,
        startedAt: new Date().toISOString(),
      } satisfies DevDistLock,
      null,
      2,
    ),
  );

  return async () => {
    const lock = await readDevDistLock(cwd, distDir);
    if (lock?.pid === process.pid) {
      await fs.promises.rm(lockPath, { force: true });
    }
  };
}

function readServerEntryFromManifest(
  cwd: string,
  distDir: string,
): string | undefined {
  const manifestPath = path.resolve(cwd, distDir, "server", MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) return undefined;

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
      entry?: unknown;
    };
    return normalizeAssetName(
      typeof manifest.entry === "string" ? manifest.entry : undefined,
    );
  } catch (err) {
    logger.warn`Failed to parse build manifest for server entry: ${err}`;
    return undefined;
  }
}

function readServerEntryFromStats(
  cwd: string,
  distDir: string,
): string | undefined {
  const statsPath = path.resolve(cwd, distDir, "server/stats.json");
  if (!fs.existsSync(statsPath)) return undefined;

  try {
    const stats = JSON.parse(fs.readFileSync(statsPath, "utf-8")) as {
      entrypoints?: Record<
        string,
        { assets?: Array<string | { name?: string }> }
      >;
    };
    const entrypoints = stats.entrypoints ?? {};
    const entrypointValues = Object.values(entrypoints);
    const firstEntry =
      entrypoints.server ??
      (entrypointValues.length === 1 ? entrypointValues[0] : undefined);
    const jsAsset = firstEntry?.assets?.find((asset) => {
      const assetName = readStatsAssetName(asset);
      return assetName ? isJavaScriptAsset(assetName) : false;
    });
    return normalizeAssetName(readStatsAssetName(jsAsset));
  } catch (err) {
    logger.warn`Failed to parse server stats.json: ${err}`;
    return undefined;
  }
}

function readStatsAssetName(
  asset: string | { name?: string } | undefined,
): string | undefined {
  return typeof asset === "string" ? asset : asset?.name;
}

function isJavaScriptAsset(name: string): boolean {
  return /\.(?:cjs|mjs|js)$/.test(name);
}

function isExistingDevServerEntry(
  cwd: string,
  distDir: string,
  entry: string,
): boolean {
  return fs.existsSync(path.resolve(cwd, distDir, "server", entry));
}

export async function findDevServerEntry(
  cwd: string,
  distDir: string,
): Promise<string | undefined> {
  const entryFromManifest = readServerEntryFromManifest(cwd, distDir);
  if (entryFromManifest) {
    return isExistingDevServerEntry(cwd, distDir, entryFromManifest)
      ? entryFromManifest
      : undefined;
  }

  const entryFromStats = readServerEntryFromStats(cwd, distDir);
  if (
    entryFromStats &&
    isExistingDevServerEntry(cwd, distDir, entryFromStats)
  ) {
    return entryFromStats;
  }

  const serverDir = path.resolve(cwd, distDir, "server");
  const files: string[] = await fs.promises.readdir(serverDir).catch(() => []);
  if (files.includes("server.cjs")) return "server.cjs";
  if (files.includes("server.js")) return "server.js";

  const jsFiles = files.filter(isJavaScriptAsset);
  return jsFiles.length === 1 ? jsFiles[0] : undefined;
}

export async function stopApiProcess(
  processToStop: ApiProcess,
  timeoutMs = 3000,
): Promise<void> {
  processToStop.kill();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const exited = await Promise.race([
      processToStop.then(() => true).catch(() => true),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);

    if (!exited) {
      processToStop.kill("SIGKILL");
      await processToStop.catch(() => {});
    }
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export function forwardApiOutput(child: ApiProcess): void {
  child.stdout?.on("data", (data) => {
    const text = data.toString().replaceAll(API_READY_MARKER, "");
    if (text.length > 0) {
      process.stdout.write(text);
    }
  });
  child.stderr?.on("data", (data) => {
    process.stderr.write(data);
  });
}

export function waitForApiReady(
  child: ApiProcess,
  timeoutMs = 10_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.stdout?.off("data", onStdout);
      child.stderr?.off("data", onStderr);
      child.off("exit", onExit);
      fn();
    };

    const onStdout = (data: Buffer) => {
      if (data.toString().includes(API_READY_MARKER)) {
        settle(resolve);
      }
    };
    const onStderr = (data: Buffer) => {
      if (data.toString().includes("EADDRINUSE")) {
        settle(() =>
          reject(new Error("API server port is already in use (EADDRINUSE)")),
        );
      }
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      settle(() =>
        reject(
          new Error(
            `API server exited before it was ready (code ${code ?? "null"}, signal ${signal ?? "null"})`,
          ),
        ),
      );
    };
    const timeout = setTimeout(() => {
      settle(() =>
        reject(
          new Error(`API server did not report ready within ${timeoutMs}ms`),
        ),
      );
    }, timeoutMs);

    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.once("exit", onExit);
  });
}
