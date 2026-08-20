import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { BuildPlan, CoreGraph } from "@evjs/shared/manifest";
import { getLogger } from "@logtape/logtape";
import { execa } from "execa";
import type { ResolvedFrameworkConfig } from "../../../config/index.js";
import type { PluginSetupContext } from "../../../plugin/index.js";
import type {
  BundlerAdapter,
  BundlerDevController,
} from "../bundler/contracts.js";
import {
  preflightBundlerBuild,
  preflightBundlerDev,
} from "../bundler/contracts.js";
import { createBuildResult } from "../output/build-result.js";
import {
  createFrameworkOutputSnapshot,
  linkAndEmitBuildOutput,
} from "../output/framework-output.js";
import {
  type createFrameworkRuntime,
  serializeFrameworkRuntimeExpression,
} from "../output/framework-runtime.js";
import {
  collectClientDevMiddlewares,
  collectPluginHooks,
  rethrowAfterCleanup,
  runAfterBuildHooks,
  runDevServerReadyHooks,
  runDisposeHooks,
} from "../plugins/lifecycle.js";
import { DevApiProcessController } from "./api-process.js";
import {
  API_READY_MARKER,
  type ApiProcess,
  type DevRuntimeRelease,
  findDevServerBundlePath,
  forwardApiOutput,
  stopApiProcess,
  waitForApiReady,
  writeDevDistLock,
} from "./runtime.js";

const logger = getLogger(["evjs", "ev"]);
const DEV_PAGE_RENDER_PROXY_HEADER = "x-evjs-dev-page-render";

type MutablePluginSetupContext<TBundlerCfg> = Omit<
  PluginSetupContext<TBundlerCfg>,
  "config"
> & {
  config: ResolvedFrameworkConfig<TBundlerCfg>;
};

export interface StartDevSessionOptions<TBundlerCfg> {
  readonly bundler: BundlerAdapter<TBundlerCfg>;
  readonly config: ResolvedFrameworkConfig<TBundlerCfg>;
  readonly cwd: string;
  readonly flags?: PluginSetupContext<TBundlerCfg>["flags"];
  readonly graph: CoreGraph;
  readonly plan: BuildPlan;
  readonly registerExitCleanup: (cleanup: () => void) => () => void;
  readonly registerWatchFile: (file: string) => void;
}

export interface DevSession {
  readonly done: Promise<void>;
  readonly origin: string;
  /** Notify this active Session's plugins that its client listener is ready. */
  activate(): Promise<void>;
  close(): Promise<void>;
}

interface DevApiRuntimeState<TBundlerCfg> {
  readonly config: ResolvedFrameworkConfig<TBundlerCfg>;
  readonly frameworkRuntime:
    | ReturnType<typeof createFrameworkRuntime>
    | undefined;
  readonly plan: BuildPlan;
  readonly serverEntry: string | undefined;
}

/**
 * Start one immutable development session. Config, graph, plan, plugin hooks,
 * and bundler inputs never change after this function begins.
 */
