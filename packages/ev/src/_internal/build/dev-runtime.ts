import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { assertPortableRelativeArtifactPath } from "@evjs/shared/manifest";
import { getLogger } from "@logtape/logtape";
import type { execa } from "execa";
import {
  removeOwnedOutputFile,
  removeOwnedOutputFileSync,
  writeOwnedOutputFile,
} from "./owned-file-output.js";
import { isInsideCwd } from "./utils.js";

export type ApiProcess = ReturnType<typeof execa>;

export const API_READY_MARKER = "__EVJS_API_READY__";

const DEV_DIST_LOCK_FILE = ".evjs-dev.lock";
const DEV_RUNTIME_DIR = `evjs-dev-${typeof process.getuid === "function" ? process.getuid() : "user"}`;
const DEV_RUNTIME_LOCK_OWNER_FILE = "owner.json";
const DEV_RUNTIME_LOCK_SETTLE_MS = 1_000;
const DEV_RUNTIME_PRIVATE_MODE = 0o700;
const DEV_PORT_SCAN_LIMIT = 1_000;
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

export type ProjectOperation = "build" | "dev" | "prepare";

interface ProjectOperationLock extends DevRuntimeLock {
  operation: ProjectOperation;
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
  let temporaryDirectory: string;
  try {
    temporaryDirectory = fs.realpathSync(os.tmpdir());
  } catch {
    temporaryDirectory = path.resolve(os.tmpdir());
  }
  return path.join(temporaryDirectory, DEV_RUNTIME_DIR, ...segments);
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

function getProjectOperationLockPath(cwd: string): string {
  const key = createHash("sha256").update(cwd).digest("hex");
  return getDevRuntimePath("operations", `${key}.lock`);
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

function getCurrentUid(): number | undefined {
  return typeof process.getuid === "function" ? process.getuid() : undefined;
}

function isAlreadyExistsError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "EEXIST" || code === "ENOTEMPTY";
}

function isMissingPathError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

function describeRuntimePath(runtimePath: string): string {
  return JSON.stringify(runtimePath);
}

function assertRuntimeDirectoryStats(
  runtimePath: string,
  stats: fs.Stats,
): void {
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(
      `[evjs] Dev runtime directory ${describeRuntimePath(runtimePath)} must be a real directory, not a symbolic link or another file type.`,
    );
  }

  const uid = getCurrentUid();
  if (uid !== undefined && stats.uid !== uid) {
    throw new Error(
      `[evjs] Dev runtime directory ${describeRuntimePath(runtimePath)} must be owned by the current user (uid ${uid}).`,
    );
  }

  if (process.platform !== "win32" && (stats.mode & 0o022) !== 0) {
    throw new Error(
      `[evjs] Dev runtime directory ${describeRuntimePath(runtimePath)} must not be writable by group or other users.`,
    );
  }

  if (process.platform !== "win32" && (stats.mode & 0o077) !== 0) {
    throw new Error(
      `[evjs] Dev runtime directory ${describeRuntimePath(runtimePath)} must use private permissions (0700).`,
    );
  }
}

function getPathAncestors(absolutePath: string): string[] {
  const ancestors: string[] = [];
  let current = path.resolve(absolutePath);
  while (true) {
    ancestors.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return ancestors.reverse();
}

async function assertTrustedTemporaryDirectory(
  temporaryDirectory: string,
): Promise<void> {
  for (const ancestor of getPathAncestors(temporaryDirectory)) {
    assertTrustedTemporaryDirectoryAncestor(
      temporaryDirectory,
      await fs.promises.lstat(ancestor),
    );
  }
}

function assertTrustedTemporaryDirectoryAncestor(
  temporaryDirectory: string,
  stats: fs.Stats,
): void {
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(
      `[evjs] Dev runtime temporary path ${describeRuntimePath(temporaryDirectory)} must not traverse symbolic links or non-directory ancestors.`,
    );
  }

  const uid = getCurrentUid();
  if (uid !== undefined && stats.uid !== 0 && stats.uid !== uid) {
    throw new Error(
      `[evjs] Dev runtime temporary path ${describeRuntimePath(temporaryDirectory)} has an ancestor that is not owned by root or the current user.`,
    );
  }

  if (process.platform === "win32" || (stats.mode & 0o022) === 0) return;

  const isRootOwnedStickyDirectory =
    uid !== undefined && stats.uid === 0 && (stats.mode & 0o1000) !== 0;
  if (!isRootOwnedStickyDirectory) {
    throw new Error(
      `[evjs] Dev runtime temporary path ${describeRuntimePath(temporaryDirectory)} must not traverse an untrusted writable ancestor.`,
    );
  }
}

