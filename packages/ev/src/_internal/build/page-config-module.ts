import path from "node:path";
import type {
  ComponentModel,
  CoreGraph,
  HydrationMode,
  PageMetadata,
  PrerenderConfig,
  RenderMode,
} from "@evjs/shared/manifest";
import { assertPageMetadata, clonePageMetadata } from "@evjs/shared/manifest";
import type {
  PageAnchorMetadata,
  PageRouteDiscoveryMetadata,
} from "../../config/index.js";
import {
  clearStaticConfigModuleCache,
  loadStaticConfigModule,
} from "./config-module.js";
import { validatePageRenderingContract } from "./page-rendering-contract.js";
import { assertJsonSerializable } from "./strict-json.js";

const PAGE_CONFIG_FIELDS = new Set([
  "render",
  "hydrate",
  "prerender",
  "rsc",
  "title",
  "meta",
  "extensions",
]);
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
type PageConfigMetadata = Pick<PageAnchorMetadata, "pageId"> & {
  configModule: string;
};

export interface ResolvedPageFileConfig {
  source: string;
  render?: RenderMode;
  componentModel?: ComponentModel;
  hydrate?: HydrationMode;
  prerender?: PrerenderConfig;
  metadata?: PageMetadata;
  extensions: Record<string, unknown>;
}

export interface ResolvedPageFileConfigs {
  pages: Record<string, ResolvedPageFileConfig>;
  dependencies: string[];
}

export async function resolvePageConfigModules(
  cwd: string,
  metadata: PageRouteDiscoveryMetadata | undefined,
): Promise<ResolvedPageFileConfigs> {
  return resolveKnownPageConfigModules(
    cwd,
    (metadata?.pages ?? []).flatMap((page) =>
      page.configModule
        ? [{ pageId: page.pageId, configModule: page.configModule }]
        : [],
    ),
  );
}

/** Resolve colocated Page configs already discovered by a normalized provider. */
export async function resolveCorePageConfigModules(
  cwd: string,
  graph: CoreGraph,
): Promise<ResolvedPageFileConfigs> {
  return resolveKnownPageConfigModules(
    cwd,
    Object.values(graph.pages)
      .flatMap((page) =>
        page.source.config
          ? [{ pageId: page.id, configModule: page.source.config }]
          : [],
      )
      .sort((left, right) => left.pageId.localeCompare(right.pageId)),
  );
}

async function resolveKnownPageConfigModules(
  cwd: string,
  configuredPages: PageConfigMetadata[],
): Promise<ResolvedPageFileConfigs> {
  const pages = createRecord<ResolvedPageFileConfig>();
  const dependencies = new Set<string>();
  clearStaticConfigModuleCache(
    configuredPages.map((page) => path.resolve(cwd, page.configModule)),
    { projectRoot: cwd },
  );

  for (const page of configuredPages) {
    const resolved = await resolvePageConfigModule(cwd, page);
    defineRecordValue(pages, page.pageId, resolved.config);
    for (const dependency of resolved.dependencies) {
      dependencies.add(dependency);
    }
  }

  return {
    pages,
    dependencies: [...dependencies].sort(),
  };
}

async function resolvePageConfigModule(
  cwd: string,
  page: PageConfigMetadata,
): Promise<{
  config: ResolvedPageFileConfig;
  dependencies: string[];
}> {
  const source = page.configModule;
  const loaded = await loadStaticConfigModule(path.resolve(cwd, source), cwd, {
    cache: true,
  });
  if (!loaded.hasDefaultExport) {
    throw new Error(
      `[evjs] Page "${page.pageId}" config "${source}" must default-export a Page config object.`,
    );
  }
  const value = loaded.value;
  if (!isPlainObject(value)) {
    throw new Error(
      `[evjs] Page "${page.pageId}" config "${source}" default export must be a plain object.`,
    );
  }
  assertEnumerableDataProperties(
    value,
    `Page "${page.pageId}" config "${source}"`,
  );
  for (const key of Object.keys(value)) {
    if (!PAGE_CONFIG_FIELDS.has(key)) {
      throw new Error(
        `[evjs] Page "${page.pageId}" config "${source}" has unknown field "${key}". Expected render, hydrate, prerender, rsc, title, meta, or extensions.`,
      );
    }
  }

  const render = resolveRender(value.render, page);
  const hydrate = resolveHydrate(value.hydrate, page);
  const prerender = resolvePrerender(value.prerender, page);
  const componentModel = resolveComponentModel(value.rsc, page);
  const metadata = resolvePageMetadata(value, page);
  const extensions = resolveExtensions(value.extensions, page);
  validatePageRenderingContract(
    `Page "${page.pageId}" config "${source}"`,
    {
      ...(render ? { render } : {}),
      ...(componentModel ? { componentModel } : {}),
      ...(hydrate ? { hydrate } : {}),
      ...(prerender ? { prerender } : {}),
    },
    { requireExplicitRenderForFullPrerender: true },
  );

  return {
    config: {
      source,
      ...(render ? { render } : {}),
      ...(componentModel ? { componentModel } : {}),
      ...(hydrate ? { hydrate } : {}),
      ...(prerender ? { prerender } : {}),
      ...(metadata ? { metadata } : {}),
      extensions,
    },
    dependencies: loaded.dependencies,
  };
}

