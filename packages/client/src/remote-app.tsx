import type { BuildOutput } from "@evjs/shared/manifest";
import * as React from "react";
import type {
  ActivationRequest,
  AppContext,
  AppModule,
  RemoteSharedNegotiationContext,
  SharedScope,
  Shell,
  ShellOptions,
} from "./shell.js";
import { createShell } from "./shell.js";

export type RemoteAppStatus = "idle" | "loading" | "mounted" | "error";

export interface RemoteAppTargetOptions {
  remote: string;
  manifest: string;
  manifestQueryParam?: string | false;
  activeWhen?: string | string[];
  request?: string | URL | ActivationRequest;
}

export interface RemoteAppShellOptions {
  shared?: SharedScope;
  sharedPolicy?: ShellOptions["sharedPolicy"];
  loadModule?: (href: string, ctx: AppContext) => Promise<AppModule>;
  loadRemoteManifest?: ShellOptions["loadRemoteManifest"];
  onRemoteSharedNegotiated?: ShellOptions["onRemoteSharedNegotiated"];
  onError?: ShellOptions["onError"];
}

export interface RemoteAppRuntimeOptions extends RemoteAppTargetOptions {
  mount: string | Element | (() => Element | null);
  shell?: RemoteAppShellOptions;
}

export interface RemoteAppRuntimeController {
  shell: Shell;
  dispose(): Promise<void>;
}

export interface RemoteAppState {
  status: RemoteAppStatus;
  error?: unknown;
  sharedNegotiations: RemoteSharedNegotiationContext[];
  latestSharedNegotiation?: RemoteSharedNegotiationContext;
  sharedSummary?: string;
}

export type RemoteAppHookOptions = RemoteAppTargetOptions;

export interface RemoteAppHookResult extends RemoteAppState {
  mountRef: React.RefObject<HTMLDivElement | null>;
}

export type RemoteAppProps = RemoteAppHookOptions & {
  className?: string;
  children?: (state: RemoteAppHookResult) => React.ReactNode;
};

export function createRemoteAppManifest(
  options: RemoteAppTargetOptions,
): BuildOutput {
  return {
    version: 1,
    buildId: "remote-app",
    distDir: "dist",
    publicPath: "/",
    runtime: {},
    assets: {},
    apps: {},
    pages: {},
    routes: [],
    remotes: {
      [options.remote]: {
        manifest: resolveRemoteAppManifestUrl(options),
        activeWhen: normalizeActiveWhen(options.activeWhen),
      },
    },
  };
}

export async function startRemoteAppRuntime(
  options: RemoteAppRuntimeOptions,
): Promise<RemoteAppRuntimeController> {
  const shellOptions = options.shell ?? {};
  const shell = createShell({
    manifest: createRemoteAppManifest(options),
    shared: withDefaultReactSharedScope(shellOptions.shared),
    sharedPolicy: shellOptions.sharedPolicy,
    loadModule: shellOptions.loadModule,
    loadRemoteManifest: shellOptions.loadRemoteManifest,
    resolveMountPoint: () => resolveRemoteAppMountPoint(options.mount),
    onRemoteSharedNegotiated: shellOptions.onRemoteSharedNegotiated,
    onError: shellOptions.onError,
  });

  await shell.activate(resolveRemoteAppRequest(options));

  return {
    shell,
    dispose() {
      return shell.dispose();
    },
  };
}

export function useRemoteHost(
  options: RemoteAppHookOptions,
): RemoteAppHookResult {
  const mountRef = React.useRef<HTMLDivElement | null>(null);
  const [state, setState] = React.useState<RemoteAppState>({
    status: "idle",
    sharedNegotiations: [],
  });
  const { remote, manifest, manifestQueryParam, activeWhen, request } = options;
  const activeWhenKey = getActiveWhenKey(activeWhen);
  const requestKey = getRequestKey(request);

  React.useEffect(() => {
    let disposed = false;

    setState({
      status: "loading",
      sharedNegotiations: [],
    });

    let controller: RemoteAppRuntimeController | undefined;

    void startRemoteAppRuntime({
      remote,
      manifest,
      manifestQueryParam,
      activeWhen: activeWhenKey ? activeWhenKey.split("\u0000") : undefined,
      request: parseRequestKey(requestKey),
      mount: () => mountRef.current,
      shell: {
        onRemoteSharedNegotiated(event) {
          if (!disposed) {
            setState((current) => ({
              ...current,
              sharedNegotiations: [...current.sharedNegotiations, event],
              latestSharedNegotiation: event,
              sharedSummary: formatRemoteSharedNegotiation(event),
            }));
          }
        },
        onError(error) {
          if (!disposed) {
            setState((current) => ({
              ...current,
              status: "error",
              error,
            }));
          }
        },
      },
    })
      .then((nextController) => {
        controller = nextController;
        if (!disposed) {
          setState((current) => ({
            ...current,
            status: "mounted",
            error: undefined,
          }));
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setState((current) => ({
            ...current,
            status: "error",
            error,
          }));
        }
      });

    return () => {
      disposed = true;
      void controller?.dispose();
    };
  }, [remote, manifest, manifestQueryParam, activeWhenKey, requestKey]);

  return {
    ...state,
    mountRef,
  };
}