async function ensurePrivateRuntimeDirectory(
  runtimePath: string,
): Promise<void> {
  try {
    await fs.promises.mkdir(runtimePath, { mode: DEV_RUNTIME_PRIVATE_MODE });
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
  }

  const stats = await fs.promises.lstat(runtimePath);
  if (
    process.platform !== "win32" &&
    stats.isDirectory() &&
    !stats.isSymbolicLink() &&
    stats.uid === getCurrentUid() &&
    (stats.mode & 0o022) === 0 &&
    (stats.mode & 0o077) !== 0
  ) {
    // Tighten a trusted user-owned directory whose extra permissions are
    // read/execute-only.
    await fs.promises.chmod(runtimePath, DEV_RUNTIME_PRIVATE_MODE);
  }
  assertRuntimeDirectoryStats(
    runtimePath,
    await fs.promises.lstat(runtimePath),
  );
}

async function ensureRuntimeLockParent(lockPath: string): Promise<void> {
  const lockParent = path.dirname(lockPath);
  const runtimeRoot = path.dirname(lockParent);
  const temporaryDirectory = path.dirname(runtimeRoot);
  if (
    path.basename(runtimeRoot) !== DEV_RUNTIME_DIR ||
    !["operations", "ports", "sessions"].includes(path.basename(lockParent))
  ) {
    throw new Error(
      `[evjs] Invalid internal dev runtime lock path ${describeRuntimePath(lockPath)}.`,
    );
  }

  await assertTrustedTemporaryDirectory(temporaryDirectory);
  await ensurePrivateRuntimeDirectory(runtimeRoot);
  await ensurePrivateRuntimeDirectory(lockParent);
}

function assertRuntimeLockParentSync(lockPath: string): void {
  const lockParent = path.dirname(lockPath);
  const runtimeRoot = path.dirname(lockParent);
  const temporaryDirectory = path.dirname(runtimeRoot);
  if (
    path.basename(runtimeRoot) !== DEV_RUNTIME_DIR ||
    !["operations", "ports", "sessions"].includes(path.basename(lockParent))
  ) {
    throw new Error(
      `[evjs] Invalid internal dev runtime lock path ${describeRuntimePath(lockPath)}.`,
    );
  }

  for (const ancestor of getPathAncestors(temporaryDirectory)) {
    assertTrustedTemporaryDirectoryAncestor(
      temporaryDirectory,
      fs.lstatSync(ancestor),
    );
  }
  assertRuntimeDirectoryStats(runtimeRoot, fs.lstatSync(runtimeRoot));
  assertRuntimeDirectoryStats(lockParent, fs.lstatSync(lockParent));
}

function assertRuntimeLockDirectory(lockPath: string, stats: fs.Stats): void {
  assertRuntimeDirectoryStats(lockPath, stats);
}

