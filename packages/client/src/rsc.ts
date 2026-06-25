import {
  BUILD_IDENTIFIER_DESCRIPTION,
  formatContentTypeHeaderValue,
  getPathPatternValidationError,
  isBuildIdentifier,
  isRscFlightContentType,
  type PathPatternValidationError,
  RSC_FLIGHT_CONTENT_TYPE,
} from "@evjs/shared";
import type {
  AssetGroup,
  BuildOutput,
  PublicPathOutput,
} from "@evjs/shared/manifest";
import { createElement, type ReactNode, Suspense } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import {
  assertRscFlightFetchOptions,
  fetchRscFlight,
  getRscFetchResponseContentType,
  type RscFlightFetchOptions,
} from "./react.js";
import { formatErrorDetail, isRecord } from "./validation.js";

export interface ReactRscModelOptions extends RscFlightFetchOptions {
  moduleBaseURL?: string;
}

export interface ReactRscMountOptions extends ReactRscModelOptions {
  mount: string | Element;
  document?: Document;
  fallback?: ReactNode;
  hydrate?: boolean;
}

export interface ReactRscRuntimeBootstrap {
  version: 1;
  buildId: string;
  pageId: string;
  endpoint: string;
  basePath?: string;
  publicPath?: PublicPathOutput;
  mount: string;
  page?: {
    assets?: AssetGroup;
    routeId?: string;
  };
}

const rootByMountPoint = new WeakMap<Element, Root>();
const RSC_BOOTSTRAP_SCRIPT_ID = "__EVJS_RSC_BOOTSTRAP__";
const RSC_BOOTSTRAP_RENDERER_ID = "evjs-rsc-bootstrap";
let runtimeStarted = false;
let runtimeStarting = false;

export async function createReactRscModel(
  options: ReactRscModelOptions,
): Promise<ReactNode> {
  assertReactRscModelOptions(options);
  const { createFromFetch } = await loadReactServerDomClient();
  return createFromFetch(fetchRscModelFlight(options), {
    moduleBaseURL: options.moduleBaseURL,
  }) as ReactNode;
}

async function fetchRscModelFlight(
  options: RscFlightFetchOptions,
): Promise<Response> {
  const response = await fetchRscFlight(options);
  if (!response.ok) return response;

  const contentType = getRscFetchResponseContentType(response);
  if (isRscFlightContentType(contentType)) {
    return response;
  }

  throw new Error(
    `[evjs] RSC Flight response Content-Type must be "${RSC_FLIGHT_CONTENT_TYPE}"; received ${formatContentTypeHeaderValue(
      contentType,
    )}.`,
  );
}

async function loadReactServerDomClient(): Promise<
  typeof import("react-server-dom-webpack/client")
> {
  try {
    return await import("react-server-dom-webpack/client");
  } catch {
    throw new Error(
      "[evjs] RSC client runtime requires react-server-dom-webpack. Install it in the application or use an adapter that provides RSC support.",
    );
  }
}

function assertReactRscModelOptions(
  options: unknown,
): asserts options is ReactRscModelOptions {
  const modelOptions = options as { moduleBaseURL?: unknown };
  assertRscFlightFetchOptions(options);
  if (
    modelOptions.moduleBaseURL !== undefined &&
    (typeof modelOptions.moduleBaseURL !== "string" ||
      !modelOptions.moduleBaseURL.trim())
  ) {
    throw new Error(
      "[evjs] createReactRscModel() moduleBaseURL must be a non-empty string when provided.",
    );
  }
  if (
    typeof modelOptions.moduleBaseURL === "string" &&
    modelOptions.moduleBaseURL.trim() !== modelOptions.moduleBaseURL
  ) {
    throw new Error(
      "[evjs] createReactRscModel() moduleBaseURL must not include leading or trailing whitespace.",
    );
  }
}

export async function mountReactRscPage(
  options: ReactRscMountOptions,
): Promise<ReactNode> {
  assertReactRscMountOptions(options);
  const mountPoint = resolveMountPoint(options.mount, options.document);
  const model = await createReactRscModel(options);
  const element = createRscRootElement(model, options);
  unmountMountedRscRoot(mountPoint);
  const root = mountRscRoot(mountPoint, element, options);
  rootByMountPoint.set(mountPoint, root);
  return model;
}

