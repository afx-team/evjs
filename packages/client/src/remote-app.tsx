import {
  BUILD_IDENTIFIER_DESCRIPTION,
  getHttpUrlOrAbsolutePathnameValidationError,
  getHttpUrlOrPathValidationError,
  getPathPatternListValidationError,
  isBuildIdentifier,
  type PathPatternListValidationError,
  type PathPatternValidationError,
} from "@evjs/shared";
import type {
  AppOutput,
  BuildOutput,
  PageOutput,
  RemoteEntry,
  RemoteManifest,
  RemoteOutput,
} from "@evjs/shared/manifest";
import * as React from "react";
import type { RemoteRuntimeContext } from "./react.js";
import { assertSharedScope } from "./shell/shared.js";
import { createShell } from "./shell.js";

const REMOTE_APP_BUILD_ID = "remote-app";

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

export interface RemoteAppReactProps {
  remote: RemoteRuntimeContext;
  request: RemoteAppActivationRequest;
}

export interface RemoteAppModule {
  default?: React.ComponentType<RemoteAppReactProps>;
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
  document?: Document;
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

type RemoteAppStateUpdater = (
  value: RemoteAppState | ((current: RemoteAppState) => RemoteAppState),
) => void;

interface RemoteHostLifecycleOptions extends RemoteAppTargetOptions {
  mountRef: React.RefObject<Element | null>;
  setState: RemoteAppStateUpdater;
  startRuntime?: typeof startRemoteAppRuntime;
}

const remoteAppObjectKeys = new WeakMap<object, number>();
const remoteAppObjectsByKey = new Map<number, WeakRef<object>>();
let nextRemoteAppObjectKey = 1;

export type RemoteAppProps = RemoteAppHookOptions & {
  className?: string;
  children?: (state: RemoteAppHookResult) => React.ReactNode;
};

export function createRemoteAppManifest(
  options: RemoteAppTargetOptions,
): BuildOutput {
  if (!isRecord(options)) {
    throw new Error(
      "[evjs] createRemoteAppManifest() options must be an object.",
    );
  }
  const remote = assertRemoteAppBuildIdentifier(options.remote, "remote");
  return {
    version: 1,
    buildId: REMOTE_APP_BUILD_ID,
    distDir: "dist",
    publicPath: "/",
    runtime: {},
    assets: {},
    apps: {},
    pages: {},
    routes: [],
    remotes: {
      [remote]: {
        manifest: resolveRemoteAppManifestUrl(options),
        activeWhen: normalizeActiveWhen(options.activeWhen),
      },
    },
  };
}

export async function startRemoteAppRuntime(
  options: RemoteAppRuntimeOptions,
): Promise<RemoteAppRuntimeController> {
  assertRemoteAppRuntimeOptions(options);
  const runtime = options.runtime ?? {};
  const shell = createShell({
    manifest: createRemoteAppManifest(options),
    shared: withDefaultReactSharedScope(runtime.shared),
    sharedPolicy: runtime.sharedPolicy,
    loadModule: runtime.loadModule,
    loadRemoteManifest: runtime.loadRemoteManifest,
    resolveMountPoint: () =>
      resolveRemoteAppMountPoint(options.mount, options.document),
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
    return startRemoteHostLifecycle({
      remote,
      manifest,
      manifestQueryParam,
      activeWhen: activeWhenKey ? activeWhenKey.split("\u0000") : undefined,
      request: parseRequestKey(requestKey),
      mountRef,
      setState,
    });
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

function startRemoteHostLifecycle(
  options: RemoteHostLifecycleOptions,
): () => void {
  let disposed = false;
  const startRuntime = options.startRuntime ?? startRemoteAppRuntime;

  options.setState({
    status: "loading",
    sharedNegotiations: [],
  });

  let controller: RemoteAppRuntimeController | undefined;

  void startRuntime({
    remote: options.remote,
    manifest: options.manifest,
    manifestQueryParam: options.manifestQueryParam,
    activeWhen: options.activeWhen,
    request: options.request,
    mount: () => options.mountRef.current,
    runtime: {
      onRemoteSharedNegotiated(event) {
        if (!disposed) {
          options.setState((current) => ({
            ...current,
            sharedNegotiations: [...current.sharedNegotiations, event],
            latestSharedNegotiation: event,
            sharedSummary: formatRemoteSharedNegotiation(event),
          }));
        }
      },
      onError(error) {
        if (!disposed) {
          options.setState((current) => ({
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
      if (disposed) {
        disposeRemoteHostController(nextController);
        return;
      }
      options.setState((current) => ({
        ...current,
        status: "mounted",
        error: undefined,
      }));
    })
    .catch((error: unknown) => {
      if (!disposed) {
        options.setState((current) => ({
          ...current,
          status: "error",
          error,
        }));
      }
    });

  return () => {
    disposed = true;
    if (controller) {
      disposeRemoteHostController(controller);
    }
  };
}

/** @internal Test-only lifecycle entry point. */
export const __startRemoteHostLifecycleForTesting = startRemoteHostLifecycle;

function disposeRemoteHostController(
  controller: RemoteAppRuntimeController,
): void {
  try {
    void controller.dispose().catch(handleRemoteHostDisposeError);
  } catch {
    handleRemoteHostDisposeError();
  }
}

function handleRemoteHostDisposeError(): void {
  // React cleanup cannot surface disposal failures after the host unmounts.
}

export function resolveRemoteAppManifestUrl(
  options: Pick<RemoteAppTargetOptions, "manifest" | "manifestQueryParam">,
): string {
  if (!isRecord(options)) {
    throw new Error(
      "[evjs] resolveRemoteAppManifestUrl() options must be an object.",
    );
  }
  const manifest = assertRemoteAppManifestUrl(options.manifest, "manifest");
  const queryParam = normalizeRemoteAppManifestQueryParam(
    options.manifestQueryParam,
  );
  const override =
    typeof queryParam === "string" ? readSearchParam(queryParam) : undefined;
  if (override) {
    return assertRemoteAppManifestUrl(
      override,
      `${queryParam} manifest override`,
    );
  }

  return manifest;
}

export function formatRemoteSharedNegotiation(
  event: RemoteAppSharedNegotiation,
): string {
  assertRemoteSharedNegotiation(event, "formatRemoteSharedNegotiation()");
  return `${event.remoteId}: ${event.dependencies.join(", ")} -> ${
    getRemoteSharedVersion(event) ?? "missing"
  }`;
}

export function getRemoteSharedVersion(
  event: RemoteAppSharedNegotiation,
  ...names: string[]
): string | undefined {
  assertRemoteSharedNegotiation(event, "getRemoteSharedVersion()");
  names.forEach((name, index) => {
    if (typeof name !== "string" || !name.trim()) {
      throw new Error(
        `[evjs] RemoteApp getRemoteSharedVersion() names[${index}] must be a non-empty string.`,
      );
    }
  });
  const candidates =
    names.length > 0 ? names : [...event.dependencies, "remote-react", "react"];

  for (const name of candidates) {
    const version = event.resolution.provided[name]?.version;
    if (version) return version;
  }

  return undefined;
}

function assertRemoteSharedNegotiation(
  event: unknown,
  source: string,
): asserts event is RemoteAppSharedNegotiation {
  if (!isRecord(event)) {
    throw new Error(`[evjs] RemoteApp ${source} event must be an object.`);
  }
  assertRemoteAppBuildIdentifier(event.remoteId, `${source} event.remoteId`);
  if (!Array.isArray(event.dependencies)) {
    throw new Error(
      `[evjs] RemoteApp ${source} event.dependencies must be an array.`,
    );
  }
  event.dependencies.forEach((dependency, index) => {
    if (typeof dependency !== "string" || !dependency.trim()) {
      throw new Error(
        `[evjs] RemoteApp ${source} event.dependencies[${index}] must be a non-empty string.`,
      );
    }
  });
  if (!isRecord(event.resolution)) {
    throw new Error(
      `[evjs] RemoteApp ${source} event.resolution must be an object.`,
    );
  }
  if (!isRecord(event.resolution.provided)) {
    throw new Error(
      `[evjs] RemoteApp ${source} event.resolution.provided must be an object.`,
    );
  }
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
    ...request,
    remoteId: request.remoteId ?? remoteId,
    hydrate: request.hydrate ?? false,
  };
}

function resolveRemoteAppMountPoint(
  mount: RemoteAppRuntimeOptions["mount"],
  document: Document | undefined = globalThis.document,
): Element | null {
  if (typeof mount === "function") {
    return assertResolvedRemoteAppMountPoint(mount(), "mount function");
  }
  if (typeof mount === "string") {
    const selector = assertRemoteAppNonEmptyString(mount, "mount selector");
    const doc = resolveRemoteAppDocument(document);
    try {
      return assertResolvedRemoteAppMountPoint(
        doc.querySelector(selector),
        `mount selector "${selector}"`,
      );
    } catch (error) {
      if (isRemoteAppMountResolutionError(error)) throw error;
      throw new Error(
        `[evjs] RemoteApp mount selector "${selector}" is invalid${formatErrorDetail(error)}`,
      );
    }
  }
  if (!mount || typeof mount !== "object") {
    throw new Error(
      "[evjs] RemoteApp mount must be a selector string, Element, or function.",
    );
  }
  return mount;
}

function assertRemoteAppRuntimeOptions(
  options: unknown,
): asserts options is RemoteAppRuntimeOptions {
  if (!isRecord(options)) {
    throw new Error(
      "[evjs] startRemoteAppRuntime() options must be an object.",
    );
  }
  assertRemoteAppMountOption(options.mount);
  if (options.runtime !== undefined && !isRecord(options.runtime)) {
    throw new Error("[evjs] RemoteApp runtime must be an object.");
  }
  assertRemoteAppRuntimeHooks(options.runtime);
  const remote = assertRemoteAppBuildIdentifier(options.remote, "remote");
  assertRemoteAppRequestOption(options.request, remote);
}

function assertRemoteAppRuntimeHooks(
  value: unknown,
): asserts value is RemoteAppRuntimeHooks | undefined {
  if (value === undefined) return;
  if (!isRecord(value)) return;

  assertSharedScope(value.shared, "[evjs] RemoteApp runtime.shared");
  if (
    value.sharedPolicy !== undefined &&
    value.sharedPolicy !== "warn" &&
    value.sharedPolicy !== "error"
  ) {
    throw new Error(
      '[evjs] RemoteApp runtime.sharedPolicy must be "warn" or "error".',
    );
  }
  assertOptionalRemoteAppFunction(value.loadModule, "runtime.loadModule");
  assertOptionalRemoteAppFunction(
    value.loadRemoteManifest,
    "runtime.loadRemoteManifest",
  );
  assertOptionalRemoteAppFunction(
    value.onRemoteSharedNegotiated,
    "runtime.onRemoteSharedNegotiated",
  );
  assertOptionalRemoteAppFunction(value.onError, "runtime.onError");
}

function assertOptionalRemoteAppFunction(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== "function") {
    throw new Error(
      `[evjs] RemoteApp ${path} must be a function when provided.`,
    );
  }
}

function assertRemoteAppMountOption(
  value: unknown,
): asserts value is RemoteAppRuntimeOptions["mount"] {
  if (typeof value === "string") {
    assertRemoteAppNonEmptyString(value, "mount selector");
    return;
  }
  if (typeof value === "function") return;
  if (!isRecord(value)) {
    throw new Error(
      "[evjs] RemoteApp mount must be a selector string, Element, or function.",
    );
  }
}

function resolveRemoteAppDocument(document: Document | undefined): Document {
  if (!isRecord(document)) {
    throw new Error(
      "[evjs] RemoteApp mount selector requires a browser document.",
    );
  }
  if (typeof document.querySelector !== "function") {
    throw new Error(
      "[evjs] RemoteApp mount selector document.querySelector must be a function.",
    );
  }
  return document as Document;
}

function normalizeActiveWhen(
  activeWhen: string | string[] | undefined,
): string[] {
  let patterns: unknown[];
  if (activeWhen === undefined) {
    patterns = ["/*"];
  } else if (Array.isArray(activeWhen)) {
    patterns = activeWhen;
  } else {
    patterns = [activeWhen];
  }

  const error = getPathPatternListValidationError(patterns, {
    allowEmpty: false,
  });
  if (error) throwRemoteAppActiveWhenListError(error);
  return [...(patterns as string[])];
}

function throwRemoteAppActiveWhenListError(
  error: PathPatternListValidationError,
): never {
  switch (error.kind) {
    case "not-array":
      throw new Error(
        "[evjs] RemoteApp activeWhen must contain only non-empty strings.",
      );
    case "empty-array":
      throw new Error(
        "[evjs] RemoteApp activeWhen must contain at least one path.",
      );
    case "duplicate-pattern":
      throw new Error(
        `[evjs] RemoteApp activeWhen must not contain duplicate pattern "${error.pattern}".`,
      );
    case "invalid-pattern":
      throwRemoteAppActiveWhenPatternError(error.value, error.error);
  }
}

function throwRemoteAppActiveWhenPatternError(
  value: unknown,
  error: PathPatternValidationError,
): never {
  if (error === "empty" || typeof value !== "string") {
    throw new Error(
      "[evjs] RemoteApp activeWhen must contain only non-empty strings.",
    );
  }
  if (error === "whitespace") {
    throw new Error(
      `[evjs] RemoteApp activeWhen pattern "${value}" must not contain whitespace.`,
    );
  }
  if (error === "missing-leading-slash") {
    throw new Error(
      `[evjs] RemoteApp activeWhen pattern "${value}" must start with "/".`,
    );
  }
  throw new Error(
    `[evjs] RemoteApp activeWhen pattern "${value}" must not include a query string or hash.`,
  );
}

function assertRemoteAppNonEmptyString(value: unknown, path: string): string {
  if (typeof value === "string" && value.trim()) {
    if (value.trim() !== value) {
      throw new Error(
        `[evjs] RemoteApp ${path} must not contain leading or trailing whitespace.`,
      );
    }
    return value;
  }
  throw new Error(`[evjs] RemoteApp ${path} must be a non-empty string.`);
}

function assertRemoteAppManifestUrl(value: unknown, path: string): string {
  const error = getHttpUrlOrPathValidationError(value);
  if (!error) return value as string;

  switch (error) {
    case "empty":
      throw new Error(`[evjs] RemoteApp ${path} must be a non-empty string.`);
    case "whitespace":
      throw new Error(
        `[evjs] RemoteApp ${path} must not contain leading or trailing whitespace.`,
      );
    case "not-http-url-or-path":
      throw new Error(
        `[evjs] RemoteApp ${path} must be an http(s) URL or path.`,
      );
  }
}

function assertRemoteAppRequestOption(
  value: unknown,
  remote: string,
): asserts value is RemoteAppTargetOptions["request"] {
  if (value === undefined) return;
  if (value instanceof URL) {
    assertRemoteAppRequestUrl(value, "request.url");
    return;
  }
  if (typeof value === "string") {
    assertRemoteAppRequestUrl(value, "request url");
    return;
  }
  if (!isRecord(value)) {
    throw new Error(
      "[evjs] RemoteApp request must be a string, URL, or activation request object.",
    );
  }

  assertOptionalRemoteAppString(value.appId, "request.appId");
  assertOptionalRemoteAppBuildIdentifier(value.pageId, "request.pageId");
  assertOptionalRemoteAppBuildIdentifier(value.remoteId, "request.remoteId");
  assertOptionalRemoteAppBuildIdentifier(
    value.remoteEntryId,
    "request.remoteEntryId",
  );
  assertOptionalRemoteAppBuildIdentifier(value.buildId, "request.buildId");
  assertRemoteAppRequestBuildId(value);
  assertRemoteAppRequestTarget(value, remote);
  if (value.url !== undefined) {
    assertRemoteAppRequestUrl(value.url, "request.url");
  }
  if (value.mountPoint !== undefined && !isRecord(value.mountPoint)) {
    throw new Error(
      "[evjs] RemoteApp request.mountPoint must be an Element when provided.",
    );
  }
  if (value.hydrate !== undefined && typeof value.hydrate !== "boolean") {
    throw new Error("[evjs] RemoteApp request.hydrate must be a boolean.");
  }
}

function assertRemoteAppRequestUrl(value: unknown, path: string): void {
  if (typeof value !== "string" && !(value instanceof URL)) {
    throw new Error(`[evjs] RemoteApp ${path} must be a non-empty string.`);
  }

  const error = getHttpUrlOrAbsolutePathnameValidationError(value);
  if (!error) return;

  switch (error) {
    case "empty":
      throw new Error(`[evjs] RemoteApp ${path} must be a non-empty string.`);
    case "whitespace":
      throw new Error(
        `[evjs] RemoteApp ${path} must not contain leading or trailing whitespace.`,
      );
    case "not-http-url-or-absolute-pathname":
      throwRemoteAppRequestUrlError(path);
  }
}

function throwRemoteAppRequestUrlError(path: string): never {
  throw new Error(
    `[evjs] RemoteApp ${path} must be an http(s) URL or pathname starting with "/".`,
  );
}

function assertRemoteAppRequestBuildId(
  value: RemoteAppActivationRequest,
): void {
  if (value.buildId === undefined) return;
  if (value.buildId !== REMOTE_APP_BUILD_ID) {
    throw new Error(
      `[evjs] RemoteApp request.buildId "${value.buildId}" must match generated host buildId "${REMOTE_APP_BUILD_ID}".`,
    );
  }
}

function assertRemoteAppRequestTarget(
  value: RemoteAppActivationRequest,
  remote: string,
): void {
  if (value.appId !== undefined || value.pageId !== undefined) {
    throw new Error(
      "[evjs] RemoteApp request must not include appId or pageId; RemoteApp always targets the configured remote.",
    );
  }
  if (value.remoteEntryId !== undefined && value.url !== undefined) {
    throw new Error(
      "[evjs] RemoteApp request must not include both remoteEntryId and url; use remoteEntryId for an explicit remote entry or url for activeWhen routing.",
    );
  }
  if (value.remoteId !== undefined && value.remoteId !== remote) {
    throw new Error(
      `[evjs] RemoteApp request.remoteId "${value.remoteId}" must match configured remote "${remote}".`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function formatErrorDetail(error: unknown): string {
  return error instanceof Error && error.message ? `: ${error.message}` : ".";
}

function assertRemoteAppBuildIdentifier(value: unknown, path: string): string {
  const identifier = assertRemoteAppNonEmptyString(value, path);
  if (isBuildIdentifier(identifier)) return identifier;
  throw new Error(
    `[evjs] RemoteApp ${path} must contain only ${BUILD_IDENTIFIER_DESCRIPTION}.`,
  );
}

function assertOptionalRemoteAppString(value: unknown, path: string): void {
  if (value === undefined) return;
  assertRemoteAppNonEmptyString(value, path);
}

function assertOptionalRemoteAppBuildIdentifier(
  value: unknown,
  path: string,
): void {
  if (value === undefined) return;
  assertRemoteAppBuildIdentifier(value, path);
}

function assertResolvedRemoteAppMountPoint(
  value: unknown,
  source: string,
): Element | null {
  if (value === null) return null;
  if (isRecord(value)) return value as unknown as Element;
  throw new Error(
    `[evjs] RemoteApp ${source} must resolve to an Element or null.`,
  );
}

function isRemoteAppMountResolutionError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.startsWith("[evjs] RemoteApp mount ")
  );
}

function normalizeRemoteAppManifestQueryParam(
  value: RemoteAppTargetOptions["manifestQueryParam"],
): string | false | undefined {
  if (value === false || value === undefined) return value;
  return assertRemoteAppNonEmptyString(value, "manifestQueryParam");
}

function getActiveWhenKey(activeWhen: string | string[] | undefined): string {
  return normalizeActiveWhen(activeWhen).join("\u0000");
}

function getRequestKey(
  request: RemoteAppTargetOptions["request"] | undefined,
): string {
  if (request === undefined) return "";
  if (typeof request === "string") {
    return JSON.stringify({ type: "url", url: request });
  }
  if (request instanceof URL) {
    return JSON.stringify({ type: "url", url: request.toString() });
  }
  if (!isRecord(request)) {
    return JSON.stringify({ type: "invalid", value: request });
  }

  const mountPointKey = getMountPointKey(request.mountPoint);

  return JSON.stringify({
    type: "activation",
    appId: request.appId,
    pageId: request.pageId,
    remoteId: request.remoteId,
    remoteEntryId: request.remoteEntryId,
    buildId: request.buildId,
    url: request.url?.toString(),
    mountPointKey: mountPointKey.key,
    mountPointValue: mountPointKey.value,
    hydrate: request.hydrate,
  });
}

function getMountPointKey(
  value: RemoteAppActivationRequest["mountPoint"] | unknown,
): { key?: number; value?: unknown } {
  if (value === undefined) return {};
  if (canUseRemoteAppObjectKey(value)) {
    return { key: getRemoteAppObjectKey(value) };
  }
  return { value };
}

function canUseRemoteAppObjectKey(value: unknown): value is object {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  );
}

function getRemoteAppObjectKey(value: object): number {
  const existing = remoteAppObjectKeys.get(value);
  if (existing) return existing;
  const next = nextRemoteAppObjectKey++;
  remoteAppObjectKeys.set(value, next);
  remoteAppObjectsByKey.set(next, new WeakRef(value));
  return next;
}

function getRemoteAppObjectByKey<T extends object>(
  key: unknown,
): T | undefined {
  if (typeof key !== "number") return undefined;
  const value = remoteAppObjectsByKey.get(key)?.deref();
  if (!value) {
    remoteAppObjectsByKey.delete(key);
    return undefined;
  }
  return value as T;
}

/** @internal Test-only request key entry point. */
export const __getRemoteAppRequestKeyForTesting = getRequestKey;

function parseRequestKey(
  key: string,
): RemoteAppTargetOptions["request"] | undefined {
  if (!key) return undefined;

  try {
    const value = JSON.parse(key) as {
      type?: "url" | "activation" | "invalid";
      value?: unknown;
      url?: string;
      mountPointKey?: number;
      mountPointValue?: unknown;
    } & RemoteAppActivationRequest;
    if (value.type === "url") return value.url;
    if (value.type === "invalid") {
      return value.value as RemoteAppTargetOptions["request"];
    }
    return {
      appId: value.appId,
      pageId: value.pageId,
      remoteId: value.remoteId,
      remoteEntryId: value.remoteEntryId,
      buildId: value.buildId,
      url: value.url,
      mountPoint:
        value.mountPointKey === undefined
          ? (value.mountPointValue as Element | undefined)
          : getRemoteAppObjectByKey<Element>(value.mountPointKey),
      hydrate: value.hydrate,
    };
  } catch {
    return undefined;
  }
}

/** @internal Test-only request key parser. */
export const __parseRemoteAppRequestKeyForTesting = parseRequestKey;

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