async function readRuntimeLock<T extends DevRuntimeLock>(
  lockPath: string,
): Promise<T | undefined> {
  try {
    assertRuntimeLockDirectory(lockPath, await fs.promises.lstat(lockPath));
    const lock = JSON.parse(
      await fs.promises.readFile(
        path.join(lockPath, DEV_RUNTIME_LOCK_OWNER_FILE),
        "utf-8",
      ),
    ) as unknown;
    return isDevRuntimeLock(lock) ? (lock as T) : undefined;
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

function isDevRuntimeLock(value: unknown): value is DevRuntimeLock {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<DevRuntimeLock>;
  return (
    typeof candidate.cwd === "string" &&
    typeof candidate.pid === "number" &&
    typeof candidate.startedAt === "string" &&
    typeof candidate.token === "string"
  );
}

async function writeRuntimeLock(
  lockPath: string,
  lock: DevRuntimeLock,
): Promise<boolean> {
  await ensureRuntimeLockParent(lockPath);
  const quarantined = await reconcileQuarantinedRuntimeLocks(lockPath);
  if (quarantined.some((candidate) => candidate.token !== lock.token)) {
    return false;
  }

  const candidatePath = `${lockPath}.candidate-${process.pid}-${randomUUID()}`;
  try {
    await fs.promises.mkdir(candidatePath, { mode: DEV_RUNTIME_PRIVATE_MODE });
    await fs.promises.writeFile(
      path.join(candidatePath, DEV_RUNTIME_LOCK_OWNER_FILE),
      `${JSON.stringify(lock, null, 2)}\n`,
      { encoding: "utf-8", flag: "wx", mode: 0o600 },
    );
    try {
      await fs.promises.rename(candidatePath, lockPath);
    } catch (error) {
      if (isAlreadyExistsError(error)) return false;
      throw error;
    }

    const conflicts = await reconcileQuarantinedRuntimeLocks(lockPath);
    if (conflicts.some((candidate) => candidate.token !== lock.token)) {
      await removeRuntimeLock(lockPath, lock.token);
      return false;
    }
    return true;
  } finally {
    await fs.promises.rm(candidatePath, { recursive: true, force: true });
  }
}

function getRuntimeLockQuarantinePrefix(lockPath: string): string {
  return `${path.basename(lockPath)}.quarantine-`;
}

function getRuntimeLockTokenKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createRuntimeLockQuarantinePath(
  lockPath: string,
  expectedToken?: string,
): string {
  const intent =
    expectedToken === undefined
      ? "abandoned"
      : getRuntimeLockTokenKey(expectedToken);
  return `${lockPath}.quarantine-${intent}-${process.pid}-${randomUUID()}`;
}

function getQuarantinedRuntimeLockIntent(
  lockPath: string,
  quarantinedPath: string,
): string | undefined {
  const prefix = getRuntimeLockQuarantinePrefix(lockPath);
  const name = path.basename(quarantinedPath);
  if (!name.startsWith(prefix)) return undefined;
  const [intent] = name.slice(prefix.length).split("-");
  return intent || undefined;
}

async function listQuarantinedRuntimeLocks(
  lockPath: string,
): Promise<string[]> {
  const parent = path.dirname(lockPath);
  const prefix = getRuntimeLockQuarantinePrefix(lockPath);
  const entries = await fs.promises.readdir(parent, { withFileTypes: true });
  return entries
    .filter((entry) => entry.name.startsWith(prefix))
    .map((entry) => path.join(parent, entry.name));
}

async function restoreQuarantinedRuntimeLock(
  quarantinedPath: string,
  lockPath: string,
): Promise<boolean> {
  try {
    await fs.promises.rename(quarantinedPath, lockPath);
    return true;
  } catch (error) {
    if (isAlreadyExistsError(error) || isMissingPathError(error)) return false;
    throw error;
  }
}

async function removeUniqueRuntimeLockPath(lockPath: string): Promise<void> {
  await fs.promises.rm(lockPath, { recursive: true, force: true });
}

async function reconcileQuarantinedRuntimeLocks<T extends DevRuntimeLock>(
  lockPath: string,
): Promise<T[]> {
  const activeLocks: T[] = [];
  for (const quarantinedPath of await listQuarantinedRuntimeLocks(lockPath)) {
    const lock = await readRuntimeLock<T>(quarantinedPath);
    const intent = getQuarantinedRuntimeLockIntent(lockPath, quarantinedPath);
    if (lock && intent === getRuntimeLockTokenKey(lock.token)) {
      // The owner token was verified by the process that atomically moved this
      // exact lock. Its unique quarantine can be completed by any contender.
      await removeUniqueRuntimeLockPath(quarantinedPath);
      continue;
    }
    if (lock && isProcessAlive(lock.pid)) {
      activeLocks.push(lock);
      await restoreQuarantinedRuntimeLock(quarantinedPath, lockPath);
      continue;
    }

    let oldEnoughToRemove = Boolean(lock);
    if (!lock) {
      try {
        const stats = await fs.promises.lstat(quarantinedPath);
        assertRuntimeLockDirectory(quarantinedPath, stats);
        oldEnoughToRemove =
          Date.now() - stats.mtimeMs >= DEV_RUNTIME_LOCK_SETTLE_MS;
      } catch (error) {
        if (isMissingPathError(error)) continue;
        throw error;
      }
    }
    if (oldEnoughToRemove) {
      await removeUniqueRuntimeLockPath(quarantinedPath);
    }
  }
  return activeLocks;
}

async function readSettledRuntimeLock<T extends DevRuntimeLock>(
  lockPath: string,
): Promise<T | undefined> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const quarantined = await reconcileQuarantinedRuntimeLocks<T>(lockPath);
    const lock = await readRuntimeLock<T>(lockPath);
    if (lock) return lock;
    if (quarantined[0]) return quarantined[0];
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return undefined;
}

async function removeRuntimeLock(
  lockPath: string,
  expectedToken: string,
): Promise<boolean> {
  await ensureRuntimeLockParent(lockPath);
  const quarantinedPath = createRuntimeLockQuarantinePath(
    lockPath,
    expectedToken,
  );
  try {
    await fs.promises.rename(lockPath, quarantinedPath);
  } catch (err) {
    if (isMissingPathError(err)) return false;
    throw err;
  }

  const lock = await readRuntimeLock(quarantinedPath);
  if (lock?.token !== expectedToken) {
    await restoreQuarantinedRuntimeLock(quarantinedPath, lockPath);
    return false;
  }
  await removeUniqueRuntimeLockPath(quarantinedPath);
  return true;
}

function removeRuntimeLockSync(lockPath: string, expectedToken: string): void {
  const quarantinedPath = createRuntimeLockQuarantinePath(
    lockPath,
    expectedToken,
  );
  try {
    assertRuntimeLockParentSync(lockPath);
    fs.renameSync(lockPath, quarantinedPath);
    const lock = JSON.parse(
      fs.readFileSync(
        path.join(quarantinedPath, DEV_RUNTIME_LOCK_OWNER_FILE),
        "utf-8",
      ),
    ) as DevRuntimeLock;
    if (lock.token === expectedToken) {
      fs.rmSync(quarantinedPath, { recursive: true, force: true });
      return;
    }
    try {
      fs.renameSync(quarantinedPath, lockPath);
    } catch (error) {
      if (!isAlreadyExistsError(error) && !isMissingPathError(error)) {
        throw error;
      }
    }
  } catch {
    // A crashed or externally modified lock is recovered on the next startup.
  }
}

async function removeAbandonedRuntimeLock(lockPath: string): Promise<boolean> {
  await ensureRuntimeLockParent(lockPath);
  try {
    const stats = await fs.promises.lstat(lockPath);
    assertRuntimeLockDirectory(lockPath, stats);
    if (Date.now() - stats.mtimeMs < DEV_RUNTIME_LOCK_SETTLE_MS) return false;
  } catch (err) {
    if (isMissingPathError(err)) return true;
    throw err;
  }

  const quarantinedPath = createRuntimeLockQuarantinePath(lockPath);
  try {
    await fs.promises.rename(lockPath, quarantinedPath);
  } catch (error) {
    if (isMissingPathError(error)) return true;
    throw error;
  }

  const lock = await readRuntimeLock(quarantinedPath);
  if (lock && isProcessAlive(lock.pid)) {
    await restoreQuarantinedRuntimeLock(quarantinedPath, lockPath);
    return false;
  }
  await removeUniqueRuntimeLockPath(quarantinedPath);
  return true;
}

async function runtimeLockExists(lockPath: string): Promise<boolean> {
  await ensureRuntimeLockParent(lockPath);
  if ((await reconcileQuarantinedRuntimeLocks(lockPath)).length > 0) {
    return true;
  }
  try {
    await fs.promises.lstat(lockPath);
    return true;
  } catch (err) {
    if (isMissingPathError(err)) return false;
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

async function acquireRuntimeLock<T extends DevRuntimeLock>(options: {
  activeError(lock: T): Error;
  initializingError(): Error;
  lock: T;
  lockPath: string;
  unavailableError(): Error;
}): Promise<DevRuntimeRelease> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await writeRuntimeLock(options.lockPath, options.lock)) {
      return createRuntimeLockRelease(options.lockPath, options.lock.token);
    }

    const activeLock = await readSettledRuntimeLock<T>(options.lockPath);
    if (activeLock && isProcessAlive(activeLock.pid)) {
      throw options.activeError(activeLock);
    }
    if (activeLock) {
      await removeRuntimeLock(options.lockPath, activeLock.token);
      continue;
    }
    if (await removeAbandonedRuntimeLock(options.lockPath)) continue;
    throw options.initializingError();
  }

  throw options.unavailableError();
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
  return acquireRuntimeLock({
    activeError: (activeLock) =>
      new Error(
        `[evjs] Dev is already running for "${normalizedCwd}" in process ${activeLock.pid} (started ${activeLock.startedAt}). Stop that process before starting another dev session for the same app.`,
      ),
    initializingError: () =>
      new Error(
        `[evjs] Another dev session is initializing for "${normalizedCwd}". Wait for it to finish starting or stop that process before trying again.`,
      ),
    lock,
    lockPath,
    unavailableError: () =>
      new Error(
        `[evjs] Unable to acquire the dev session lock for "${normalizedCwd}". Try starting ev dev again.`,
      ),
  });
}

