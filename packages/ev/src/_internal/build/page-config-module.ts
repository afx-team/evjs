import path from "node:path";
import {
  assertEnumerableStaticJsonProperties,
  assertStaticJsonValue,
  cloneStaticJsonValue,
  isPlainStaticJsonObject,
} from "@evjs/shared/_internal/static-json";
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
  type ResolvedPagePluginOptionsInput,
  resolvePagePluginOptions,
} from "../../config/plugins.js";
import {
  clearStaticConfigModuleCache,
  createStaticConfigModuleSession,
} from "./config-module.js";
import { validatePageRenderingContract } from "./page-rendering-contract.js";

const PAGE_CONFIG_FIELDS = new Set([
  "render",
  "hydrate",
  "prerender",
  "rsc",
  "title",
  "meta",
  "plugins",
  "document",
]);
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
  plugins: Readonly<Record<string, ResolvedPagePluginOptionsInput>>;
  document?: ResolvedPageDocumentConfig;
}

export interface ResolvedPageDocumentConfig {
  aliases?: string[];
}

export interface ResolvedPageFileConfigs {
  pages: Record<string, ResolvedPageFileConfig>;
  dependencies: string[];
}

export interface ResolvePageConfigModulesOptions {
  beforeSourceRead?: (file: string) => void;
  onSourceDependency?: (file: string) => void;
}

export async function resolvePageConfigModules(
  cwd: string,
  metadata: PageRouteDiscoveryMetadata | undefined,
  options: ResolvePageConfigModulesOptions = {},
): Promise<ResolvedPageFileConfigs> {
  return resolveKnownPageConfigModules(
    cwd,
    (metadata?.pages ?? []).flatMap((page) =>
      page.configModule
        ? [{ pageId: page.pageId, configModule: page.configModule }]
        : [],
    ),
    options,
  );
}

/** Resolve colocated Page configs already discovered by a normalized provider. */
export async function resolveCorePageConfigModules(
  cwd: string,
  graph: CoreGraph,
  options: ResolvePageConfigModulesOptions = {},
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
    options,
  );
}

