import type { AppOutput, BuildOutput, PageOutput } from "@evjs/shared/manifest";

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
  kind: "app" | "page";
  manifest: BuildOutput;
  output: AppOutput | PageOutput;
  request: ActivationRequest;
}

export interface ActivationRequest {
  appId?: string;
  pageId?: string;
  buildId?: string;
  url?: string | URL;
  mountPoint?: Element;
  hydrate?: boolean;
}

export interface ShellOptions {
  manifest: BuildOutput;
  drivers?: ShellDriver[];
  loadModule?: (href: string, ctx: AppContext) => Promise<AppModule>;
  resolveMountPoint?: (ctx: AppContext) => Element | null;
  shared?: SharedScope;
  onError?: (error: unknown, ctx: ShellErrorContext) => void | Promise<void>;
  onWarning?: (warning: ShellWarningContext) => void | Promise<void>;
}

export interface ShellErrorContext {
  phase: "resolve" | "load" | "init" | "mount" | "hydrate" | "unmount";
  app: AppContext;
}

export type ShellWarningContext = never;

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