function mountRscRoot(
  mountPoint: Element,
  element: ReactNode,
  options: ReactRscMountOptions,
): Root {
  if (options.hydrate !== false) {
    try {
      return hydrateRoot(mountPoint, element);
    } catch (error) {
      throw new Error(
        `[evjs] RSC hydrateRoot failed${formatErrorDetail(error)}`,
      );
    }
  }

  let root: Root;
  try {
    root = createRoot(mountPoint);
  } catch (error) {
    throw new Error(`[evjs] RSC createRoot failed${formatErrorDetail(error)}`);
  }

  try {
    root.render(element);
  } catch (error) {
    tryUnmountRscRoot(root);
    throw new Error(`[evjs] RSC root.render failed${formatErrorDetail(error)}`);
  }
  return root;
}

function createRscRootElement(
  model: ReactNode,
  options: ReactRscMountOptions,
): ReactNode {
  if (options.hydrate !== false) return model;
  if (options.fallback === undefined) return model;
  return createElement(Suspense, { fallback: options.fallback }, model);
}

export function unmountReactRscPage(mount: string | Element): void {
  const mountPoint = resolveMountPoint(mount);
  unmountMountedRscRoot(mountPoint);
}

function unmountMountedRscRoot(mountPoint: Element): void {
  const root = rootByMountPoint.get(mountPoint);
  if (!root) return;
  rootByMountPoint.delete(mountPoint);
  try {
    root.unmount();
  } catch (error) {
    throw new Error(
      `[evjs] RSC root.unmount failed${formatErrorDetail(error)}`,
    );
  }
}

function tryUnmountRscRoot(root: Root): void {
  try {
    root.unmount();
  } catch {
    // Preserve the render failure as the primary error.
  }
}

export async function startReactRscPageRuntime(
  options: { document?: Document; bootstrap?: ReactRscRuntimeBootstrap } = {},
): Promise<ReactNode | undefined> {
  assertReactRscRuntimeOptions(options);
  const doc =
    options.document === undefined ? globalThis.document : options.document;
  const bootstrap =
    options.bootstrap ?? readRscBootstrap(resolveBootstrapDocument(doc));
  if (!bootstrap) return undefined;
  assertRscBootstrap(bootstrap);
  const runtimeDocument = resolveRscDocument(doc);

  const model = await mountReactRscPage({
    manifest: createBootstrapManifest(bootstrap),
    pageId: bootstrap.pageId,
    moduleBaseURL: publicPathModuleBaseURL(
      bootstrap.publicPath,
      runtimeDocument,
    ),
    mount: bootstrap.mount,
    document: runtimeDocument,
    url: runtimeDocument.location?.href,
  });
  runtimeStarted = true;
  return model;
}

function publicPathModuleBaseURL(
  publicPath: PublicPathOutput | undefined,
  document: Document,
): string | undefined {
  if (!publicPath || publicPath === "auto") return undefined;
  try {
    return new URL(
      publicPath,
      document.baseURI || document.location?.href,
    ).toString();
  } catch {
    return publicPath;
  }
}

function resolveMountPoint(
  mount: string | Element,
  doc: Document | undefined = globalThis.document,
): Element {
  assertRscMountOption(mount);
  if (typeof mount !== "string") return mount;
  const document = resolveRscDocument(doc);
  let mountPoint: unknown;
  try {
    mountPoint = document.querySelector(mount);
  } catch (error) {
    throw new Error(
      `[evjs] RSC mount selector "${mount}" is invalid${formatErrorDetail(error)}`,
    );
  }
  if (mountPoint === null || mountPoint === undefined) {
    throw new Error(`[evjs] RSC mount point "${mount}" was not found.`);
  }
  return assertResolvedRscMountPoint(mountPoint, `mount selector "${mount}"`);
}

function assertReactRscMountOptions(
  options: unknown,
): asserts options is ReactRscMountOptions {
  if (!isRecord(options)) {
    throw new Error("[evjs] mountReactRscPage() options must be an object.");
  }
  assertRscMountOption(options.mount);
  if (options.hydrate !== undefined && typeof options.hydrate !== "boolean") {
    throw new Error("[evjs] mountReactRscPage() hydrate must be a boolean.");
  }
}

function assertReactRscRuntimeOptions(options: unknown): asserts options is {
  document?: Document;
  bootstrap?: ReactRscRuntimeBootstrap;
} {
  if (!isRecord(options)) {
    throw new Error(
      "[evjs] startReactRscPageRuntime() options must be an object.",
    );
  }
}