async function resolveKnownPageConfigModules(
  cwd: string,
  configuredPages: PageConfigMetadata[],
  options: ResolvePageConfigModulesOptions,
): Promise<ResolvedPageFileConfigs> {
  const pages = createRecord<ResolvedPageFileConfig>();
  const dependencies = new Set<string>();
  clearStaticConfigModuleCache(
    configuredPages.map((page) => path.resolve(cwd, page.configModule)),
    { projectRoot: cwd },
  );
  const session = createStaticConfigModuleSession(cwd);

  for (const page of configuredPages) {
    const resolved = await resolvePageConfigModule(cwd, page, options, session);
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
  options: ResolvePageConfigModulesOptions,
  session: ReturnType<typeof createStaticConfigModuleSession>,
): Promise<{
  config: ResolvedPageFileConfig;
  dependencies: string[];
}> {
  const source = page.configModule;
  const absoluteSource = path.resolve(cwd, source);
  options.beforeSourceRead?.(absoluteSource);
  const loaded = await session.load(absoluteSource, {
    onDependency: options.onSourceDependency,
  });
  if (!loaded.hasDefaultExport) {
    throw new Error(
      `[evjs] Page "${page.pageId}" config "${source}" must default-export a Page config object.`,
    );
  }
  const value = loaded.value;
  if (!isPlainStaticJsonObject(value)) {
    throw new Error(
      `[evjs] Page "${page.pageId}" config "${source}" default export must be a plain object.`,
    );
  }
  assertEnumerableStaticJsonProperties(
    value,
    `Page "${page.pageId}" config "${source}"`,
  );
  for (const key of Object.keys(value)) {
    if (!PAGE_CONFIG_FIELDS.has(key)) {
      throw new Error(
        `[evjs] Page "${page.pageId}" config "${source}" has unknown field "${key}". Expected render, hydrate, prerender, rsc, title, meta, plugins, or document.`,
      );
    }
  }

  const render = resolveRender(value.render, page);
  const hydrate = resolveHydrate(value.hydrate, page);
  const prerender = resolvePrerender(value.prerender, page);
  const componentModel = resolveComponentModel(value.rsc, page);
  const metadata = resolvePageMetadata(value, page);
  const plugins = resolvePagePluginOptions(
    value.plugins,
    `Page "${page.pageId}" config "${page.configModule}" plugins`,
  );
  const document = resolvePageDocument(value.document, page);
  validatePageRenderingContract(`Page "${page.pageId}" config "${source}"`, {
    ...(render ? { render } : {}),
    ...(componentModel ? { componentModel } : {}),
    ...(hydrate ? { hydrate } : {}),
    ...(prerender ? { prerender } : {}),
  });

  return {
    config: {
      source,
      ...(render ? { render } : {}),
      ...(componentModel ? { componentModel } : {}),
      ...(hydrate ? { hydrate } : {}),
      ...(prerender ? { prerender } : {}),
      ...(metadata ? { metadata } : {}),
      plugins,
      ...(document ? { document } : {}),
    },
    dependencies: loaded.dependencies,
  };
}

function resolvePageDocument(
  value: unknown,
  page: PageConfigMetadata,
): ResolvedPageDocumentConfig | undefined {
  if (value === undefined) return undefined;
  const source = `Page "${page.pageId}" config "${page.configModule}" document`;
  if (!isPlainStaticJsonObject(value)) {
    throw new Error(`[evjs] ${source} must be a plain object.`);
  }
  assertEnumerableStaticJsonProperties(value, source);
  for (const key of Object.keys(value)) {
    if (key !== "aliases") {
      throw new Error(
        `[evjs] ${source} has unknown field "${key}". Expected aliases.`,
      );
    }
  }
  let aliases: string[] | undefined;
  if (Object.hasOwn(value, "aliases")) {
    if (!Array.isArray(value.aliases)) {
      throw new Error(`[evjs] ${source}.aliases must be an array.`);
    }
    aliases = [];
    const seen = new Set<string>();
    for (const [index, alias] of value.aliases.entries()) {
      const aliasSource = `${source}.aliases[${index}]`;
      assertStaticDocumentOutputPath(alias, aliasSource);
      if (seen.has(alias as string)) {
        throw new Error(`[evjs] ${aliasSource} duplicates alias "${alias}".`);
      }
      seen.add(alias as string);
      aliases.push(alias as string);
    }
  }
  if (aliases === undefined || aliases.length === 0) {
    return undefined;
  }
  return {
    ...(aliases?.length ? { aliases } : {}),
  };
}

function assertStaticDocumentOutputPath(
  value: unknown,
  source: string,
): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`[evjs] ${source} must be a non-empty string.`);
  }
  if (value.trim() !== value) {
    throw new Error(
      `[evjs] ${source} must not contain leading or trailing whitespace.`,
    );
  }
  if (value.includes("\\")) {
    throw new Error(`[evjs] ${source} must use forward slashes.`);
  }
  if (value.startsWith("/") || /^[A-Za-z]:\//.test(value)) {
    throw new Error(`[evjs] ${source} must be a relative output path.`);
  }
  if (value.includes("?") || value.includes("#")) {
    throw new Error(`[evjs] ${source} must not contain a query or hash.`);
  }
  if (value.endsWith("/")) {
    throw new Error(`[evjs] ${source} must not end with "/".`);
  }
  if (
    value
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(
      `[evjs] ${source} must not contain empty, ".", or ".." segments.`,
    );
  }
  if (!/\.html?$/i.test(value)) {
    throw new Error(
      `[evjs] ${source} must end with ".html" or ".htm" because a Document alias contains HTML.`,
    );
  }
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
  if (value === "none" || value === "load") return value;
  throw new Error(
    `[evjs] Page "${page.pageId}" config "${page.configModule}" hydrate must be "none" or "load".`,
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
  if (!isPlainStaticJsonObject(value)) {
    throw new Error(`[evjs] ${source} must be true or a plain object.`);
  }
  assertEnumerableStaticJsonProperties(value, source);
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
  assertStaticJsonValue(value, source);
  return cloneStaticJsonValue(value) as Exclude<PrerenderConfig, true>;
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
