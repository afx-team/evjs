import {
  BUILD_IDENTIFIER_DESCRIPTION,
  getHttpUrlOrAbsolutePathnameValidationError,
  isBuildIdentifier,
} from "@evjs/shared";
import { assertClientRuntime } from "../../shared/runtime-config.js";
import { isRecord } from "../../shared/validation.js";
import { defaultLoadModule } from "./assets.js";
import { assertAppModule } from "./module-registration.js";
import { resolveTarget } from "./targets.js";
import type {
  ActivationRequest,
  AppContext,
  AppModule,
  ResolvedShellTarget,
  Shell,
  ShellErrorContext,
  ShellOptions,
} from "./types.js";

interface ActiveModule {
  id: string;
  activationKey: string;
  module: AppModule;
  mountPoint: Element;
  ctx: AppContext;
  phase: ActivationPhase;
}

interface ResolvedActivation extends ResolvedShellTarget {
  mountPoint: Element;
}

type ActivationPhase = "hydrate" | "mount" | "none";

export function createShell(options: ShellOptions): Shell {
  assertShellOptions(options);
  const loadModule = options.loadModule ?? defaultLoadModule;
  const moduleCache = new Map<string, Promise<AppModule>>();
  const moduleInitCache = new Map<string, Promise<void>>();
  const driverDisposers: Array<() => void> = [];
  const reportedShellErrors = new WeakSet<object>();
  let active: ActiveModule | undefined;
  let activationQueue: Promise<void> = Promise.resolve();
  let disposed = false;

  const reportShellError = async (
    error: unknown,
    context: ShellErrorContext,
  ): Promise<void> => {
    if (!options.onError) return;
    if (isObjectLike(error)) reportedShellErrors.add(error);
    await options.onError(error, context);
  };

  const reportUnhandledDriverTransitionError = (error: unknown): void => {
    if (isObjectLike(error) && reportedShellErrors.has(error)) return;

    const runtime = globalThis as typeof globalThis & {
      reportError?: (error: unknown) => void;
    };
    if (typeof runtime.reportError === "function") {
      runtime.reportError(error);
      return;
    }
    setTimeout(() => {
      throw error;
    }, 0);
  };

  const shell: Shell = {
    async start(request) {
      assertNotDisposed("start()");
      if (driverDisposers.length === 0) {
        for (const driver of options.drivers ?? []) {
          const dispose = driver.subscribe?.((next) => {
            void shell.activate(next).catch((error) => {
              reportUnhandledDriverTransitionError(error);
            });
          });
          if (dispose) driverDisposers.push(dispose);
        }
      }

      const initialRequest =
        request ?? options.drivers?.[0]?.current() ?? ({} as ActivationRequest);
      await shell.activate(initialRequest);
    },
    async activate(request) {
      assertNotDisposed("activate()");
      const run = activationQueue
        .catch(() => {
          // Keep later transitions alive even if an earlier activation failed.
        })
        .then(() => {
          assertActivationRequest(request, "activate()", options.runtime);
          return activateNow(request);
        });
      activationQueue = run;
      return run;
    },
    async preload(request) {
      assertNotDisposed("preload()");
      assertActivationRequest(request, "preload()", options.runtime);
      const target = await resolve(request);
      if (disposed) return;
      await getModule(target.href, target.ctx);
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      for (const dispose of driverDisposers.splice(0)) {
        dispose();
      }
      await activationQueue.catch(() => {
        // The caller disposing the shell should still release current resources
        // even if the last transition failed.
      });
      const current = active;
      if (current) {
        if (current.module.unmount && current.phase !== "none") {
          await callShellPhase(
            "unmount",
            current.ctx,
            () => current.module.unmount?.(current.mountPoint, current.ctx),
            reportShellError,
          );
        }
      }
      active = undefined;
      moduleCache.clear();
      moduleInitCache.clear();
    },
  };

  return shell;

  async function resolve(
    request: ActivationRequest,
  ): Promise<ResolvedActivation> {
    const target = await resolveTarget(options.runtime, request);
    const mountPoint =
      request.mountPoint ?? options.resolveMountPoint?.(target.ctx);
    if (mountPoint === undefined || mountPoint === null) {
      const error = new Error(
        `[evjs] Unable to resolve mount point for ${target.ctx.kind} "${target.id}".`,
      );
      await reportShellError(error, {
        phase: "resolve",
        app: target.ctx,
      });
      throw error;
    }
    if (!isRecord(mountPoint)) {
      const error = new Error(
        `[evjs] Shell resolveMountPoint() for ${target.ctx.kind} "${target.id}" must return an Element or null.`,
      );
      await reportShellError(error, {
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
        async () => {
          const loadedModule = await loadModule(href, ctx);
          const module = loadedModule as AppModule;
          assertAppModule(module, `[evjs] Shell module "${href}"`);
          return module;
        },
        reportShellError,
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
      reportShellError,
    );
    return module;
  }

  async function activateNow(request: ActivationRequest) {
    const target = await resolve(request);
    if (disposed) return;
    const activationKey = createActivationKey(target.ctx.request);
    if (
      active?.id === target.id &&
      active.mountPoint === target.mountPoint &&
      active.activationKey === activationKey
    ) {
      return;
    }

    const module = await getModule(target.href, target.ctx);
    if (disposed) return;

    const previous = active;
    if (previous) {
      try {
        if (previous.module.unmount && previous.phase !== "none") {
          await callShellPhase(
            "unmount",
            previous.ctx,
            () => previous.module.unmount?.(previous.mountPoint, previous.ctx),
            reportShellError,
          );
        }
      } finally {
        if (active === previous) active = undefined;
      }
    }
    if (disposed) return;

    let phase: ActivationPhase;
    try {
      phase = await activateModule(target, module, request);
    } catch (error) {
      if (previous && !disposed) {
        await restorePreviousActivation(previous).catch(() => {
          // Keep the activation failure as the primary error.
        });
      }
      throw error;
    }

    if (disposed) {
      if (module.unmount && phase !== "none") {
        await callShellPhase(
          "unmount",
          target.ctx,
          () => module.unmount?.(target.mountPoint, target.ctx),
          reportShellError,
        );
      }
      return;
    }

    active = {
      id: target.id,
      activationKey,
      module,
      mountPoint: target.mountPoint,
      ctx: target.ctx,
      phase,
    };
  }

  async function activateModule(
    target: ResolvedActivation,
    module: AppModule,
    request: ActivationRequest,
  ): Promise<ActivationPhase> {
    const shouldHydrate = request.hydrate ?? target.ctx.kind === "page";
    if (shouldHydrate && module.hydrate) {
      await callShellPhase(
        "hydrate",
        target.ctx,
        () => module.hydrate?.(target.mountPoint, target.ctx),
        reportShellError,
      );
      return "hydrate";
    }

    if (module.mount) {
      await callShellPhase(
        "mount",
        target.ctx,
        () => module.mount?.(target.mountPoint, target.ctx),
        reportShellError,
      );
      return "mount";
    }

    return "none";
  }

  async function restorePreviousActivation(previous: ActiveModule) {
    if (disposed) return;
    try {
      await replayActivationPhase(previous);
      if (disposed) {
        if (previous.module.unmount && previous.phase !== "none") {
          await callShellPhase(
            "unmount",
            previous.ctx,
            () => previous.module.unmount?.(previous.mountPoint, previous.ctx),
            reportShellError,
          );
        }
        return;
      }
      active = {
        ...previous,
      };
    } catch {}
  }

  async function replayActivationPhase(previous: ActiveModule) {
    if (previous.phase === "hydrate" && previous.module.hydrate) {
      await callShellPhase(
        "hydrate",
        previous.ctx,
        () => previous.module.hydrate?.(previous.mountPoint, previous.ctx),
        reportShellError,
      );
    } else if (previous.phase === "mount" && previous.module.mount) {
      await callShellPhase(
        "mount",
        previous.ctx,
        () => previous.module.mount?.(previous.mountPoint, previous.ctx),
        reportShellError,
      );
    }
  }

  function assertNotDisposed(method: string): void {
    if (!disposed) return;
    throw new Error(`[evjs] Shell ${method} cannot run after dispose().`);
  }
}

function isObjectLike(value: unknown): value is object {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  );
}

function createActivationKey(request: ActivationRequest): string {
  return JSON.stringify({
    appId: request.appId,
    pageId: request.pageId,
    buildId: request.buildId,
    url: request.url?.toString(),
    hydrate: request.hydrate,
  });
}

function assertShellOptions(options: unknown): asserts options is ShellOptions {
  if (!isRecord(options)) {
    throw new Error("[evjs] createShell() options must be an object.");
  }
  assertShellRuntime(options.runtime);

  if (options.drivers !== undefined) {
    if (!Array.isArray(options.drivers)) {
      throw new Error("[evjs] createShell() drivers must be an array.");
    }
    options.drivers.forEach(assertShellDriver);
  }

  assertOptionalFunction(options.loadModule, "loadModule");
  assertOptionalFunction(options.resolveMountPoint, "resolveMountPoint");
  assertOptionalFunction(options.onError, "onError");
  assertOptionalFunction(options.onWarning, "onWarning");
}

function assertActivationRequest(
  request: unknown,
  method: "activate()" | "preload()",
  runtime: ShellOptions["runtime"],
): asserts request is ActivationRequest {
  const prefix = `[evjs] Shell ${method} request`;
  if (!isRecord(request)) {
    throw new Error(`${prefix} must be an object.`);
  }

  assertOptionalRequestString(request.appId, `${prefix}.appId`);
  assertOptionalRequestString(request.pageId, `${prefix}.pageId`);
  assertOptionalRequestBuildId(request.buildId, `${prefix}.buildId`);
  assertRequestBuildId(request, prefix, runtime);
  assertActivationTargetRequest(request, prefix);

  if (
    request.url !== undefined &&
    typeof request.url !== "string" &&
    !(request.url instanceof URL)
  ) {
    throw new Error(`${prefix}.url must be a string or URL when provided.`);
  }
  if (typeof request.url === "string") {
    if (!request.url.trim()) {
      throw new Error(
        `${prefix}.url must be a non-empty string or URL when provided.`,
      );
    }
    assertTrimmedRequestString(request.url, `${prefix}.url`);
  }
  if (request.url !== undefined) {
    assertRequestUrl(request.url, `${prefix}.url`);
  }
  if (request.mountPoint !== undefined && !isRecord(request.mountPoint)) {
    throw new Error(`${prefix}.mountPoint must be an Element when provided.`);
  }
  if (request.hydrate !== undefined && typeof request.hydrate !== "boolean") {
    throw new Error(`${prefix}.hydrate must be a boolean when provided.`);
  }
}

function assertOptionalRequestString(value: unknown, path: string): void {
  if (value === undefined) return;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${path} must be a non-empty string when provided.`);
  }
  assertTrimmedRequestString(value, path);
}

function assertOptionalRequestBuildId(value: unknown, path: string): void {
  if (value === undefined) return;
  assertOptionalRequestString(value, path);
  if (typeof value === "string" && !isBuildIdentifier(value)) {
    throw new Error(
      `${path} must contain only ${BUILD_IDENTIFIER_DESCRIPTION}.`,
    );
  }
}

function assertRequestUrl(value: string | URL, path: string): void {
  const error = getHttpUrlOrAbsolutePathnameValidationError(value);
  if (!error) return;

  switch (error) {
    case "empty":
      throw new Error(
        `${path} must be a non-empty string or URL when provided.`,
      );
    case "whitespace":
      throw new Error(
        `${path} must not contain leading or trailing whitespace.`,
      );
    case "not-http-url-or-absolute-pathname":
      throwRequestUrlError(path);
  }
}

function throwRequestUrlError(path: string): never {
  throw new Error(
    `${path} must be an http(s) URL or pathname starting with "/".`,
  );
}

function assertTrimmedRequestString(value: string, path: string): void {
  if (value.trim() !== value) {
    throw new Error(`${path} must not contain leading or trailing whitespace.`);
  }
}

function assertRequestBuildId(
  request: ActivationRequest,
  prefix: string,
  runtime: ShellOptions["runtime"],
): void {
  if (request.buildId === undefined) return;
  if (request.buildId !== runtime.buildId) {
    throw new Error(
      `${prefix}.buildId "${request.buildId}" does not match runtime.buildId "${runtime.buildId}".`,
    );
  }
}

function assertActivationTargetRequest(
  request: ActivationRequest,
  prefix: string,
): void {
  const targets = [request.appId && "appId", request.pageId && "pageId"].filter(
    Boolean,
  );
  if (targets.length > 1) {
    throw new Error(`${prefix} must specify at most one of appId or pageId.`);
  }
}

function assertShellRuntime(runtime: unknown): void {
  if (!isRecord(runtime)) {
    throw new Error("[evjs] createShell() runtime must be an object.");
  }
  if (runtime.version !== 1) {
    throw new Error("[evjs] createShell() runtime.version must be 1.");
  }
  if (typeof runtime.buildId !== "string" || !runtime.buildId.trim()) {
    throw new Error(
      "[evjs] createShell() runtime.buildId must be a non-empty string.",
    );
  }
  if (!isBuildIdentifier(runtime.buildId)) {
    throw new Error(
      `[evjs] createShell() runtime.buildId must contain only ${BUILD_IDENTIFIER_DESCRIPTION}.`,
    );
  }
  if (!isRecord(runtime.runtime)) {
    throw new Error("[evjs] createShell() runtime.runtime must be an object.");
  }
  if (runtime.app !== undefined && !isRecord(runtime.app)) {
    throw new Error("[evjs] createShell() runtime.app must be an object.");
  }
  assertClientRuntime(runtime, "createShell() runtime");
}

function assertShellDriver(driver: unknown, index: number): void {
  if (!isRecord(driver)) {
    throw new Error(
      `[evjs] createShell() drivers[${index}] must be a shell driver object.`,
    );
  }
  if (typeof driver.current !== "function") {
    throw new Error(
      `[evjs] createShell() drivers[${index}].current must be a function.`,
    );
  }
  if (
    driver.subscribe !== undefined &&
    typeof driver.subscribe !== "function"
  ) {
    throw new Error(
      `[evjs] createShell() drivers[${index}].subscribe must be a function when provided.`,
    );
  }
}

function assertOptionalFunction(value: unknown, name: string): void {
  if (value !== undefined && typeof value !== "function") {
    throw new Error(
      `[evjs] createShell() ${name} must be a function when provided.`,
    );
  }
}

async function initializeModule(
  href: string,
  module: AppModule,
  ctx: AppContext,
  moduleInitCache: Map<string, Promise<void>>,
  onError: ShellOptions["onError"],
): Promise<void> {
  if (!module.init) return;

  let initialized = moduleInitCache.get(href);
  if (!initialized) {
    initialized = callShellPhase(
      "init",
      ctx,
      async () => {
        await module.init?.(ctx);
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