export async function startDevSession<TBundlerCfg>(
  options: StartDevSessionOptions<TBundlerCfg>,
): Promise<DevSession> {
  const abortController = new AbortController();
  let closing = false;
  let closed = false;
  let closePromise: Promise<void> | undefined;
  let outputQueue: Promise<void> = Promise.resolve();
  let apiQueue: Promise<void> = Promise.resolve();
  let frameworkRuntime: ReturnType<typeof createFrameworkRuntime> | undefined;
  let serverEntry: string | undefined;
  let controller: BundlerDevController | undefined;
  let releaseDistLock: DevRuntimeRelease | undefined;
  let unregisterDistExitCleanup = () => {};
  let pluginContextRetired = false;
  let activationPromise: Promise<void> | undefined;

  const pluginContext: MutablePluginSetupContext<TBundlerCfg> = {
    mode: "development",
    cwd: options.cwd,
    config: options.config,
    flags: options.flags,
    logger,
    addWatchFile(file) {
      if (pluginContextRetired || closing) return;
      options.registerWatchFile(path.resolve(options.cwd, file));
    },
  };

  const hooks = await collectPluginHooks(
    options.config.plugins,
    pluginContext,
    () => {
      pluginContextRetired = true;
    },
  );

  const expectedApiExits = new WeakSet<ApiProcess>();
  const apiProcessController = new DevApiProcessController<ApiProcess>({
    expectExit(process) {
      expectedApiExits.add(process);
    },
    requestStop(process) {
      process.kill();
    },
    stop: stopApiProcess,
  });

  const restartApiServer = async (
    state: DevApiRuntimeState<TBundlerCfg>,
  ): Promise<boolean> => {
    if (closing) return false;
    const serverBundlePath = await findDevServerBundlePath(
      options.cwd,
      state.plan.output.serverDir,
      state.serverEntry,
    );
    if (!serverBundlePath || closing) return false;

    const serverPort = state.config.server.dev.port;
    const devRootDir = path.resolve(options.cwd, state.plan.distDir);
    const bootstrapPath = path.join(devRootDir, "_dev_start.cjs");
    const { writeOwnedOutputFile } = await import(
      "../output/owned-file-output.js"
    );
    await writeOwnedOutputFile(
      options.cwd,
      bootstrapPath,
      [
        `(async () => {`,
        `const path = require("node:path");`,
        `const { pathToFileURL } = require("node:url");`,
        `globalThis.__EVJS_FRAMEWORK_RUNTIME__ = ${serializeFrameworkRuntimeExpression(state.frameworkRuntime)};`,
        `globalThis.__EVJS_DEV_PAGE_RENDER_PROXY_HEADER__ = ${JSON.stringify(DEV_PAGE_RENDER_PROXY_HEADER)};`,
        `const serverDir = path.dirname(${JSON.stringify(serverBundlePath)});`,
        `globalThis.__EVJS_SERVER_MODULE_LOADER__ = async (asset) => { const mod = await import(pathToFileURL(path.resolve(serverDir, asset)).href); const nested = mod && typeof mod.default === "object" ? mod.default : undefined; return nested && ("default" in nested || "render" in nested) ? nested : mod; };`,
        `const serverModule = await import(${JSON.stringify(pathToFileURL(serverBundlePath).href)});`,
        `const handler = serverModule.default?.default ?? serverModule.default ?? serverModule;`,
        `const { serve } = require("@evjs/ev/_internal/server/node");`,
        `const server = serve({ fetch: handler.fetch }, { port: ${serverPort}, host: "0.0.0.0", https: ${JSON.stringify(state.config.server.dev.https ?? false)} });`,
        `const ready = () => console.log(${JSON.stringify(API_READY_MARKER)});`,
        `if (server.listening) ready(); else server.once("listening", ready);`,
        `server.once("error", (err) => { console.error(err); process.exit(1); });`,
        `})().catch((err) => { console.error(err); process.exit(1); });`,
      ].join("\n"),
      "Dev server bootstrap output",
    );

    if (closing) return false;
    if (apiProcessController.process) logger.info`Restarting API server...`;
    logger.info`Server bundle detected, starting API...`;
    await apiProcessController.replace(() => {
      const child = execa("node", [bootstrapPath], {
        stdio: ["inherit", "pipe", "pipe"],
        env: { ...process.env, NODE_ENV: "development" },
      });
      forwardApiOutput(child);
      child.catch((error) => {
        if (expectedApiExits.has(child)) return;
        if (apiProcessController.clearUnexpectedExit(child)) {
          logger.error`API server process exited unexpectedly: ${error}`;
        }
      });
      return child;
    }, waitForApiReady);

    const protocol = state.config.server.dev.https ? "https" : "http";
    const origin = `${protocol}://localhost:${serverPort}`;
    logger.info`${[
      "API server listening at:",
      ...formatDevServerAddresses(origin),
    ].join("\n")}`;
    return true;
  };

  const close = async (): Promise<void> => {
    closePromise ??= (async () => {
      if (closed) return;
      closing = true;
      abortController.abort();
      pluginContextRetired = true;
      const errors: unknown[] = [];

      // Stop the API first so a replacement session can reuse its port. The
      // bundler close then guarantees no new output callbacks can enter.
      try {
        await apiProcessController.stop();
      } catch (error) {
        errors.push(error);
      }
      try {
        await controller?.close();
      } catch (error) {
        errors.push(error);
      }
      try {
        await outputQueue;
        await apiQueue;
      } catch (error) {
        errors.push(error);
      }
      if (activationPromise) {
        try {
          await activationPromise;
        } catch {
          // The activation caller owns the authoritative hook failure.
        }
      }
      try {
        await releaseDistLock?.();
      } catch (error) {
        errors.push(error);
      } finally {
        unregisterDistExitCleanup();
      }
      try {
        await runDisposeHooks(hooks, pluginContext);
      } catch (error) {
        errors.push(error);
      }
      closed = true;

      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) {
        throw new AggregateError(errors, "[evjs] Failed to close dev session.");
      }
    })();
    return closePromise;
  };

  try {
    preflightBundlerBuild(options.bundler, options.plan);
    const clientMiddlewares = await collectClientDevMiddlewares(
      hooks,
      pluginContext,
      abortController.signal,
    );
    preflightBundlerDev(options.bundler, {
      clientMiddleware: clientMiddlewares.length > 0,
    });
    releaseDistLock = await writeDevDistLock(options.cwd, options.plan.distDir);
    unregisterDistExitCleanup = options.registerExitCleanup(() =>
      releaseDistLock?.sync(),
    );

    controller = await options.bundler.dev({
      config: options.config,
      cwd: options.cwd,
      hooks,
      plan: options.plan,
      signal: abortController.signal,
      clientMiddlewares,
      addWatchFile(file) {
        if (closing) return;
        options.registerWatchFile(path.resolve(options.cwd, file));
      },
      callbacks: {
        onBuildFacts(bundlerFacts, { isRebuild }) {
          if (closing || abortController.signal.aborted) {
            return Promise.resolve("discarded" as const);
          }
          const cycle = outputQueue.then(async () => {
            if (closing || abortController.signal.aborted) return;
            const outputSnapshot = await createFrameworkOutputSnapshot(
              options.cwd,
              [options.plan],
            );
            let linkedOutput: Awaited<
              ReturnType<typeof linkAndEmitBuildOutput<TBundlerCfg>>
            >;
            try {
              linkedOutput = await linkAndEmitBuildOutput({
                bundlerFacts,
                graph: options.graph,
                plan: options.plan,
                config: options.config,
                cwd: options.cwd,
                hooks,
                pluginCtx: pluginContext,
                isRebuild,
              });
            } catch (error) {
              return rethrowAfterCleanup(
                error,
                () => outputSnapshot.restore(),
                "[evjs] Framework output cycle failed and canonical output rollback also failed.",
              );
            }
            outputSnapshot.commit();
            frameworkRuntime = linkedOutput.frameworkRuntime;
            serverEntry = linkedOutput.output.server.entry;
            await runAfterBuildHooks(
              hooks,
              createBuildResult(linkedOutput.output, isRebuild, {
                frameworkRuntime: linkedOutput.frameworkRuntime,
              }),
              { cwd: options.cwd, emittedFiles: bundlerFacts.emittedFiles },
            );
          });
          outputQueue = cycle.then(
            () => undefined,
            () => undefined,
          );
          return cycle.then(() =>
            closing || abortController.signal.aborted
              ? ("discarded" as const)
              : ("published" as const),
          );
        },
        async onServerBundleReady() {
          if (closing || abortController.signal.aborted) return;
          const state: DevApiRuntimeState<TBundlerCfg> = {
            config: options.config,
            frameworkRuntime,
            plan: options.plan,
            serverEntry,
          };
          const cycle = apiQueue.then(() => restartApiServer(state));
          apiQueue = cycle.then(
            () => undefined,
            () => undefined,
          );
          await cycle;
        },
      },
    });

    logger.info`${formatDevServerReady(
      controller.origin,
      options.config,
      options.plan,
    )}`;

    return {
      get done() {
        return controller?.done ?? Promise.resolve();
      },
      get origin() {
        return controller?.origin ?? "";
      },
      activate() {
        if (closing) return activationPromise ?? Promise.resolve();
        activationPromise ??= runDevServerReadyHooks(
          hooks,
          pluginContext,
          controller?.origin ?? "",
          abortController.signal,
        );
        return activationPromise;
      },
      close,
    };
  } catch (error) {
    return rethrowAfterCleanup(
      error,
      close,
      "[evjs] Dev session startup failed and cleanup also failed.",
    );
  }
}

