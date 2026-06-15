import {
  BUILD_IDENTIFIER_DESCRIPTION,
  getPathPatternListValidationError,
  getSharedVersionRangeValidationError,
  isBuildIdentifier,
  type PathPatternListValidationError,
  type PathPatternValidationError,
  SHARED_VERSION_RANGE_DESCRIPTION,
} from "@evjs/shared";
import type {
  AssetGroup,
  RemoteEntry,
  RemoteManifest,
  RemoteOutput,
  RuntimeModuleOutput,
  SharedDependencyMap,
} from "@evjs/shared/manifest";
import {
  assertFetchErrorResponseStatus,
  assertFetchResponseJson,
  assertFetchResponseJsonContentType,
  assertFetchResponseObject,
  type FetchResponseObject,
  formatFetchErrorResponseDetail,
  readFetchErrorResponseBody,
} from "../fetch-response.js";
import { readRegisteredModule, resolveBrowserHref } from "./registry.js";
import { resolveRemoteHref } from "./routing.js";
import type { AppContext, AppModule } from "./types.js";

const loadingScripts = new Map<string, Promise<void>>();
const loadingStylesheets = new Map<string, Promise<void>>();
const stylesheetReferences = new Map<
  string,
  { count: number; element?: HTMLLinkElement }
>();

export async function defaultLoadModule(
  href: string,
  ctx: AppContext,
): Promise<AppModule> {
  const registered = await readRegisteredModule(href, ctx);
  if (registered) return registered;

  await loadScriptAsset(href);

  const loaded = await readRegisteredModule(href, ctx);
  if (loaded) return loaded;

  throw new Error(
    `[evjs] Shell module script "${href}" loaded but did not register a module. ` +
      `Call registerShellModule("${href}", module) from the built entry or pass loadModule to createShell().`,
  );
}

export async function defaultLoadRemoteManifest(
  remote: RemoteOutput,
): Promise<RemoteManifest> {
  const errorPrefix = getRemoteManifestFetchErrorPrefix(remote.manifest);
  const fetchImpl = globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error(`${errorPrefix}: fetch is not available.`);
  }

  let response: unknown;
  try {
    response = await fetchImpl(remote.manifest);
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
  const manifest = await parseRemoteManifestJson(response, remote.manifest);
  return normalizeAndValidateRemoteManifest(remote.manifest, manifest);
}

async function parseRemoteManifestJson(
  response: FetchResponseObject & { json: () => Promise<unknown> },
  manifestUrl: string,
): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch (error) {
    const detail =
      error instanceof Error && error.message ? `: ${error.message}` : ".";
    throw new Error(
      `[evjs] Failed to parse remote manifest "${manifestUrl}" as JSON${detail}`,
    );
  }
}

function getRemoteManifestFetchErrorPrefix(manifestUrl: string): string {
  return `[evjs] Failed to load remote manifest "${manifestUrl}"`;
}

export function normalizeAndValidateRemoteManifest(
  manifestUrl: string,
  manifest: unknown,
): RemoteManifest {
  return validateRemoteManifest(
    manifestUrl,
    normalizeRemoteManifest(manifestUrl, manifest),
  );
}

function normalizeRemoteManifest(
  manifestUrl: string,
  manifest: unknown,
): Record<string, unknown> {
  if (!isObjectRecord(manifest)) {
    throw new Error(
      `[evjs] Remote manifest "${manifestUrl}" must be a JSON object.`,
    );
  }
  if (isLocalRemoteManifestUrl(manifestUrl)) {
    return {
      ...manifest,
      baseUrl: resolveRemoteManifestBaseUrl(manifestUrl),
    };
  }
  return {
    ...manifest,
    baseUrl: normalizeRemoteManifestBaseUrl(manifestUrl, manifest.baseUrl),
  };
}

