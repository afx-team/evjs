import type {
  AppOutput,
  BuildOutput,
  PageOutput,
  RemoteEntry,
  RemoteManifest,
  RemoteOutput,
} from "@evjs/shared/manifest";
import * as React from "react";
import { createShell } from "./shell.js";

export type RemoteAppStatus = "idle" | "loading" | "mounted" | "error";

export interface RemoteAppActivationRequest {
  appId?: string;
  pageId?: string;
  remoteId?: string;
  remoteEntryId?: string;
  buildId?: string;
  url?: string | URL;
  mountPoint?: Element;
  hydrate?: boolean;
}

export interface RemoteAppModule {
  init?: (
    sharedScope: RemoteAppSharedScope,
    ctx: RemoteAppContext,
  ) => void | Promise<void>;
  mount?: (mountPoint: Element, ctx: RemoteAppContext) => void | Promise<void>;
  hydrate?: (
    mountPoint: Element,
    ctx: RemoteAppContext,
  ) => void | Promise<void>;
  unmount?: (
    mountPoint: Element,
    ctx: RemoteAppContext,
  ) => void | Promise<void>;
}

export interface RemoteAppContext {
  id: string;
  kind: "app" | "page" | "remote";
  manifest: BuildOutput;
  output: AppOutput | PageOutput | RemoteOutput;
  request: RemoteAppActivationRequest;
  remote?: {
    id: string;
    entryId: string;
    manifest: RemoteManifest;
    entry: RemoteEntry;
    shared: RemoteAppSharedResolution;
  };
}

export interface RemoteAppManifestLoadContext {
  id: string;
  request: RemoteAppActivationRequest;
  manifest: BuildOutput;
}

export type RemoteAppSharedScope = Record<string, RemoteAppSharedScopeEntry>;

export interface RemoteAppSharedScopeEntry {
  version?: string;
  singleton?: boolean;
  eager?: boolean;
  loaded?: boolean;
  from?: string;
  value?: unknown;
  get?: () => unknown | Promise<unknown>;
}

export interface RemoteAppSharedResolution {
  provided: Record<string, RemoteAppSharedScopeEntry>;
  missing: string[];
  incompatible: Array<{
    name: string;
    shareKey?: string;
    requiredVersion: string;
    providedVersion?: string;
    reason: "version" | "singleton";
  }>;
}

export interface RemoteAppSharedNegotiation {
  remoteId: string;
  dependencies: string[];
  resolution: RemoteAppSharedResolution;
  manifest: RemoteManifest;
  request: RemoteAppActivationRequest;
}

export interface RemoteAppRuntimeErrorContext {
  phase: "resolve" | "load" | "init" | "mount" | "hydrate" | "unmount";
  app: RemoteAppContext;
}

export interface RemoteAppTargetOptions {
  remote: string;
  manifest: string;
  manifestQueryParam?: string | false;
  activeWhen?: string | string[];
  request?: string | URL | RemoteAppActivationRequest;
}

export interface RemoteAppRuntimeHooks {
  shared?: RemoteAppSharedScope;
  sharedPolicy?: "warn" | "error";
  loadModule?: (
    href: string,
    ctx: RemoteAppContext,
  ) => Promise<RemoteAppModule>;
  loadRemoteManifest?: (
    remote: RemoteOutput,
    ctx: RemoteAppManifestLoadContext,
  ) => Promise<RemoteManifest>;
  onRemoteSharedNegotiated?: (
    event: RemoteAppSharedNegotiation,
  ) => void | Promise<void>;
  onError?: (
    error: unknown,
    ctx: RemoteAppRuntimeErrorContext,
  ) => void | Promise<void>;
}

export interface RemoteAppRuntimeOptions extends RemoteAppTargetOptions {
  mount: string | Element | (() => Element | null);
  runtime?: RemoteAppRuntimeHooks;
}

export interface RemoteAppRuntimeController {
  dispose(): Promise<void>;
}

export interface RemoteAppState {
  status: RemoteAppStatus;
  error?: unknown;
  sharedNegotiations: RemoteAppSharedNegotiation[];
  latestSharedNegotiation?: RemoteAppSharedNegotiation;
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
  const runtime = options.runtime ?? {};
  const shell = createShell({
    manifest: createRemoteAppManifest(options),
    shared: withDefaultReactSharedScope(runtime.shared),
    sharedPolicy: runtime.sharedPolicy,
    loadModule: runtime.loadModule,
    loadRemoteManifest: runtime.loadRemoteManifest,
    resolveMountPoint: () => resolveRemoteAppMountPoint(options.mount),
    onRemoteSharedNegotiated: runtime.onRemoteSharedNegotiated,
    onError: runtime.onError,
  });

  await shell.activate(resolveRemoteAppRequest(options));

  return {
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
      runtime: {
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
  event: RemoteAppSharedNegotiation,
): string {
  return `${event.remoteId}: ${event.dependencies.join(", ")} -> ${
    getRemoteSharedVersion(event) ?? "missing"
  }`;
}

export function getRemoteSharedVersion(
  event: RemoteAppSharedNegotiation,
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
): RemoteAppActivationRequest {
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
    } & RemoteAppActivationRequest;
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

function withDefaultReactSharedScope(
  shared: RemoteAppSharedScope | undefined,
): RemoteAppSharedScope {
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
