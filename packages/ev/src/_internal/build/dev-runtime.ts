import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { getLogger } from "@logtape/logtape";
import type { execa } from "execa";

export type ApiProcess = ReturnType<typeof execa>;

export const API_READY_MARKER = "__EVJS_API_READY__";

const DEV_DIST_LOCK_FILE = ".evjs-dev.lock";
const DEV_RUNTIME_DIR = `evjs-dev-${typeof process.getuid === "function" ? process.getuid() : "user"}`;
const DEV_PORT_SCAN_LIMIT = 1_000;
const MANIFEST_FILE = "manifest.json";
const logger = getLogger(["evjs", "ev"]);

interface DevDistLock {
  command: "dev";
  distDir: string;
  pid: number;
  startedAt: string;
}

interface DevRuntimeLock {
  cwd: string;
  pid: number;
  startedAt: string;
  token: string;
}

interface DevPortLock extends DevRuntimeLock {
  port: number;
  role: "client" | "server";
}

export interface DevPortReservation {
  client: {
    requestedPort: number;
    port: number;
  };
  server: {
    requestedPort: number;
    port: number;
  };
  release(): Promise<void>;
  releaseSync(): void;
}

export interface DevRuntimeRelease {
  (): Promise<void>;
  sync(): void;
}

function normalizeAssetName(name: string | undefined): string | undefined {
  return name?.replace(/^\.\//, "");
}

function getDevDistLockPath(cwd: string, distDir: string): string {
  return path.resolve(cwd, distDir, DEV_DIST_LOCK_FILE);
}

function getDevRuntimePath(...segments: string[]): string {
  return path.join(os.tmpdir(), DEV_RUNTIME_DIR, ...segments);
}

async function normalizeProjectPath(cwd: string): Promise<string> {
  try {
    return await fs.promises.realpath(cwd);
  } catch {
    return path.resolve(cwd);
  }
}

function getDevSessionLockPath(cwd: string): string {
  const key = createHash("sha256").update(cwd).digest("hex");
  return getDevRuntimePath("sessions", `${key}.lock`);
}

function getDevPortLockPath(port: number): string {
  return getDevRuntimePath("ports", `${port}.lock`);
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

async function readRuntimeLock<T extends DevRuntimeLock>(
  lockPath: string,
): Promise<T | undefined> {
  try {
    return JSON.parse(
      await fs.promises.readFile(path.join(lockPath, "owner.json"), "utf-8"),
    ) as T;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (
      code === "ENOENT" ||
      code === "EACCES" ||
      code === "EPERM" ||
      err instanceof SyntaxError
    ) {
      return undefined;
    }
    throw err;
  }
}

async function writeRuntimeLock(
  lockPath: string,
  lock: DevRuntimeLock,
): Promise<boolean> {
  await fs.promises.mkdir(path.dirname(lockPath), { recursive: true });

  try {
    await fs.promises.mkdir(lockPath, { mode: 0o700 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }

  try {
    await fs.promises.writeFile(
      path.join(lockPath, "owner.json"),
      `${JSON.stringify(lock, null, 2)}\n`,
      { encoding: "utf-8", mode: 0o600 },
    );
    return true;
  } catch (err) {
    await fs.promises.rm(lockPath, { recursive: true, force: true });
    throw err;
  }
}

async function readSettledRuntimeLock<T extends DevRuntimeLock>(
  lockPath: string,
): Promise<T | undefined> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const lock = await readRuntimeLock<T>(lockPath);
    if (lock) return lock;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return undefined;
}

async function removeRuntimeLock(
  lockPath: string,
  expectedToken?: string,
): Promise<boolean> {
  if (expectedToken !== undefined) {
    const lock = await readRuntimeLock(lockPath);
    if (lock?.token !== expectedToken) return false;
  }

  const stalePath = `${lockPath}.stale-${process.pid}-${randomUUID()}`;
  try {
    await fs.promises.rename(lockPath, stalePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
  await fs.promises.rm(stalePath, { recursive: true, force: true });
  return true;
}

function removeRuntimeLockSync(lockPath: string, expectedToken: string): void {
  try {
    const lock = JSON.parse(
      fs.readFileSync(path.join(lockPath, "owner.json"), "utf-8"),
    ) as DevRuntimeLock;
    if (lock.token !== expectedToken) return;

    const stalePath = `${lockPath}.stale-${process.pid}-${randomUUID()}`;
    fs.renameSync(lockPath, stalePath);
    fs.rmSync(stalePath, { recursive: true, force: true });
  } catch {
    // A crashed or externally modified lock is recovered on the next startup.
  }
}

async function removeAbandonedRuntimeLock(lockPath: string): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(lockPath);
    if (Date.now() - stat.mtimeMs < 1_000) return false;
    return removeRuntimeLock(lockPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw err;
  }
}

async function runtimeLockExists(lockPath: string): Promise<boolean> {
  try {
    await fs.promises.access(lockPath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

function createRuntimeLockRelease(
  lockPath: string,
  token: string,
): DevRuntimeRelease {
  const release = async () => {
    await removeRuntimeLock(lockPath, token);
  };
  release.sync = () => {
    removeRuntimeLockSync(lockPath, token);
  };
  return release;
}

export async function acquireDevSessionLock(
  cwd: string,
): Promise<DevRuntimeRelease> {
  const normalizedCwd = await normalizeProjectPath(cwd);
  const lockPath = getDevSessionLockPath(normalizedCwd);
  const lock: DevRuntimeLock = {
    cwd: normalizedCwd,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    token: randomUUID(),
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    if (await writeRuntimeLock(lockPath, lock)) {
      return createRuntimeLockRelease(lockPath, lock.token);
    }

    const activeLock = await readSettledRuntimeLock(lockPath);
    if (activeLock && isProcessAlive(activeLock.pid)) {
      throw new Error(
        `[evjs] Dev is already running for "${normalizedCwd}" in process ${activeLock.pid} (started ${activeLock.startedAt}). Stop that process before starting another dev session for the same app.`,
      );
    }
    if (activeLock) {
      await removeRuntimeLock(lockPath, activeLock.token);
      continue;
    }
    if (await removeAbandonedRuntimeLock(lockPath)) continue;
    throw new Error(
      `[evjs] Another dev session is initializing for "${normalizedCwd}". Wait for it to finish starting or stop that process before trying again.`,
    );
  }

  throw new Error(
    `[evjs] Unable to acquire the dev session lock for "${normalizedCwd}". Try starting ev dev again.`,
  );
}

export async function assertNoActiveDevSessionLock(cwd: string): Promise<void> {
  const normalizedCwd = await normalizeProjectPath(cwd);
  const lockPath = getDevSessionLockPath(normalizedCwd);
  if (!(await runtimeLockExists(lockPath))) return;
  const lock = await readSettledRuntimeLock(lockPath);
  if (!lock) {
    if (await removeAbandonedRuntimeLock(lockPath)) return;
    throw new Error(
      `[evjs] Cannot build "${normalizedCwd}" while an ev dev session is initializing. Stop ev dev first or build in a separate workspace.`,
    );
  }

  if (isProcessAlive(lock.pid)) {
    throw new Error(
      `[evjs] Cannot build "${normalizedCwd}" because ev dev is running in process ${lock.pid}. Stop ev dev first or build in a separate workspace.`,
    );
  }
  await removeRuntimeLock(lockPath, lock.token);
}

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" || err.code === "EACCES") {
        resolve(false);
        return;
      }
      reject(err);
    });
    server.listen({ port, exclusive: true }, () => {
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(true);
      });
    });
  });
}