function validateRemoteManifest(
  manifestUrl: string,
  manifest: Record<string, unknown>,
): RemoteManifest {
  if (manifest.version !== 1) {
    throwRemoteManifestError(manifestUrl, "version must be 1.");
  }
  const name = assertManifestBuildIdentifier(
    manifest.name,
    manifestUrl,
    "name",
  );
  const baseUrl = assertManifestNonEmptyString(
    manifest.baseUrl,
    manifestUrl,
    "baseUrl",
  );

  if (!isObjectRecord(manifest.entries)) {
    throwRemoteManifestError(manifestUrl, "entries must be an object.");
  }
  const entries = Object.entries(manifest.entries);
  if (entries.length === 0) {
    throwRemoteManifestError(
      manifestUrl,
      "entries must declare at least one remote entry.",
    );
  }
  const activeWhenOwners = new Map<string, string>();
  const remoteEntries: RemoteManifest["entries"] = {};
  for (const [entryId, entry] of entries) {
    if (!entryId.trim()) {
      throwRemoteManifestError(
        manifestUrl,
        "entries must not contain empty keys.",
      );
    }
    assertManifestBuildIdentifier(
      entryId,
      manifestUrl,
      `entries key "${entryId}"`,
    );
    const path = `entries.${entryId}`;
    const remoteEntry = validateRemoteManifestEntry(
      manifestUrl,
      path,
      entry,
      baseUrl,
    );
    registerManifestActiveWhenPatterns(
      manifestUrl,
      remoteEntry.activeWhen,
      `${path}.activeWhen`,
      activeWhenOwners,
    );
    remoteEntries[entryId] = remoteEntry;
  }

  const shared =
    manifest.shared === undefined
      ? undefined
      : validateRemoteManifestShared(manifestUrl, manifest.shared);

  return {
    version: 1,
    name,
    baseUrl,
    ...(shared !== undefined ? { shared } : {}),
    entries: remoteEntries,
  };
}

function validateRemoteManifestEntry(
  manifestUrl: string,
  path: string,
  entry: unknown,
  baseUrl: string,
): RemoteEntry {
  if (!isObjectRecord(entry)) {
    throwRemoteManifestPathError(manifestUrl, path, "must be an object.");
  }
  if (!isObjectRecord(entry.module)) {
    throwRemoteManifestPathError(
      manifestUrl,
      `${path}.module`,
      "must be an object.",
    );
  }

  const module = entry.module;
  const type = module.type;
  if (type !== "entry" && type !== "lifecycle" && type !== "react-component") {
    throwRemoteManifestPathError(
      manifestUrl,
      `${path}.module.type`,
      'must be "entry", "lifecycle", or "react-component".',
    );
  }
  const moduleHref = assertManifestNonEmptyString(
    module.href,
    manifestUrl,
    `${path}.module.href`,
  );
  assertRemoteHrefResolvable(
    moduleHref,
    baseUrl,
    manifestUrl,
    `${path}.module.href`,
  );
  const runtimeModule: RuntimeModuleOutput = {
    type,
    href: moduleHref,
  };

  const assets =
    entry.assets === undefined
      ? undefined
      : validateRemoteManifestAssets(
          manifestUrl,
          `${path}.assets`,
          entry.assets,
          baseUrl,
        );
  const activeWhen =
    entry.activeWhen === undefined
      ? undefined
      : assertManifestActiveWhenPatterns(
          entry.activeWhen,
          manifestUrl,
          `${path}.activeWhen`,
        );
  const mount =
    entry.mount === undefined
      ? undefined
      : assertManifestNonEmptyString(entry.mount, manifestUrl, `${path}.mount`);
  return {
    ...(assets !== undefined ? { assets } : {}),
    module: runtimeModule,
    ...(activeWhen !== undefined ? { activeWhen } : {}),
    ...(mount !== undefined ? { mount } : {}),
  };
}

function validateRemoteManifestAssets(
  manifestUrl: string,
  path: string,
  assets: unknown,
  baseUrl: string,
): AssetGroup {
  if (!isObjectRecord(assets)) {
    throwRemoteManifestPathError(manifestUrl, path, "must be an object.");
  }
  const jsAssets = assertManifestStringArray(
    assets.js,
    manifestUrl,
    `${path}.js`,
  );
  const cssAssets = assertManifestStringArray(
    assets.css,
    manifestUrl,
    `${path}.css`,
  );

  for (const asset of jsAssets) {
    assertRemoteHrefResolvable(asset, baseUrl, manifestUrl, `${path}.js`);
  }
  for (const asset of cssAssets) {
    assertRemoteHrefResolvable(asset, baseUrl, manifestUrl, `${path}.css`);
  }
  return {
    js: [...jsAssets],
    css: [...cssAssets],
  };
}