function resolvePageMetadata(
  value: Record<string, unknown>,
  page: PageConfigMetadata,
): PageMetadata | undefined {
  const hasTitle = Object.hasOwn(value, "title");
  const hasMeta = Object.hasOwn(value, "meta");
  if (!hasTitle && !hasMeta) return undefined;

  const metadata = {
    ...(hasTitle ? { title: value.title } : {}),
    ...(hasMeta ? { meta: value.meta } : {}),
  };
  assertPageMetadata(
    metadata,
    `Page "${page.pageId}" config "${page.configModule}" metadata`,
  );
  return clonePageMetadata(metadata);
}

function resolveRender(
  value: unknown,
  page: PageConfigMetadata,
): RenderMode | undefined {
  if (value === undefined) return undefined;
  if (value === "csr" || value === "ssr" || value === "ssg") return value;
  throw new Error(
    `[evjs] Page "${page.pageId}" config "${page.configModule}" render must be "csr", "ssr", or "ssg".`,
  );
}

function resolveHydrate(
  value: unknown,
  page: PageConfigMetadata,
): HydrationMode | undefined {
  if (value === undefined) return undefined;
  if (
    value === "none" ||
    value === "load" ||
    value === "visible" ||
    value === "idle"
  ) {
    return value;
  }
  throw new Error(
    `[evjs] Page "${page.pageId}" config "${page.configModule}" hydrate must be "none", "load", "visible", or "idle".`,
  );
}

function resolveComponentModel(
  value: unknown,
  page: PageConfigMetadata,
): ComponentModel | undefined {
  if (value === undefined) return undefined;
  if (value === true) return "rsc";
  throw new Error(
    `[evjs] Page "${page.pageId}" config "${page.configModule}" rsc must be true when provided.`,
  );
}

function resolvePrerender(
  value: unknown,
  page: PageConfigMetadata,
): PrerenderConfig | undefined {
  if (value === undefined) return undefined;
  if (value === true) return true;
  const source = `Page "${page.pageId}" config "${page.configModule}" prerender`;
  if (!isPlainObject(value)) {
    throw new Error(`[evjs] ${source} must be true or a plain object.`);
  }
  assertEnumerableDataProperties(value, source);
  for (const key of Object.keys(value)) {
    if (key !== "partial" && key !== "delivery" && key !== "revalidate") {
      throw new Error(`[evjs] ${source} has unknown field "${key}".`);
    }
  }
  if (value.partial !== undefined && typeof value.partial !== "boolean") {
    throw new Error(`[evjs] ${source}.partial must be a boolean.`);
  }
  if (
    value.delivery !== undefined &&
    value.delivery !== "merge" &&
    value.delivery !== "stream"
  ) {
    throw new Error(`[evjs] ${source}.delivery must be "merge" or "stream".`);
  }
  if (
    value.revalidate !== undefined &&
    value.revalidate !== false &&
    (typeof value.revalidate !== "number" ||
      !Number.isInteger(value.revalidate) ||
      value.revalidate <= 0)
  ) {
    throw new Error(
      `[evjs] ${source}.revalidate must be a positive integer or false.`,
    );
  }
  assertJsonSerializable(value, source);
  return cloneJsonValue(value) as Exclude<PrerenderConfig, true>;
}

function resolveExtensions(
  value: unknown,
  page: PageConfigMetadata,
): Record<string, unknown> {
  if (value === undefined) return {};
  const source = `Page "${page.pageId}" config "${page.configModule}" extensions`;
  if (!isPlainObject(value)) {
    throw new Error(`[evjs] ${source} must be a plain object.`);
  }
  assertEnumerableDataProperties(value, source);
  for (const namespace of Object.keys(value)) {
    assertNamespacedId(namespace, `${source} key`);
  }
  assertJsonSerializable(value, source);
  return cloneJsonValue(value);
}

function assertEnumerableDataProperties(value: object, source: string): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      throw new Error(`[evjs] ${source} contains an unsupported symbol field.`);
    }
    if (UNSAFE_KEYS.has(key)) {
      throw new Error(`[evjs] ${source}.${key} is not a safe config field.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error(
        `[evjs] ${source}.${key} must be an enumerable own data property.`,
      );
    }
  }
}

function assertNamespacedId(value: string, source: string): void {
  const separator = value.indexOf("/");
  if (
    !value.startsWith("@") ||
    separator < 2 ||
    separator === value.length - 1 ||
    value !== value.trim() ||
    /\s/.test(value) ||
    UNSAFE_KEYS.has(value)
  ) {
    throw new Error(
      `[evjs] ${source} must be a namespaced id such as "@company/feature".`,
    );
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createRecord<T>(): Record<string, T> {
  return {};
}

function defineRecordValue<T>(
  record: Record<string, T>,
  key: string,
  value: T,
): void {
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}
