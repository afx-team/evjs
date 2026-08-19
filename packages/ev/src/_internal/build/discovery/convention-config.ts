import path from "node:path";
import type { CoreGraph } from "@evjs/shared/manifest";
import { getLogger } from "@logtape/logtape";
import type { Config, ResolvedConfig } from "../../../config/index.js";
import {
  CANONICAL_PAGE_ROUTE_ROOT,
  PAGE_ANCHOR_ROUTE_CONVENTION_SUMMARY,
  PAGE_ROUTE_CONVENTION_DOCS_URL,
} from "../conventions/page-route-conventions.js";
import { CANONICAL_SERVER_ROUTE_ROOT } from "../conventions/server-route-conventions.js";
import { removeOwnedOutputFile } from "../output/owned-file-output.js";
import {
  collectGeneratedPageRouteTypeFiles,
  createPageRouteNodesFromCoreGraph,
  generatePageRouteTypes,
  getPageRouteTypesPath,
  writePageRouteTypesIfChanged,
} from "../typegen/page-route-types.js";
import { discoverPageRoutes, type PageRouteDiscovery } from "./page-routes.js";
import {
  applyRouteScopedMiddlewares,
  CANONICAL_SERVER_MIDDLEWARE_FILE,
  discoverServerConventions,
  type ServerConventionDiscovery,
} from "./server-conventions.js";
import {
  discoverServerRoutes,
  type ServerRouteDiscovery,
} from "./server-routes.js";

const logger = getLogger(["evjs", "ev"]);
interface PageRoutingDefaultsOptions {
  syncRouteTypes?: boolean;
  reportDiagnostics?: boolean;
  allowEmptyRoutes?: boolean;
  onDiscovery?: (
    base: NonNullable<ResolvedConfig["routing"]>,
    discovery: PageRouteDiscovery,
  ) => void;
}

interface ServerRouteDiscoveryOptions {
  reportDiagnostics?: boolean;
  onDiscovery?: (discovery: ServerRouteDiscovery) => void;
}

interface ServerConventionDefaultsOptions {
  reportDiagnostics?: boolean;
  onDiscovery?: (discovery: ServerConventionDiscovery) => void;
}

export async function withPageRoutingDefaults<TBundlerCfg>(
  config: ResolvedConfig<TBundlerCfg>,
  userConfig: Config<TBundlerCfg> | undefined,
  cwd: string,
  options: PageRoutingDefaultsOptions = {},
): Promise<ResolvedConfig<TBundlerCfg>> {
  const routingOption = readRoutingConfig(userConfig);
  const syncRouteTypes = options.syncRouteTypes !== false;
  if (config.conventions === false) {
    if (syncRouteTypes) {
      await removeAllPageRouteTypes(cwd);
    }
    return config.application ? config : { ...config, routing: undefined };
  }
  if (config.application) {
    if (syncRouteTypes) {
      await removeAllPageRouteTypes(cwd);
    }
    return config;
  }

  const requested = routingOption !== undefined;
  if (!requested) {
    if (syncRouteTypes) {
      await removeAllPageRouteTypes(cwd);
    }
    return config;
  }

  const base = config.routing;
  if (!base) {
    throw new Error(
      "[evjs] Internal invariant: explicit routing config was not preserved by config resolution.",
    );
  }
  const discovery = await discoverPageRoutes(cwd, {
    mode: base.mode,
    required: requested,
  });
  options.onDiscovery?.(base, discovery);
  if (options.reportDiagnostics !== false) {
    reportPageRouteDiagnostics(discovery.diagnostics);
  }

  if (discovery.routes.length === 0) {
    if (options.allowEmptyRoutes) {
      return {
        ...config,
        routing: {
          ...base,
          routes: [],
          ...(discovery.metadata ? { metadata: discovery.metadata } : {}),
          ...(discovery.dependencies.length > 0
            ? { dependencies: discovery.dependencies }
            : {}),
        },
      };
    }
    throw new Error(createNoPageRoutesFoundMessage());
  }

  return {
    ...config,
    routing: {
      ...base,
      routes: discovery.routes,
      ...(discovery.metadata ? { metadata: discovery.metadata } : {}),
      ...(discovery.dependencies.length > 0
        ? { dependencies: discovery.dependencies }
        : {}),
      ...(discovery.rootModule ? { rootModule: discovery.rootModule } : {}),
    },
  };
}

export function createNoPageRoutesFoundMessage(): string {
  return `[evjs] No page routes found in ${CANONICAL_PAGE_ROUTE_ROOT}. Add a default-exporting Page anchor such as ${CANONICAL_PAGE_ROUTE_ROOT}/page.tsx or set conventions: false. ${getPageRouteSourceDocsHint()}`;
}

function getPageRouteSourceDocsHint(): string {
  return `${PAGE_ANCHOR_ROUTE_CONVENTION_SUMMARY}. See ${PAGE_ROUTE_CONVENTION_DOCS_URL} for the page route file convention.`;
}