function validateRemoteManifestShared(
  manifestUrl: string,
  shared: unknown,
): SharedDependencyMap {
  if (!isObjectRecord(shared)) {
    throwRemoteManifestPathError(manifestUrl, "shared", "must be an object.");
  }
  const sharedDependencies: SharedDependencyMap = {};
  for (const [name, dependency] of Object.entries(shared)) {
    if (!name.trim()) {
      throwRemoteManifestError(
        manifestUrl,
        "shared must not contain empty keys.",
      );
    }
    const path = `shared.${name}`;
    if (!isObjectRecord(dependency)) {
      throwRemoteManifestPathError(manifestUrl, path, "must be an object.");
    }
    const shareKey =
      dependency.shareKey === undefined
        ? undefined
        : assertManifestNonEmptyString(
            dependency.shareKey,
            manifestUrl,
            `${path}.shareKey`,
          );
    const requiredVersion =
      dependency.requiredVersion === undefined
        ? undefined
        : assertManifestSharedVersionRange(
            dependency.requiredVersion,
            manifestUrl,
            `${path}.requiredVersion`,
          );
    const singleton = assertManifestOptionalBoolean(
      dependency.singleton,
      manifestUrl,
      `${path}.singleton`,
    );
    const strictVersion = assertManifestOptionalBoolean(
      dependency.strictVersion,
      manifestUrl,
      `${path}.strictVersion`,
    );
    const eager = assertManifestOptionalBoolean(
      dependency.eager,
      manifestUrl,
      `${path}.eager`,
    );
    sharedDependencies[name] = {
      ...(shareKey !== undefined ? { shareKey } : {}),
      ...(requiredVersion !== undefined ? { requiredVersion } : {}),
      ...(singleton !== undefined ? { singleton } : {}),
      ...(strictVersion !== undefined ? { strictVersion } : {}),
      ...(eager !== undefined ? { eager } : {}),
    };
  }
  return sharedDependencies;
}

function assertManifestSharedVersionRange(
  value: unknown,
  manifestUrl: string,
  path: string,
): string {
  const error = getSharedVersionRangeValidationError(value);
  if (!error) return value as string;
  if (error === "empty") {
    throwRemoteManifestPathError(
      manifestUrl,
      path,
      "must be a non-empty string.",
    );
  }
  if (error === "whitespace") {
    throwRemoteManifestPathError(
      manifestUrl,
      path,
      "must not contain leading or trailing whitespace.",
    );
  }
  throwRemoteManifestPathError(
    manifestUrl,
    path,
    `must use ${SHARED_VERSION_RANGE_DESCRIPTION}.`,
  );
}

function assertManifestNonEmptyString(
  value: unknown,
  manifestUrl: string,
  path: string,
): string {
  if (typeof value === "string" && value.trim()) {
    if (value.trim() !== value) {
      throwRemoteManifestPathError(
        manifestUrl,
        path,
        "must not contain leading or trailing whitespace.",
      );
    }
    return value;
  }
  throwRemoteManifestPathError(
    manifestUrl,
    path,
    "must be a non-empty string.",
  );
}

function assertManifestBuildIdentifier(
  value: unknown,
  manifestUrl: string,
  path: string,
): string {
  const identifier = assertManifestNonEmptyString(value, manifestUrl, path);
  if (isBuildIdentifier(identifier)) return identifier;
  throwRemoteManifestPathError(
    manifestUrl,
    path,
    `must contain only ${BUILD_IDENTIFIER_DESCRIPTION}.`,
  );
}

function assertManifestStringArray(
  value: unknown,
  manifestUrl: string,
  path: string,
): string[] {
  if (!Array.isArray(value)) {
    throwRemoteManifestPathError(
      manifestUrl,
      path,
      "must contain only non-empty strings.",
    );
  }

  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      throwRemoteManifestPathError(
        manifestUrl,
        path,
        "must contain only non-empty strings.",
      );
    }
    if (item.trim() !== item) {
      throwRemoteManifestPathError(
        manifestUrl,
        path,
        `item "${item}" must not contain leading or trailing whitespace.`,
      );
    }
  }

  return value;
}