function formatDevServerReady(
  origin: string,
  config: Pick<ResolvedFrameworkConfig, "routing">,
  plan: Pick<BuildPlan, "html" | "server">,
): string {
  const pageUrls = formatDevPageUrls(origin, config, plan);
  const lines = ["App listening at:", ...formatDevServerAddresses(origin)];
  if (pageUrls) {
    lines.push(
      "  Pages:",
      ...pageUrls.map((page) => `    ${page.pageId}: ${page.url}`),
    );
  }
  return lines.join("\n");
}

function formatDevServerAddresses(origin: string): string[] {
  const addresses = [`  Local: ${origin}`];
  try {
    const networkUrl = new URL(origin);
    if (networkUrl.hostname !== "localhost") return addresses;
    const networkAddress = Object.values(os.networkInterfaces())
      .flatMap((entries) => entries ?? [])
      .find((entry) => entry.family === "IPv4" && !entry.internal);
    if (!networkAddress) return addresses;
    networkUrl.hostname = networkAddress.address;
    addresses.push(`  Network: ${networkUrl.origin}`);
  } catch {
    // Custom adapters may intentionally provide a non-standard origin.
  }
  return addresses;
}

export function formatDevPageUrls(
  origin: string,
  config: Pick<ResolvedFrameworkConfig, "routing">,
  plan: Pick<BuildPlan, "html" | "server">,
): Array<{ pageId: string; url: string }> | undefined {
  if (config.routing?.mode !== "mpa") return undefined;

  const htmlPageIds = new Set<string>();
  const pageUrls = plan.html.flatMap((document) => {
    const pageId = document.owner.pageId;
    if (!pageId) return [];
    htmlPageIds.add(pageId);
    return [{ pageId, url: formatDevUrl(origin, `/${document.fileName}`) }];
  });
  for (const route of config.routing.routes) {
    if (route.kind === "layout" || htmlPageIds.has(route.id)) continue;
    const serverDocument = plan.server.documents?.find(
      (document) => document.pageId === route.id,
    );
    pageUrls.push({
      pageId: route.id,
      url: formatDevUrl(
        origin,
        serverDocument ? `/${serverDocument.fileName}` : route.path,
      ),
    });
  }
  return pageUrls.length > 0 ? pageUrls : undefined;
}

function formatDevUrl(origin: string, pathname: string): string {
  const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${origin}${encodeURI(normalized)}`;
}
