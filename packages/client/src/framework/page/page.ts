import {
  BUILD_IDENTIFIER_DESCRIPTION,
  getHttpUrlOrPathValidationError,
  isBuildIdentifier,
} from "@evjs/shared";
import { initTransportFromRuntime } from "../../server-functions/transport-runtime.js";
import {
  assertFetchErrorResponseStatus,
  assertFetchResponseJson,
  assertFetchResponseJsonContentType,
  assertFetchResponseObject,
  type FetchResponseObject,
  formatFetchErrorResponseDetail,
  readFetchErrorResponseBody,
} from "../../shared/fetch-response.js";
import {
  assertClientRuntime,
  type ClientRuntime,
} from "../../shared/runtime-config.js";
import { formatErrorDetail, isRecord } from "../../shared/validation.js";
import {
  type AppContext,
  type AppModule,
  createPageDriver,
  createShell,
  type Shell,
} from "../shell/index.js";

export interface PageRuntimeOptions {
  document?: Document;
  runtime?: ClientRuntime;
  runtimeUrl?: string;
  mount?: string | Element;
  loadModule?: (href: string, ctx: AppContext) => Promise<AppModule>;
}

const CLIENT_RUNTIME_SCRIPT_ID = "__EVJS_CLIENT_RUNTIME__";

export async function startPageRuntime(
  options: PageRuntimeOptions = {},
): Promise<Shell> {
  assertPageRuntimeOptions(options);
  const doc = resolveRuntimeDocument(options.document);
  const request = createPageDriver({ document: doc }).current();
  assertRuntimeHtmlTarget(doc);
  const runtime =
    options.runtime === undefined
      ? await loadRuntime(doc, options)
      : options.runtime;
  assertLoadedRuntime(runtime, "provided runtime");
  initTransportFromRuntime(runtime);
  const shell = createShell({
    runtime,
    loadModule: options.loadModule,
    resolveMountPoint(ctx) {
      return resolveMountPoint(doc, options.mount ?? outputMount(ctx));
    },
  });

  await shell.start(request);
  return shell;
}

async function loadRuntime(
  document: Document,
  options: PageRuntimeOptions,
): Promise<ClientRuntime> {
  const embedded = readEmbeddedRuntime(document);
  if (embedded) return embedded;

  const runtimeUrl = resolveRuntimeUrl(document, options);
  const errorPrefix = getRuntimeFetchErrorPrefix(runtimeUrl);
  const fetchImpl = globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error(`${errorPrefix}: fetch is not available.`);
  }

  let response: unknown;
  try {
    response = await fetchImpl(runtimeUrl);
  } catch (error) {
    throw new Error(`${errorPrefix}${formatErrorDetail(error)}`);
  }
  assertFetchResponseObject(response, errorPrefix);
  if (!response.ok) {
    assertFetchErrorResponseStatus(response, errorPrefix);
    const responseBody = await readFetchErrorResponseBody(response);
    throw new Error(
      `${errorPrefix}: ${formatFetchErrorResponseDetail(
        response,
        responseBody,
      )}`,
    );
  }
  assertFetchResponseJson(response, errorPrefix);
  assertFetchResponseJsonContentType(response, errorPrefix);
  return parseFetchedRuntime(response, runtimeUrl);
}

function resolveRuntimeUrl(
  document: Document,
  options: PageRuntimeOptions,
): string {
  if (options.runtimeUrl !== undefined) return options.runtimeUrl;

  const attribute = document.documentElement?.getAttribute("data-evjs-runtime");
  if (attribute === null || attribute === undefined) return "/runtime.json";
  return assertRuntimeUrl(attribute, "data-evjs-runtime", "runtime URL");
}

function readEmbeddedRuntime(document: Document): ClientRuntime | undefined {
  const script = document.getElementById(CLIENT_RUNTIME_SCRIPT_ID);
  const scriptText = script?.textContent;
  if (scriptText !== null && scriptText !== undefined) {
    if (typeof scriptText !== "string") {
      throw new Error(
        `[evjs] Embedded runtime "${CLIENT_RUNTIME_SCRIPT_ID}" textContent must be a string when provided.`,
      );
    }
  }
  const text = scriptText?.trim();
  if (!text) return undefined;

  let runtime: unknown;
  try {
    runtime = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `[evjs] Failed to parse embedded runtime "${CLIENT_RUNTIME_SCRIPT_ID}" as JSON${formatErrorDetail(error)}`,
    );
  }
  assertLoadedRuntime(
    runtime,
    `embedded runtime "${CLIENT_RUNTIME_SCRIPT_ID}"`,
  );
  return runtime;
}

async function parseFetchedRuntime(
  response: FetchResponseObject & { json: () => Promise<unknown> },
  runtimeUrl: string,
): Promise<ClientRuntime> {
  let runtime: unknown;
  try {
    runtime = await response.json();
  } catch (error) {
    throw new Error(
      `[evjs] Failed to parse runtime "${runtimeUrl}" as JSON${formatErrorDetail(error)}`,
    );
  }
  assertLoadedRuntime(runtime, `runtime "${runtimeUrl}"`);
  return runtime;
}

function getRuntimeFetchErrorPrefix(runtimeUrl: string): string {
  return `[evjs] Failed to load runtime "${runtimeUrl}"`;
}