function assertManifestActiveWhenPatterns(
  value: unknown,
  manifestUrl: string,
  path: string,
): string[] {
  const patterns = assertManifestStringArray(value, manifestUrl, path);
  const error = getPathPatternListValidationError(patterns);
  if (error) throwManifestPathPatternListError(error, manifestUrl, path);
  return [...patterns];
}

function throwManifestPathPatternListError(
  error: PathPatternListValidationError,
  manifestUrl: string,
  path: string,
): never {
  switch (error.kind) {
    case "not-array":
      return throwRemoteManifestPathError(
        manifestUrl,
        path,
        "must contain only non-empty strings.",
      );
    case "empty-array":
      return throwRemoteManifestPathError(
        manifestUrl,
        path,
        "must contain at least one path.",
      );
    case "duplicate-pattern":
      return throwRemoteManifestPathError(
        manifestUrl,
        path,
        `must not contain duplicate pattern "${error.pattern}".`,
      );
    case "invalid-pattern":
      return throwManifestPathPatternError(
        error.value,
        error.error,
        manifestUrl,
        path,
      );
  }
}

function throwManifestPathPatternError(
  value: unknown,
  error: PathPatternValidationError,
  manifestUrl: string,
  path: string,
): never {
  if (error === "empty" || typeof value !== "string") {
    throwRemoteManifestPathError(
      manifestUrl,
      path,
      "must contain only non-empty strings.",
    );
  }
  if (error === "whitespace") {
    throwRemoteManifestPathError(
      manifestUrl,
      path,
      `pattern "${value}" must not contain whitespace.`,
    );
  }
  if (error === "missing-leading-slash") {
    throwRemoteManifestPathError(
      manifestUrl,
      path,
      `pattern "${value}" must start with "/".`,
    );
  }
  throwRemoteManifestPathError(
    manifestUrl,
    path,
    `pattern "${value}" must not include a query string or hash.`,
  );
}

function registerManifestActiveWhenPatterns(
  manifestUrl: string,
  patterns: string[] | undefined,
  path: string,
  owners: Map<string, string>,
): void {
  for (const pattern of patterns ?? []) {
    const existing = owners.get(pattern);
    if (existing) {
      throwRemoteManifestPathError(
        manifestUrl,
        path,
        `duplicates ${existing} pattern "${pattern}". Remote entry activeWhen patterns must be unique.`,
      );
    }
    owners.set(pattern, path);
  }
}

function assertManifestOptionalBoolean(
  value: unknown,
  manifestUrl: string,
  path: string,
): boolean | undefined {
  if (value === undefined || typeof value === "boolean") return value;
  throwRemoteManifestPathError(
    manifestUrl,
    path,
    "must be a boolean when provided.",
  );
}

function normalizeRemoteManifestBaseUrl(
  manifestUrl: string,
  value: unknown,
): string {
  if (typeof value !== "string" || !value.trim()) {
    return resolveRemoteManifestBaseUrl(manifestUrl);
  }
  if (value.trim() !== value) return value;

  try {
    const baseUrl = new URL(value, resolveRemoteManifestBaseUrl(manifestUrl));
    if (isHttpRemoteUrl(baseUrl)) return baseUrl.toString();
  } catch {}

  throwRemoteManifestPathError(
    manifestUrl,
    "baseUrl",
    `must be an http(s) URL resolvable from manifest URL "${manifestUrl}".`,
  );
}

function assertRemoteHrefResolvable(
  href: string,
  baseUrl: string,
  manifestUrl: string,
  path: string,
): void {
  try {
    const url = new URL(resolveRemoteHref(baseUrl, href));
    if (isHttpRemoteUrl(url)) return;
  } catch {}

  throwRemoteManifestPathError(
    manifestUrl,
    path,
    `must be an http(s) URL resolvable from baseUrl "${baseUrl}".`,
  );
}

