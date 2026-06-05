import type { RemoteManifest } from "@evjs/shared/manifest";
import {
  defaultLoadModule,
  defaultLoadRemoteManifest,
  loadRemoteStylesheets,
  releaseStylesheets,
} from "./assets.js";
import { createShellSharedScope } from "./shared.js";
import { resolveTarget } from "./targets.js";
import type {
  ActivationRequest,
  AppContext,
  AppModule,
  ResolvedShellTarget,
  SharedScope,
  Shell,
  ShellErrorContext,
  ShellOptions,
} from "./types.js";

interface ActiveModule {
  id: string;
  module: AppModule;
  mountPoint: Element;
  ctx: AppContext;
  stylesheets: string[];
}

interface ResolvedActivation extends ResolvedShellTarget {
  mountPoint: Element;
}

export function createShell(options: ShellOptions): Shell {
  const loadModule = options.loadModule ?? defaultLoadModule;
  const loadRemoteManifest =
    options.loadRemoteManifest ?? defaultLoadRemoteManifest;
  const moduleCache = new Map<string, Promise<AppModule>>();
  const moduleInitCache = new Map<string, Promise<void>>();
  const remoteManifestCache = new Map<string, Promise<RemoteManifest>>();
  const warnedSharedRemotes = new Set<string>();
  const driverDisposers: Array<() => void> = [];
  const sharedScope = createShellSharedScope(options.shared);
  let active: ActiveModule | undefined;
  let activationQueue: Promise<void> = Promise.resolve();

  const shell: Shell = {
    async start(request) {
      if (driverDisposers.length === 0) {
        for (const driver of options.drivers ?? []) {
          const dispose = driver.subscribe?.((next) => {
            void shell.activate(next);
          });
          if (dispose) driverDisposers.push(dispose);
        }
      }

      const initialRequest =
        request ?? options.drivers?.[0]?.current() ?? ({} as ActivationRequest);
      await shell.activate(initialRequest);
    },
    activate(request) {
      const run = activationQueue
        .catch(() => {
          // Keep later transitions alive even if an earlier activation failed.
        })
        .then(() => activateNow(request));
      activationQueue = run;
      return run;
    },
    async preload(request) {
      const target = await resolve(request);
      await getModule(target.href, target.ctx);
    },
    async dispose() {
      for (const dispose of driverDisposers.splice(0)) {
        dispose();
      }
      await activationQueue.catch(() => {
        // The caller disposing the shell should still release current resources
        // even if the last transition failed.
      });
      const current = active;
      if (current) {
        try {
          if (current.module.unmount) {
            await callShellPhase(
              "unmount",
              current.ctx,
              () => current.module.unmount?.(current.mountPoint, current.ctx),
              options.onError,
            );
          }
        } finally {
          releaseStylesheets(current.stylesheets);
        }
      }
      active = undefined;
      moduleCache.clear();
      moduleInitCache.clear();
      remoteManifestCache.clear();
    },
  };

  return shell;

  async function resolve(
    request: ActivationRequest,
  ): Promise<ResolvedActivation> {
    const target = await resolveTarget(
      options.manifest,
      request,
      loadRemoteManifest,
      remoteManifestCache,
      warnedSharedRemotes,
      options.onWarning,
      options.sharedPolicy ?? "warn",
      options.onRemoteSharedNegotiated,
      sharedScope,
    );
    const mountPoint =
      request.mountPoint ?? options.resolveMountPoint?.(target.ctx);
    if (!mountPoint) {
      const error = new Error(
        `[evjs] Unable to resolve mount point for ${target.ctx.kind} "${target.id}".`,
      );
      await options.onError?.(error, {
        phase: "resolve",
        app: target.ctx,
      });
      throw error;
    }
    return {
      ...target,
      mountPoint,
    };
  }

  async function getModule(href: string, ctx: AppContext) {
    let promise = moduleCache.get(href);
    if (!promise) {
      promise = callShellPhase(
        "load",
        ctx,
        () => loadModule(href, ctx),
        options.onError,
      ).catch((error) => {
        moduleCache.delete(href);
        throw error;
      });
      moduleCache.set(href, promise);
    }
    const module = await promise;
    await initializeModule(
      href,
      module,
      ctx,
      moduleInitCache,
      options.onError,
      sharedScope,
    );
    return module;
  }

  async function activateNow(request: ActivationRequest) {
    const target = await resolve(request);
    if (active?.id === target.id && active.mountPoint === target.mountPoint) {
      return;
    }

    const stylesheets = await loadRemoteStylesheets(target.ctx);
    let module: AppModule;
    try {
      module = await getModule(target.href, target.ctx);
    } catch (error) {
      releaseStylesheets(stylesheets);
      throw error;
    }

    const previous = active;
    if (previous) {
      try {
        if (previous.module.unmount) {
          await callShellPhase(
            "unmount",
            previous.ctx,
            () => previous.module.unmount?.(previous.mountPoint, previous.ctx),
            options.onError,
          );
        }
      } finally {
        releaseStylesheets(previous.stylesheets);
        if (active === previous) active = undefined;
      }
    }

    const shouldHydrate = request.hydrate ?? target.ctx.kind === "page";
    try {
      if (shouldHydrate && module.hydrate) {
        await callShellPhase(
          "hydrate",
          target.ctx,
          () => module.hydrate?.(target.mountPoint, target.ctx),
          options.onError,
        );
      } else if (module.mount) {
        await callShellPhase(
          "mount",
          target.ctx,
          () => module.mount?.(target.mountPoint, target.ctx),
          options.onError,
        );
      }
    } catch (error) {
      releaseStylesheets(stylesheets);
      throw error;
    }

    active = {
      id: target.id,
      module,
      mountPoint: target.mountPoint,
      ctx: target.ctx,
      stylesheets,
    };
  }
}

async function initializeModule(
  href: string,
  module: AppModule,
  ctx: AppContext,
  moduleInitCache: Map<string, Promise<void>>,
  onError: ShellOptions["onError"],
  sharedScope: SharedScope,
): Promise<void> {
  if (!module.init) return;

  let initialized = moduleInitCache.get(href);
  if (!initialized) {
    initialized = callShellPhase(
      "init",
      ctx,
      async () => {
        await module.init?.(sharedScope, ctx);
      },
      onError,
    ).catch((error) => {
      moduleInitCache.delete(href);
      throw error;
    });
    moduleInitCache.set(href, initialized);
  }

  await initialized;
}

async function callShellPhase<T>(
  phase: ShellErrorContext["phase"],
  app: AppContext,
  run: () => T | Promise<T>,
  onError: ShellOptions["onError"],
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    await onError?.(error, { phase, app });
    throw error;
  }
}