export async function acquireProjectOperationLock(
  cwd: string,
  operation: ProjectOperation,
): Promise<DevRuntimeRelease> {
  const normalizedCwd = await normalizeProjectPath(cwd);
  const lockPath = getProjectOperationLockPath(normalizedCwd);
  const lock: ProjectOperationLock = {
    cwd: normalizedCwd,
    operation,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    token: randomUUID(),
  };
  return acquireRuntimeLock<ProjectOperationLock>({
    activeError: (activeLock) =>
      new Error(
        `[evjs] Cannot start ${operation} for "${normalizedCwd}" because ${activeLock.operation} is already running in process ${activeLock.pid} (started ${activeLock.startedAt}). Wait for it to finish or stop that process before trying again.`,
      ),
    initializingError: () =>
      new Error(
        `[evjs] Another project operation is initializing for "${normalizedCwd}". Wait for it to finish or stop that process before starting ${operation}.`,
      ),
    lock,
    lockPath,
    unavailableError: () =>
      new Error(
        `[evjs] Unable to acquire the ${operation} operation lock for "${normalizedCwd}". Try starting ${operation} again.`,
      ),
  });
}

export async function assertNoActiveDevSessionLock(cwd: string): Promise<void> {
  const normalizedCwd = await normalizeProjectPath(cwd);
  const lockPath = getDevSessionLockPath(normalizedCwd);
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!(await runtimeLockExists(lockPath))) return;
    const lock = await readSettledRuntimeLock(lockPath);
    if (!lock) {
      if (await removeAbandonedRuntimeLock(lockPath)) continue;
      throw new Error(
        `[evjs] Cannot build "${normalizedCwd}" while an ev dev session is initializing. Stop ev dev first or build in a separate workspace.`,
      );
    }

    if (isProcessAlive(lock.pid)) {
      throw new Error(
        `[evjs] Cannot build "${normalizedCwd}" because ev dev is running in process ${lock.pid}. Stop ev dev first or build in a separate workspace.`,
      );
    }
    if (await removeRuntimeLock(lockPath, lock.token)) return;
  }

  throw new Error(
    `[evjs] Cannot build "${normalizedCwd}" because its dev session lock changed while being checked. Stop ev dev first or build in a separate workspace.`,
  );
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

  await removeOwnedOutputFile(
    cwd,
    getDevDistLockPath(cwd, distDir),
    "Stale dev dist lock output",
  );
}

