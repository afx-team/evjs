import type {
  AppOutput,
  BuildOutput,
  PageOutput,
  RemoteEntry,
  RemoteManifest,
  RemoteOutput,
} from "@evjs/shared/manifest";

export interface AppModule {
  init?: (sharedScope: SharedScope, ctx: AppContext) => void | Promise<void>;
  mount?: (mountPoint: Element, ctx: AppContext) => void | Promise<void>;
  hydrate?: (mountPoint: Element, ctx: AppContext) => void | Promise<void>;
  unmount?: (mountPoint: Element, ctx: AppContext) => void | Promise<void>;
}

export type ShellModuleRegistration =
  | AppModule
  | ((ctx: AppContext) => AppModule | Promise<AppModule>);

export interface AppContext {
  id: string;
  kind: "app" | "page" | "remote";
  manifest: BuildOutput;
  output: AppOutput | PageOutput | RemoteOutput;
  request: ActivationRequest;
  remote?: {
    id: string;
    entryId: string;
    manifest: RemoteManifest;
    entry: RemoteEntry;
    shared: RemoteSharedResolution;
  };
}

export interface ActivationRequest {
  appId?: string;
  pageId?: string;
  remoteId?: string;
  remoteEntryId?: string;
  buildId?: string;
  url?: string | URL;
  mountPoint?: Element;
  hydrate?: boolean;
}

export interface ShellOptions {
  manifest: BuildOutput;
  drivers?: ShellDriver[];
  loadModule?: (href: string, ctx: AppContext) => Promise<AppModule>;
  loadRemoteManifest?: (
    remote: RemoteOutput,
    ctx: RemoteManifestLoadContext,
  ) => Promise<RemoteManifest>;
  resolveMountPoint?: (ctx: AppContext) => Element | null;
  shared?: SharedScope;
  sharedPolicy?: "warn" | "error";
  onRemoteSharedNegotiated?: (
    event: RemoteSharedNegotiationContext,
  ) => void | Promise<void>;
  onError?: (error: unknown, ctx: ShellErrorContext) => void | Promise<void>;
  onWarning?: (warning: ShellWarningContext) => void | Promise<void>;
}

export interface RemoteManifestLoadContext {
  id: string;
  request: ActivationRequest;
  manifest: BuildOutput;
}

export interface ShellErrorContext {
  phase: "resolve" | "load" | "init" | "mount" | "hydrate" | "unmount";
  app: AppContext;
}

export type ShellWarningContext = RemoteSharedDependenciesWarning;

export type SharedScope = Record<string, SharedScopeEntry>;

export interface SharedScopeEntry {
  version?: string;
  singleton?: boolean;
  eager?: boolean;
  loaded?: boolean;
  from?: string;
  value?: unknown;
  get?: () => unknown | Promise<unknown>;
}

export interface RemoteSharedResolution {
  provided: Record<string, SharedScopeEntry>;
  missing: string[];
  incompatible: Array<{
    name: string;
    shareKey?: string;
    requiredVersion: string;
    providedVersion?: string;
    reason: "version" | "singleton";
  }>;
}

export interface RemoteSharedDependenciesWarning {
  code: "remote-shared-dependencies";
  message: string;
  remoteId: string;
  dependencies: string[];
  missing: string[];
  incompatible: RemoteSharedResolution["incompatible"];
  resolution: RemoteSharedResolution;
  manifest: RemoteManifest;
  request: ActivationRequest;
}

export interface RemoteSharedNegotiationContext {
  remoteId: string;
  dependencies: string[];
  resolution: RemoteSharedResolution;
  manifest: RemoteManifest;
  request: ActivationRequest;
}

export interface Shell {
  start(request?: ActivationRequest): Promise<void>;
  activate(request: ActivationRequest): Promise<void>;
  preload(request: ActivationRequest): Promise<void>;
  dispose(): Promise<void>;
}

export interface ShellDriver {
  current(): ActivationRequest;
  subscribe?(callback: (request: ActivationRequest) => void): () => void;
}

export interface PageDriverOptions {
  document?: Document;
}

export interface PageDriver extends ShellDriver {}

export interface HistoryDriverOptions {
  manifest: BuildOutput;
  window?: BrowserWindowLike;
}

export interface HistoryDriver extends ShellDriver {
  subscribe(callback: (request: ActivationRequest) => void): () => void;
}

export type BrowserWindowLike = Pick<
  Window,
  "addEventListener" | "location" | "removeEventListener"
>;

export interface ResolvedShellTarget {
  id: string;
  href: string;
  ctx: AppContext;
}