function getPortCandidate(preferredPort: number, offset: number): number {
  const candidate = preferredPort + offset;
  if (candidate <= 65_535) return candidate;
  return 1_024 + ((candidate - 65_536) % (65_535 - 1_024 + 1));
}

async function reserveAvailablePort(options: {
  cwd: string;
  excludedPorts: ReadonlySet<number>;
  preferredPort: number;
  role: DevPortLock["role"];
}): Promise<{ port: number; release: DevRuntimeRelease }> {
  for (let offset = 0; offset < DEV_PORT_SCAN_LIMIT; offset++) {
    const port = getPortCandidate(options.preferredPort, offset);
    if (options.excludedPorts.has(port)) continue;

    const lockPath = getDevPortLockPath(port);
    const lock: DevPortLock = {
      cwd: options.cwd,
      pid: process.pid,
      port,
      role: options.role,
      startedAt: new Date().toISOString(),
      token: randomUUID(),
    };

    if (!(await writeRuntimeLock(lockPath, lock))) {
      const activeLock = await readSettledRuntimeLock<DevPortLock>(lockPath);
      if (activeLock && isProcessAlive(activeLock.pid)) continue;
      if (activeLock) {
        await removeRuntimeLock(lockPath, activeLock.token);
        offset--;
        continue;
      }
      if (await removeAbandonedRuntimeLock(lockPath)) offset--;
      continue;
    }

    const release = createRuntimeLockRelease(lockPath, lock.token);
    if (await isPortAvailable(port)) return { port, release };
    await release();
  }

  throw new Error(
    `[evjs] Unable to find an available ${options.role} dev port near ${options.preferredPort}. Configure a different port and try again.`,
  );
}

export async function reserveDevPorts(
  cwd: string,
  requestedClientPort: number,
  requestedServerPort: number,
): Promise<DevPortReservation> {
  const normalizedCwd = await normalizeProjectPath(cwd);
  const client = await reserveAvailablePort({
    cwd: normalizedCwd,
    excludedPorts: new Set(
      requestedClientPort === requestedServerPort ? [] : [requestedServerPort],
    ),
    preferredPort: requestedClientPort,
    role: "client",
  });

  try {
    const server = await reserveAvailablePort({
      cwd: normalizedCwd,
      excludedPorts: new Set([client.port]),
      preferredPort: requestedServerPort,
      role: "server",
    });
    return {
      client: {
        requestedPort: requestedClientPort,
        port: client.port,
      },
      server: {
        requestedPort: requestedServerPort,
        port: server.port,
      },
      async release() {
        await Promise.all([client.release(), server.release()]);
      },
      releaseSync() {
        client.release.sync();
        server.release.sync();
      },
    };
  } catch (err) {
    await client.release();
    throw err;
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
): Promise<DevRuntimeRelease> {
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

  const release = async () => {
    const lock = await readDevDistLock(cwd, distDir);
    if (lock?.pid === process.pid) {
      await fs.promises.rm(lockPath, { force: true });
    }
  };
  release.sync = () => {
    try {
      const lock = JSON.parse(
        fs.readFileSync(lockPath, "utf-8"),
      ) as DevDistLock;
      if (lock.pid === process.pid) fs.rmSync(lockPath, { force: true });
    } catch {
      // Stale or externally modified locks are recovered on the next startup.
    }
  };
  return release;
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