export async function writeDevDistLock(
  cwd: string,
  distDir: string,
): Promise<DevRuntimeRelease> {
  const lockPath = getDevDistLockPath(cwd, distDir);
  await writeOwnedOutputFile(
    cwd,
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
    "Dev dist lock output",
  );

  const release = async () => {
    const lock = await readDevDistLock(cwd, distDir);
    if (lock?.pid === process.pid) {
      await removeOwnedOutputFile(cwd, lockPath, "Dev dist lock output");
    }
  };
  release.sync = () => {
    try {
      const lock = JSON.parse(
        fs.readFileSync(lockPath, "utf-8"),
      ) as DevDistLock;
      if (lock.pid === process.pid) {
        removeOwnedOutputFileSync(cwd, lockPath, "Dev dist lock output");
      }
    } catch {
      // Stale or externally modified locks are recovered on the next startup.
    }
  };
  return release;
}

function isJavaScriptAsset(name: string): boolean {
  return /\.(?:cjs|mjs|js)$/.test(name);
}

function resolveExistingDevServerBundlePath(
  cwd: string,
  serverOutputDir: string,
  entry: string,
): string | undefined {
  const serverDir = path.resolve(cwd, serverOutputDir);
  const bundlePath = path.resolve(serverDir, entry);
  if (!isInsideCwd(serverDir, bundlePath) || bundlePath === serverDir) {
    return undefined;
  }
  return fs.existsSync(bundlePath) ? bundlePath : undefined;
}

export async function findDevServerBundlePath(
  cwd: string,
  serverOutputDir: string,
  serverEntry: string | undefined,
): Promise<string | undefined> {
  if (serverEntry === undefined) return undefined;
  const entry = assertPortableRelativeArtifactPath(
    normalizeAssetName(serverEntry) ?? "",
    "Development server entry",
  );
  if (!isJavaScriptAsset(entry)) {
    throw new Error(
      `[evjs] Development server entry ${JSON.stringify(entry)} must be a JavaScript asset.`,
    );
  }
  const bundlePath = resolveExistingDevServerBundlePath(
    cwd,
    serverOutputDir,
    entry,
  );
  if (!bundlePath) {
    throw new Error(
      `[evjs] Development server entry ${JSON.stringify(entry)} was not emitted under ${JSON.stringify(serverOutputDir)}.`,
    );
  }
  return bundlePath;
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