/** Discover the one canonical request-route tree into resolved build state. */
export async function withServerRouteDiscovery<TBundlerCfg>(
  config: ResolvedConfig<TBundlerCfg>,
  cwd: string,
  options: ServerRouteDiscoveryOptions = {},
): Promise<ResolvedConfig<TBundlerCfg>> {
  if (config.conventions === false) {
    return {
      ...config,
      server: {
        ...config.server,
        routes: undefined,
        conventions: undefined,
      },
    };
  }

  const discovery = await discoverServerRoutes(cwd, {
    dir: CANONICAL_SERVER_ROUTE_ROOT,
  });
  options.onDiscovery?.(discovery);
  if (options.reportDiagnostics !== false) {
    reportServerRouteDiagnostics(discovery.diagnostics);
  }

  return {
    ...config,
    server: {
      ...config.server,
      routes: discovery.routes,
    },
  };
}

export async function withServerConventionDefaults<TBundlerCfg>(
  config: ResolvedConfig<TBundlerCfg>,
  cwd: string,
  options: ServerConventionDefaultsOptions = {},
): Promise<ResolvedConfig<TBundlerCfg>> {
  if (config.conventions === false) {
    return {
      ...config,
      server: {
        ...config.server,
        conventions: undefined,
      },
    };
  }

  const conventions = config.server.conventions;
  if (!conventions) {
    return {
      ...config,
      server: {
        ...config.server,
        conventions: undefined,
      },
    };
  }

  const discovery = await discoverServerConventions(cwd, {
    globalFile: CANONICAL_SERVER_MIDDLEWARE_FILE,
    routingDir: CANONICAL_SERVER_ROUTE_ROOT,
  });
  options.onDiscovery?.(discovery);
  if (options.reportDiagnostics !== false) {
    reportServerConventionDiagnostics(discovery.diagnostics);
  }

  const routes = applyRouteScopedMiddlewares(
    config.server.routes ?? [],
    discovery.routeMiddlewares,
  );

  return {
    ...config,
    server: {
      ...config.server,
      routes,
      conventions: {
        ...conventions,
        globalMiddlewares: discovery.globalMiddlewares,
        routeMiddlewares: discovery.routeMiddlewares,
      },
    },
  };
}

export function readRoutingConfig<TBundlerCfg>(
  config: Config<TBundlerCfg> | undefined,
): Config<TBundlerCfg>["routing"] {
  return config?.routing;
}

export async function syncPageRouteTypesFromCoreGraph(
  cwd: string,
  graph: CoreGraph,
): Promise<void> {
  const { file, importBaseDir } = getPageRouteTypesPath(cwd);

  if (
    !Object.values(graph.applications).some(
      (application) => application.routingMode === "spa",
    )
  ) {
    await removeAllPageRouteTypes(cwd);
    return;
  }

  const source = generatePageRouteTypes({
    routes: createPageRouteNodesFromCoreGraph(graph),
    importBaseDir,
  });

  await writePageRouteTypesIfChanged(file, source, cwd);
  await removeStalePageRouteTypes(cwd, file);
}

async function removeStalePageRouteTypes(
  cwd: string,
  activeFile: string,
): Promise<void> {
  const active = path.resolve(activeFile);
  const staleFiles = await collectGeneratedPageRouteTypeFiles(cwd);
  await Promise.all(
    staleFiles
      .filter((file) => path.resolve(file) !== active)
      .map((file) =>
        removeOwnedOutputFile(cwd, file, "Stale Page route types output"),
      ),
  );
}

async function removeAllPageRouteTypes(cwd: string): Promise<void> {
  await Promise.all(
    (await collectGeneratedPageRouteTypeFiles(cwd)).map((file) =>
      removeOwnedOutputFile(cwd, file, "Stale Page route types output"),
    ),
  );
}

function reportPageRouteDiagnostics(
  diagnostics: Array<{
    level: "warning" | "error";
    message: string;
    file?: string;
  }>,
): void {
  const errors: string[] = [];
  for (const diagnostic of diagnostics) {
    const message = diagnostic.file
      ? `${diagnostic.file} - ${diagnostic.message}`
      : diagnostic.message;
    if (diagnostic.level === "error") {
      errors.push(message);
    } else {
      logger.warn`${message}`;
    }
  }
  if (errors.length > 0) {
    throw new Error(
      [
        "[evjs] Page route discovery failed.",
        ...errors,
        getPageRouteSourceDocsHint(),
      ].join("\n"),
    );
  }
}

function reportServerRouteDiagnostics(
  diagnostics: Array<{
    level: "warning" | "error";
    message: string;
    file?: string;
  }>,
): void {
  const errors: string[] = [];
  for (const diagnostic of diagnostics) {
    const message = diagnostic.file
      ? `${diagnostic.file} - ${diagnostic.message}`
      : diagnostic.message;
    if (diagnostic.level === "error") {
      errors.push(message);
    } else {
      logger.warn`${message}`;
    }
  }
  if (errors.length > 0) {
    throw new Error(
      ["[evjs] Server route discovery failed.", ...errors].join("\n"),
    );
  }
}

function reportServerConventionDiagnostics(
  diagnostics: Array<{
    level: "warning" | "error";
    message: string;
    file?: string;
  }>,
): void {
  const errors: string[] = [];
  for (const diagnostic of diagnostics) {
    const message = diagnostic.file
      ? `${diagnostic.file} - ${diagnostic.message}`
      : diagnostic.message;
    if (diagnostic.level === "error") {
      errors.push(message);
    } else {
      logger.warn`${message}`;
    }
  }
  if (errors.length > 0) {
    throw new Error(
      ["[evjs] Server convention discovery failed.", ...errors].join("\n"),
    );
  }
}