function assertLoadedRuntime(
  runtime: unknown,
  source: string,
): asserts runtime is ClientRuntime {
  if (!isRecord(runtime)) {
    throw new Error(`[evjs] Loaded ${source} must be a JSON object.`);
  }
  if (runtime.version !== 1) {
    throw new Error(`[evjs] Loaded ${source} version must be 1.`);
  }
  if (!isRecord(runtime.runtime)) {
    throw new Error(`[evjs] Loaded ${source} runtime must be an object.`);
  }
  if (runtime.app !== undefined && !isRecord(runtime.app)) {
    throw new Error(`[evjs] Loaded ${source} app must be an object.`);
  }
  assertClientRuntime(runtime, `Loaded ${source}`);
}

function assertPageRuntimeOptions(
  options: unknown,
): asserts options is PageRuntimeOptions {
  if (!isRecord(options)) {
    throw new Error("[evjs] startPageRuntime() options must be an object.");
  }
  if (options.runtimeUrl !== undefined) {
    assertRuntimeUrl(options.runtimeUrl, "runtimeUrl", "string");
  }
  if (options.mount !== undefined) {
    assertMountOption(options.mount);
  }
  if (
    options.loadModule !== undefined &&
    typeof options.loadModule !== "function"
  ) {
    throw new Error("[evjs] startPageRuntime() loadModule must be a function.");
  }
}

function assertRuntimeUrl(
  value: unknown,
  name: string,
  emptyDescription: string,
): string {
  const error = getHttpUrlOrPathValidationError(value);
  if (!error) return value as string;

  switch (error) {
    case "empty":
      throw new Error(
        `[evjs] startPageRuntime() ${name} must be a non-empty ${emptyDescription}.`,
      );
    case "whitespace":
      throw new Error(
        `[evjs] startPageRuntime() ${name} must not include leading or trailing whitespace.`,
      );
    case "not-http-url-or-path":
      throw new Error(
        `[evjs] startPageRuntime() ${name} must be an http(s) URL or path.`,
      );
  }
}

function assertRuntimeHtmlTarget(document: Document): void {
  const root = document.documentElement;
  if (root === null || root === undefined) {
    throw new Error(
      "[evjs] startPageRuntime() document.documentElement must include data-evjs-kind and data-evjs-id attributes.",
    );
  }
  const kind = root.getAttribute("data-evjs-kind");
  if (kind !== "app" && kind !== "page") {
    throw new Error(
      '[evjs] startPageRuntime() data-evjs-kind must be "app" or "page".',
    );
  }
  const id = root.getAttribute("data-evjs-id");
  if (typeof id !== "string" || !id.trim()) {
    throw new Error(
      "[evjs] startPageRuntime() data-evjs-id must be a non-empty app/page id.",
    );
  }
  if (id.trim() !== id) {
    throw new Error(
      "[evjs] startPageRuntime() data-evjs-id must not include leading or trailing whitespace.",
    );
  }
  if (!isBuildIdentifier(id)) {
    throw new Error(
      `[evjs] startPageRuntime() data-evjs-id must contain only ${BUILD_IDENTIFIER_DESCRIPTION}.`,
    );
  }
}

function resolveRuntimeDocument(document: Document | undefined): Document {
  const resolved = document ?? globalThis.document;
  if (!isRecord(resolved)) {
    throw new Error(
      "[evjs] startPageRuntime() document must be available or provided.",
    );
  }
  if (typeof resolved.getElementById !== "function") {
    throw new Error(
      "[evjs] startPageRuntime() document.getElementById must be a function.",
    );
  }
  if (typeof resolved.querySelector !== "function") {
    throw new Error(
      "[evjs] startPageRuntime() document.querySelector must be a function.",
    );
  }
  if (
    resolved.documentElement !== undefined &&
    resolved.documentElement !== null &&
    !hasGetAttribute(resolved.documentElement)
  ) {
    throw new Error(
      "[evjs] startPageRuntime() document.documentElement.getAttribute must be a function when documentElement is provided.",
    );
  }
  return resolved as Document;
}

function hasGetAttribute(
  value: unknown,
): value is Pick<Element, "getAttribute"> {
  return isRecord(value) && typeof value.getAttribute === "function";
}

function assertMountOption(value: unknown): void {
  if (typeof value === "string") {
    if (!value.trim()) {
      throw new Error(
        "[evjs] startPageRuntime() mount must be a non-empty selector string.",
      );
    }
    if (value.trim() !== value) {
      throw new Error(
        "[evjs] startPageRuntime() mount must not include leading or trailing whitespace.",
      );
    }
    return;
  }
  if (!isRecord(value)) {
    throw new Error(
      "[evjs] startPageRuntime() mount must be a selector string or Element.",
    );
  }
}

function outputMount(ctx: AppContext): string {
  if (ctx.kind === "page" && "mount" in ctx.output && ctx.output.mount) {
    return ctx.output.mount;
  }
  return "#app";
}

function resolveMountPoint(
  document: Document,
  mount: string | Element,
): Element {
  if (typeof mount !== "string") return mount;
  let mountPoint: Element | null;
  try {
    mountPoint = document.querySelector(mount);
  } catch (error) {
    throw new Error(
      `[evjs] startPageRuntime() mount selector "${mount}" is invalid${formatErrorDetail(error)}`,
    );
  }
  return assertResolvedMountPoint(mountPoint, `mount selector "${mount}"`);
}

function assertResolvedMountPoint(value: unknown, source: string): Element {
  if (value === null) {
    throw new Error(
      `[evjs] startPageRuntime() ${source} did not match an Element.`,
    );
  }
  if (isRecord(value)) return value as unknown as Element;
  throw new Error(
    `[evjs] startPageRuntime() ${source} must resolve to an Element or null.`,
  );
}
