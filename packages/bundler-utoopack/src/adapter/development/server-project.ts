import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import type { ConfigComplete, Project } from "@utoo/pack";
import type { MemoryEvictionMode } from "@utoo/pack/cjs/binding.js";
import { rejections } from "./rejections.js";
import { startUtoopackServerEndpointWatch } from "./server-endpoint-watch.js";

const require = createRequire(import.meta.url);

function cacheDirectory(config: ConfigComplete, scope: string): string {
  return path.join(config.cacheDirectory ?? ".turbopack", scope);
}

function privateOutput(cwd: string, scope: string): string {
  // Native canonicalizes projectPath, but not an absolute output path. Keep
  // scratch output relative so symlinked roots such as macOS /var stay inside it.
  return path.relative(
    cwd,
    path.resolve(cwd, ".turbopack/evjs/development", scope),
  );
}

/** Preserve client Server Function transforms while isolating their implicit output. */
export function createUtoopackClientDevConfig(
  config: ConfigComplete,
  cwd: string,
): ConfigComplete {
  if (!config.server) return config;
  const { entry: _entry, ...server } = config.server;
  return {
    ...config,
    cacheDirectory: cacheDirectory(config, "client"),
    server: {
      ...server,
      output: { ...server.output, path: privateOutput(cwd, "client-server") },
    },
  };
}

export async function startUtoopackServerProject(options: {
  cwd: string;
  config: ConfigComplete;
  onBuild(): Promise<void>;
  onError(error: unknown): void;
}): Promise<{
  ready: Promise<void>;
  failure: Promise<never>;
  close(): Promise<void>;
}> {
  // Runtime imports stay in the native-owner realm, after scheduler registration.
  const { projectFactory } =
    require("@utoo/pack/cjs/core/project.js") as typeof import("@utoo/pack/cjs/core/project.js");
  const { getPackPath } =
    require("@utoo/pack/cjs/utils/common.js") as typeof import("@utoo/pack/cjs/utils/common.js");
  const { findRootDir } =
    require("@utoo/pack/cjs/utils/findRoot.js") as typeof import("@utoo/pack/cjs/utils/findRoot.js");
  const { resolveCacheDirectory } =
    require("@utoo/pack/cjs/utils/cacheDirectory.js") as typeof import("@utoo/pack/cjs/utils/cacheDirectory.js");
  const { acquirePersistentCacheLock } =
    require("@utoo/pack/cjs/utils/lockfile.js") as typeof import("@utoo/pack/cjs/utils/lockfile.js");
  const {
    isPersistentCachingEnabled,
    normalizeTurbopackMemoryEviction,
    isTruthyEnv,
  } =
    require("@utoo/pack/cjs/utils/env.js") as typeof import("@utoo/pack/cjs/utils/env.js");
  const { useWorkerThreads } =
    require("@utoo/pack/cjs/utils/runtimePluginStratety.js") as typeof import("@utoo/pack/cjs/utils/runtimePluginStratety.js");
  const { config, cwd } = options;
  const persistentCaching = isPersistentCachingEnabled(
    config.persistentCaching,
  );
  const cache = resolveCacheDirectory(cwd, cacheDirectory(config, "server"));
  const lock = await acquirePersistentCacheLock(
    cache,
    "evjs server dev",
    persistentCaching,
  );
  let project: Project | undefined;
  let watch: ReturnType<typeof startUtoopackServerEndpointWatch> | undefined;
  let closePromise: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closePromise ??= (async () => {
      // Shutdown must run alongside iterator cancellation to unblock pending next().
      const errors = await rejections([
        watch?.close(),
        persistentCaching ? project?.shutdown() : project?.onExit(),
      ]);
      errors.push(...(await rejections([lock?.unlock()])));
      if (errors.length)
        throw new AggregateError(
          errors,
          "[evjs] Failed to close the Utoopack server Project.",
        );
    })();
    return closePromise;
  };
  try {
    project = await projectFactory()(
      {
        processEnv: {},
        watch: { enable: true },
        dev: true,
        buildId: randomUUID(),
        tracing: true,
        projectPath: cwd,
        rootPath: findRootDir(cwd),
        packPath: getPackPath(),
        config: {
          ...config,
          // App endpoints own server output, so keep their imports and direct
          // this Project's unused client assets away from the public directory.
          output: {
            ...config.output,
            path: privateOutput(cwd, "server-client"),
          },
          mode: "development",
          stats: true,
          optimization: {
            ...config.optimization,
            minify: false,
            moduleIds: "named",
          },
          persistentCaching,
          pluginRuntimeStrategy:
            config.pluginRuntimeStrategy ??
            (useWorkerThreads() ? "workerThreads" : "childProcesses"),
        },
      },
      {
        persistentCaching,
        cacheDirectory: cache,
        turbopackMemoryEviction: normalizeTurbopackMemoryEviction(
          config.turbopackMemoryEviction,
        ) as MemoryEvictionMode,
        smallPreallocation: isTruthyEnv(
          process.env.UTOO_TURBOPACK_SMALL_PREALLOCATION,
        ),
        turbopackGc: config.turbopackGc,
      },
    );
    watch = startUtoopackServerEndpointWatch(project, options);
    const ready = watch.ready.catch(async (error) => {
      await close();
      throw error;
    });
    void ready.catch(() => {});
    return { ready, failure: watch.failure, close };
  } catch (error) {
    await close();
    throw error;
  }
}