function assertRscMountOption(
  value: unknown,
): asserts value is string | Element {
  if (typeof value === "string") {
    if (!value.trim()) {
      throw new Error("[evjs] RSC mount must be a non-empty selector string.");
    }
    if (value.trim() !== value) {
      throw new Error(
        "[evjs] RSC mount must not include leading or trailing whitespace.",
      );
    }
    return;
  }
  if (!isRecord(value)) {
    throw new Error("[evjs] RSC mount must be a selector string or Element.");
  }
}

function assertResolvedRscMountPoint(value: unknown, source: string): Element {
  if (isRecord(value)) return value as unknown as Element;
  throw new Error(`[evjs] RSC ${source} must resolve to an Element.`);
}

function resolveBootstrapDocument(
  document: Document | undefined,
): Document | undefined {
  if (document === undefined) return undefined;
  if (!isRecord(document)) {
    throw new Error("[evjs] RSC runtime document must be an object.");
  }
  if (typeof document.getElementById !== "function") {
    throw new Error(
      "[evjs] RSC runtime document.getElementById must be a function.",
    );
  }
  return document as Document;
}

function resolveRscDocument(document: Document | undefined): Document {
  if (!isRecord(document)) {
    throw new Error(
      "[evjs] RSC runtime document must be available or provided.",
    );
  }
  if (typeof document.querySelector !== "function") {
    throw new Error(
      "[evjs] RSC runtime document.querySelector must be a function.",
    );
  }
  return document as Document;
}

function readRscBootstrap(
  document: Document | undefined,
): ReactRscRuntimeBootstrap | undefined {
  const text = document?.getElementById(RSC_BOOTSTRAP_SCRIPT_ID)?.textContent;
  if (!text) return undefined;
  const json = text.trim();
  if (!json) return undefined;

  try {
    const value = JSON.parse(json) as unknown;
    assertRscBootstrap(value);
    return value;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("[evjs]")) {
      throw error;
    }
    throw new Error(
      `[evjs] Failed to parse RSC bootstrap "${RSC_BOOTSTRAP_SCRIPT_ID}" as JSON${formatErrorDetail(error)}`,
    );
  }
}

function assertRscBootstrap(
  value: unknown,
): asserts value is ReactRscRuntimeBootstrap {
  const source = `RSC bootstrap "${RSC_BOOTSTRAP_SCRIPT_ID}"`;
  if (!isRecord(value)) {
    throw new Error(`[evjs] ${source} must be a JSON object.`);
  }
  if (value.version !== 1) {
    throw new Error(`[evjs] ${source} version must be 1.`);
  }
  assertBootstrapBuildIdentifier(value.buildId, `${source} buildId`);
  assertBootstrapBuildIdentifier(value.pageId, `${source} pageId`);
  assertBootstrapPathname(value.endpoint, `${source} endpoint`);
  assertBootstrapString(value.mount, `${source} mount`);

  if (value.basePath !== undefined) {
    assertBootstrapPathname(value.basePath, `${source} basePath`);
  }
  if (value.publicPath !== undefined) {
    assertBootstrapPublicPath(value.publicPath, `${source} publicPath`);
  }
  if (value.page !== undefined) {
    assertBootstrapPage(value.page, `${source} page`);
  }
}

function assertBootstrapPage(value: unknown, path: string): void {
  if (!isRecord(value)) {
    throw new Error(`[evjs] ${path} must be an object.`);
  }
  if (value.assets !== undefined) {
    assertBootstrapAssets(value.assets, `${path}.assets`);
  }
  if (value.routeId !== undefined) {
    assertBootstrapTrimmedString(value.routeId, `${path}.routeId`);
  }
}

function assertBootstrapPublicPath(value: unknown, path: string): void {
  assertBootstrapTrimmedString(value, path);
}

function assertBootstrapAssets(value: unknown, path: string): void {
  if (!isRecord(value)) {
    throw new Error(`[evjs] ${path} must be an object.`);
  }
  assertBootstrapStringArray(value.js, `${path}.js`);
  assertBootstrapStringArray(value.css, `${path}.css`);
}

