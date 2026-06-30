import type {
  ClientRuntime,
  ClientRuntimeApp,
  ClientRuntimePage,
} from "../../shared/runtime-config.js";

export interface AppModule {
  init?: (ctx: AppContext) => void | Promise<void>;
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
  runtime: ClientRuntime;
  output: ClientRuntimeApp | ClientRuntimePage;
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
  runtime: ClientRuntime;
  drivers?: ShellDriver[];
  loadModule?: (href: string, ctx: AppContext) => Promise<AppModule>;
  resolveMountPoint?: (ctx: AppContext) => Element | null;
  onError?: (error: unknown, ctx: ShellErrorContext) => void | Promise<void>;
  onWarning?: (warning: ShellWarningContext) => void | Promise<void>;
}

export interface ShellErrorContext {
  phase: "resolve" | "load" | "init" | "mount" | "hydrate" | "unmount";
  app: AppContext;
}

export type ShellWarningContext = never;

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
  runtime: ClientRuntime;
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