function isHttpRemoteUrl(url: URL): boolean {
  return url.protocol === "http:" || url.protocol === "https:";
}

function formatErrorDetail(error: unknown): string {
  return error instanceof Error && error.message ? `: ${error.message}` : ".";
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function throwRemoteManifestPathError(
  manifestUrl: string,
  path: string,
  message: string,
): never {
  throwRemoteManifestError(manifestUrl, `${path} ${message}`);
}

function throwRemoteManifestError(manifestUrl: string, message: string): never {
  throw new Error(`[evjs] Remote manifest "${manifestUrl}" ${message}`);
}

export async function loadRemoteStylesheets(
  ctx: AppContext,
): Promise<string[]> {
  if (ctx.kind !== "remote" || !ctx.remote) return [];

  const remote = ctx.remote;
  const cssAssets = remote.entry.assets?.css ?? [];
  if (cssAssets.length === 0) return [];

  const hrefs = [
    ...new Set(
      cssAssets.map((asset) =>
        resolveRemoteHref(remote.manifest.baseUrl, asset),
      ),
    ),
  ];
  return Promise.all(hrefs.map((href) => acquireStylesheetAsset(href)));
}

export function releaseStylesheets(hrefs: string[]): void {
  for (const href of hrefs) {
    const reference = stylesheetReferences.get(href);
    if (!reference) continue;

    reference.count -= 1;
    if (reference.count > 0) continue;

    try {
      removeShellStylesheetElement(href, reference.element);
    } finally {
      stylesheetReferences.delete(href);
      loadingStylesheets.delete(href);
    }
  }
}

async function loadScriptAsset(href: string): Promise<void> {
  const doc = globalThis.document;
  if (!doc) {
    throw new Error(
      `[evjs] Shell cannot load "${href}" outside a browser document. Pass loadModule to createShell().`,
    );
  }
  assertShellAssetDocument(doc, href, "module script");

  let promise = loadingScripts.get(href);
  if (!promise) {
    promise = new Promise<void>((resolve, reject) => {
      const script = createShellAssetElement<HTMLScriptElement>(
        doc,
        "script",
        href,
        "module script",
      );
      script.async = true;
      script.src = href;
      script.setAttribute?.("data-evjs-shell-load", "true");
      script.onload = () => resolve();
      script.onerror = () =>
        reject(
          new Error(`[evjs] Failed to load shell module script "${href}".`),
        );
      appendShellAssetElement(doc, script, href, "module script");
    }).catch((error) => {
      loadingScripts.delete(href);
      throw error;
    });
    loadingScripts.set(href, promise);
  }

  await promise;
}

async function acquireStylesheetAsset(href: string): Promise<string> {
  const doc = globalThis.document;
  if (!doc) {
    throw new Error(
      `[evjs] Shell cannot load stylesheet "${href}" outside a browser document.`,
    );
  }
  assertShellAssetDocument(doc, href, "stylesheet");

  const current = stylesheetReferences.get(href);
  if (current) {
    current.count += 1;
    await loadingStylesheets.get(href);
    return href;
  }

  const existing = findManagedStylesheet(doc, href);
  if (existing) {
    stylesheetReferences.set(href, {
      count: 1,
      element: existing,
    });
    return href;
  }

  let element: HTMLLinkElement | undefined;
  let promise = loadingStylesheets.get(href);
  if (!promise) {
    promise = new Promise<void>((resolve, reject) => {
      const link = createShellAssetElement<HTMLLinkElement>(
        doc,
        "link",
        href,
        "stylesheet",
      );
      element = link;
      link.rel = "stylesheet";
      link.href = href;
      link.setAttribute?.("data-evjs-shell-style", "true");
      link.onload = () => resolve();
      link.onerror = () =>
        reject(new Error(`[evjs] Failed to load shell stylesheet "${href}".`));
      appendShellAssetElement(doc, link, href, "stylesheet");
    }).catch((error) => {
      loadingStylesheets.delete(href);
      stylesheetReferences.delete(href);
      throw error;
    });
    loadingStylesheets.set(href, promise);
    stylesheetReferences.set(href, {
      count: 1,
      element,
    });
  }

  await promise;
  return href;
}

function assertShellAssetDocument(
  doc: Document,
  href: string,
  assetKind: "module script" | "stylesheet",
): asserts doc is Document & {
  createElement: Document["createElement"];
  head: NonNullable<Document["head"]> & {
    appendChild: NonNullable<Document["head"]>["appendChild"];
  };
} {
  if (typeof doc.createElement !== "function") {
    throw new Error(
      `[evjs] Shell cannot load ${assetKind} "${href}": document.createElement must be a function.`,
    );
  }
  if (!isObjectRecord(doc.head) || typeof doc.head.appendChild !== "function") {
    throw new Error(
      `[evjs] Shell cannot load ${assetKind} "${href}": document.head.appendChild must be a function.`,
    );
  }
}

function createShellAssetElement<T extends Element>(
  doc: Document,
  tagName: string,
  href: string,
  assetKind: "module script" | "stylesheet",
): T {
  const element = doc.createElement(tagName);
  if (!isObjectRecord(element)) {
    throw new Error(
      `[evjs] Shell cannot load ${assetKind} "${href}": document.createElement("${tagName}") must return an element.`,
    );
  }
  return element as T;
}

function appendShellAssetElement(
  doc: Document & {
    head: NonNullable<Document["head"]> & {
      appendChild: NonNullable<Document["head"]>["appendChild"];
    };
  },
  element: Element,
  href: string,
  assetKind: "module script" | "stylesheet",
): void {
  try {
    doc.head.appendChild(element);
  } catch (error) {
    throw new Error(
      `[evjs] Shell cannot load ${assetKind} "${href}": document.head.appendChild failed${formatErrorDetail(error)}`,
    );
  }
}

function removeShellStylesheetElement(
  href: string,
  element: HTMLLinkElement | undefined,
): void {
  const remove = element?.remove as unknown;
  if (remove === undefined || remove === null) return;
  if (typeof remove !== "function") {
    throw new Error(
      `[evjs] Shell cannot release stylesheet "${href}": element.remove must be a function when provided.`,
    );
  }

  try {
    remove.call(element);
  } catch (error) {
    throw new Error(
      `[evjs] Shell cannot release stylesheet "${href}": element.remove failed${formatErrorDetail(error)}`,
    );
  }
}

function findManagedStylesheet(
  doc: Document,
  href: string,
): HTMLLinkElement | undefined {
  const querySelectorAll = doc.querySelectorAll as unknown;
  if (querySelectorAll === undefined || querySelectorAll === null) {
    return undefined;
  }
  if (typeof querySelectorAll !== "function") {
    throw new Error(
      `[evjs] Shell cannot inspect managed stylesheet "${href}": document.querySelectorAll must be a function when provided.`,
    );
  }

  const result = querySelectorAll.call(
    doc,
    "link[data-evjs-shell-style]",
  ) as unknown;
  if (!isElementList(result)) {
    throw new Error(
      `[evjs] Shell cannot inspect managed stylesheet "${href}": document.querySelectorAll must return a list of elements.`,
    );
  }

  return Array.from(result).find((link, index) => {
    if (!isObjectRecord(link) || typeof link.getAttribute !== "function") {
      throw new Error(
        `[evjs] Shell cannot inspect managed stylesheet "${href}": document.querySelectorAll result[${index}] must be an element.`,
      );
    }
    const rawHref = link.getAttribute("href");
    return rawHref === href || link.href === resolveBrowserHref(href);
  });
}

function isElementList(
  value: unknown,
): value is Iterable<HTMLLinkElement> | ArrayLike<HTMLLinkElement> {
  if (!value || typeof value !== "object") return false;
  if (
    typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] ===
    "function"
  ) {
    return true;
  }
  return typeof (value as { length?: unknown }).length === "number";
}

function isLocalRemoteManifestUrl(manifestUrl: string): boolean {
  try {
    const url = new URL(manifestUrl, globalThis.location?.href);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function resolveRemoteManifestBaseUrl(manifestUrl: string): string {
  try {
    return new URL(
      ".",
      new URL(manifestUrl, globalThis.location?.href),
    ).toString();
  } catch {
    return "/";
  }
}