function assertBootstrapStringArray(value: unknown, path: string): void {
  if (!Array.isArray(value)) {
    throw new Error(`[evjs] ${path} must contain only non-empty strings.`);
  }
  for (const item of value) {
    if (typeof item !== "string" || !item) {
      throw new Error(`[evjs] ${path} must contain only non-empty strings.`);
    }
    if (item.trim() !== item) {
      throw new Error(
        `[evjs] ${path} item "${item}" must not contain leading or trailing whitespace.`,
      );
    }
  }
}

function assertBootstrapTrimmedString(value: unknown, path: string): string {
  const stringValue = assertBootstrapString(value, path);
  if (stringValue.trim() !== stringValue) {
    throw new Error(
      `[evjs] ${path} must not contain leading or trailing whitespace.`,
    );
  }
  return stringValue;
}

function assertBootstrapString(value: unknown, path: string): string {
  if (typeof value === "string" && value) return value;
  throw new Error(`[evjs] ${path} must be a non-empty string.`);
}

function assertBootstrapBuildIdentifier(value: unknown, path: string): string {
  const identifier = assertBootstrapTrimmedString(value, path);
  if (isBuildIdentifier(identifier)) return identifier;
  throw new Error(
    `[evjs] ${path} must contain only ${BUILD_IDENTIFIER_DESCRIPTION}.`,
  );
}

function assertBootstrapPathname(value: unknown, path: string): string {
  const pathname = assertBootstrapTrimmedString(value, path);

  const error = getPathPatternValidationError(pathname);
  if (error) {
    throw new Error(`[evjs] ${path} ${formatBootstrapPathnameError(error)}`);
  }
  return pathname;
}

function formatBootstrapPathnameError(
  error: PathPatternValidationError,
): string {
  switch (error) {
    case "empty":
      return "must be a non-empty string.";
    case "missing-leading-slash":
      return 'must start with "/".';
    case "whitespace":
      return "must not contain whitespace.";
    case "query-or-hash":
      return "must not include a query string or hash.";
  }
}

function createBootstrapManifest(
  bootstrap: ReactRscRuntimeBootstrap,
): BuildOutput {
  const basePath = bootstrap.basePath ?? "/__evjs";
  return {
    version: 1,
    buildId: bootstrap.buildId,
    distDir: "dist",
    paths: {
      rootDir: "dist",
      publicDir: "dist/client",
      serverDir: "dist/server",
    },
    publicPath: bootstrap.publicPath ?? "auto",
    runtime: {
      server: {
        basePath,
        fn: joinEndpoint(basePath, "fn"),
        rsc: bootstrap.endpoint,
      },
      transport: {},
    },
    assets: {},
    apps: {},
    pages: {
      [bootstrap.pageId]: {
        assets: bootstrap.page?.assets ?? { js: [], css: [] },
        render: "ssr",
        componentModel: "rsc",
        rendering: {
          component: "rsc",
          html: "server",
          streaming: true,
          hydrate: "none",
        },
        routeId: bootstrap.page?.routeId,
      },
    },
    routes: [],
    server: {
      assets: { js: [], css: [] },
      renderers: {
        [RSC_BOOTSTRAP_RENDERER_ID]: {
          kind: "rsc-page",
          owner: { pageId: bootstrap.pageId },
          module: "@evjs/client/rsc-bootstrap",
          assets: bootstrap.page?.assets ?? { js: [], css: [] },
        },
      },
      functions: {},
      routes: [],
    },
    rsc: {
      endpoint: bootstrap.endpoint,
      pages: {
        [bootstrap.pageId]: {
          renderer: RSC_BOOTSTRAP_RENDERER_ID,
          assets: bootstrap.page?.assets ?? { js: [], css: [] },
        },
      },
    },
  };
}

function joinEndpoint(basePath: string, name: string): string {
  return `/${basePath.split("/").concat(name).filter(Boolean).join("/")}`;
}

function scheduleRscRuntimeStart(): void {
  if (runtimeStarted || typeof document === "undefined") return;

  const start = () => {
    if (runtimeStarted || runtimeStarting) return;
    runtimeStarting = true;
    void startReactRscPageRuntime()
      .catch((error: unknown) => {
        console.error("[evjs] RSC page runtime failed to start.", error);
      })
      .finally(() => {
        runtimeStarting = false;
      });
  };

  if (typeof queueMicrotask === "function") {
    queueMicrotask(start);
    return;
  }

  void Promise.resolve().then(start);
}

scheduleRscRuntimeStart();