export function RemoteApp(props: RemoteAppProps) {
  const { className, children, ...options } = props;
  const state = useRemoteHost(options);

  return (
    <>
      <div className={className} ref={state.mountRef} />
      {children?.(state)}
    </>
  );
}

export function resolveRemoteAppManifestUrl(
  options: Pick<RemoteAppTargetOptions, "manifest" | "manifestQueryParam">,
): string {
  const queryParam = options.manifestQueryParam;
  const override =
    typeof queryParam === "string" ? readSearchParam(queryParam) : undefined;
  if (override) return override;

  return options.manifest;
}

export function formatRemoteSharedNegotiation(
  event: RemoteSharedNegotiationContext,
): string {
  return `${event.remoteId}: ${event.dependencies.join(", ")} -> ${
    getRemoteSharedVersion(event) ?? "missing"
  }`;
}

export function getRemoteSharedVersion(
  event: RemoteSharedNegotiationContext,
  ...names: string[]
): string | undefined {
  const candidates =
    names.length > 0 ? names : [...event.dependencies, "remote-react", "react"];

  for (const name of candidates) {
    const version = event.resolution.provided[name]?.version;
    if (version) return version;
  }

  return undefined;
}

function resolveRemoteAppRequest(
  options: RemoteAppRuntimeOptions,
): ActivationRequest {
  const remoteId = options.remote;
  const request = options.request ?? { remoteId };

  if (typeof request === "string" || request instanceof URL) {
    return {
      remoteId,
      url: request,
      hydrate: false,
    };
  }

  return {
    remoteId,
    hydrate: false,
    ...request,
  };
}

function resolveRemoteAppMountPoint(
  mount: RemoteAppRuntimeOptions["mount"],
): Element | null {
  if (typeof mount === "function") return mount();
  if (typeof mount !== "string") return mount;
  return globalThis.document?.querySelector(mount) ?? null;
}

function normalizeActiveWhen(activeWhen: string | string[] | undefined) {
  if (Array.isArray(activeWhen)) return activeWhen;
  if (activeWhen) return [activeWhen];
  return ["/*"];
}

function getActiveWhenKey(activeWhen: string | string[] | undefined): string {
  return normalizeActiveWhen(activeWhen).join("\u0000");
}

function getRequestKey(
  request: RemoteAppTargetOptions["request"] | undefined,
): string {
  if (!request) return "";
  if (typeof request === "string") {
    return JSON.stringify({ type: "url", url: request });
  }
  if (request instanceof URL) {
    return JSON.stringify({ type: "url", url: request.toString() });
  }

  return JSON.stringify({
    type: "activation",
    appId: request.appId,
    pageId: request.pageId,
    remoteId: request.remoteId,
    remoteEntryId: request.remoteEntryId,
    buildId: request.buildId,
    url: request.url?.toString(),
    hydrate: request.hydrate,
  });
}

function parseRequestKey(
  key: string,
): RemoteAppTargetOptions["request"] | undefined {
  if (!key) return undefined;

  try {
    const value = JSON.parse(key) as {
      type?: "url" | "activation";
      url?: string;
    } & ActivationRequest;
    if (value.type === "url") return value.url;
    return {
      appId: value.appId,
      pageId: value.pageId,
      remoteId: value.remoteId,
      remoteEntryId: value.remoteEntryId,
      buildId: value.buildId,
      url: value.url,
      hydrate: value.hydrate,
    };
  } catch {
    return undefined;
  }
}

function withDefaultReactSharedScope(shared: SharedScope | undefined) {
  return {
    react: {
      version: React.version,
      singleton: true,
      value: React,
    },
    ...shared,
  };
}

function readSearchParam(name: string): string | undefined {
  const href = globalThis.location?.href;
  if (!href) return undefined;

  try {
    return new URL(href).searchParams.get(name) ?? undefined;
  } catch {
    return undefined;
  }
}
