import fs from "node:fs";
import path from "node:path";
import { getLogger } from "@logtape/logtape";
import {
  CONFIG_DEFAULTS,
  type Config,
  type ResolvedConfig,
} from "../../config/index.js";
import {
  PAGE_ROUTE_CONVENTION_DOCS_URL,
  PAGE_ROUTE_CONVENTION_SUMMARY,
} from "./page-route-conventions.js";
import {
  collectGeneratedPageRouteTypeFiles,
  generatePageRouteTypes,
  getPageRouteTypesPath,
  writePageRouteTypesIfChanged,
} from "./page-route-types.js";
import { discoverPageRoutes, type PageRouteDiscovery } from "./page-routes.js";
import {
  applyRouteScopedMiddlewares,
  discoverServerConventions,
  type ServerConventionDiscovery,
} from "./server-conventions.js";
import {
  discoverServerRoutes,
  type ServerRouteDiscovery,
} from "./server-routes.js";

const logger = getLogger(["evjs", "ev"]);
const PAGE_ROUTE_CONVENTION_DOCS_HINT = `${PAGE_ROUTE_CONVENTION_SUMMARY}. See ${PAGE_ROUTE_CONVENTION_DOCS_URL} for the page route file convention.`;

interface PageRoutingDefaultsOptions {
  syncRouteTypes?: boolean;
  reportDiagnostics?: boolean;
  allowEmptyRoutes?: boolean;
  onDiscovery?: (
    base: NonNullable<ResolvedConfig["routing"]>,
    discovery: PageRouteDiscovery,
  ) => void;
}

interface ServerRoutingDefaultsOptions {
  reportDiagnostics?: boolean;
  allowEmptyRoutes?: boolean;
  onDiscovery?: (
    base: NonNullable<ResolvedConfig["server"]["routing"]>,
    discovery: ServerRouteDiscovery,
  ) => void;
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
  if (routingOption === false) {
    if (syncRouteTypes) {
      await removeAllPageRouteTypes(cwd);
    }
    return { ...config, routing: undefined };
  }

  const requested = routingOption !== undefined;
  if ((config.pages || config.app) && requested) {
    throw new Error(
      "[evjs] routing cannot be combined with app or pages configuration.",
    );
  }
  if (config.pages || config.app) {
    if (syncRouteTypes) {
      await removeAllPageRouteTypes(cwd);
    }
    return config;
  }

  const base = config.routing ?? {
    mode: CONFIG_DEFAULTS.routingMode,
    dir: CONFIG_DEFAULTS.routingDir,
    html: config.html,
    mount: CONFIG_DEFAULTS.mount,
    conventions: {
      layout: true,
    },
    routes: [],
  };
  const discovery = await discoverPageRoutes(cwd, {
    dir: base.dir,
    mode: base.mode,
    rootLayout:
      base.mode === "spa" ? (base.conventions?.layout ?? false) : false,
    spaConventions: base.mode === "spa" && base.conventions !== undefined,
    required: requested,
  });
  options.onDiscovery?.(base, discovery);
  if (options.reportDiagnostics !== false) {
    reportPageRouteDiagnostics(discovery.diagnostics);
  }

  if (discovery.routes.length === 0) {
    if (!requested) {
      if (syncRouteTypes) {
        await removeAllPageRouteTypes(cwd);
      }
      return config;
    }
    if (options.allowEmptyRoutes) {
      return {
        ...config,
        html: base.html,
        routing: {
          ...base,
          routes: [],
        },
      };
    }
    throw new Error(
      `[evjs] No page routes found in ${base.dir}. Add a default-exporting route module such as ${base.dir.replace(/\/+$/, "")}/index.tsx or set routing: false. ${PAGE_ROUTE_CONVENTION_DOCS_HINT}`,
    );
  }

  if (syncRouteTypes) {
    await syncPageRouteTypes(cwd, base.dir, base.mode, discovery.routes);
  }

  return {
    ...config,
    html: base.html,
    routing: {
      ...base,
      routes: discovery.routes,
      ...(base.mode === "spa" && discovery.rootModule
        ? { rootModule: discovery.rootModule }
        : {}),
    },
  };
}

export async function withServerRoutingDefaults<TBundlerCfg>(
  config: ResolvedConfig<TBundlerCfg>,
  userConfig: Config<TBundlerCfg> | undefined,
  cwd: string,
  options: ServerRoutingDefaultsOptions = {},
): Promise<ResolvedConfig<TBundlerCfg>> {
  const routingOption = readServerRoutingConfig(userConfig);
  if (routingOption === false) {
    return {
      ...config,
      server: {
        ...config.server,
        routing: undefined,
      },
    };
  }

  if (!config.server.routing) return config;

  const requested = routingOption !== undefined;
  const base = config.server.routing;
  const discovery = await discoverServerRoutes(cwd, {
    dir: base.dir,
    required: requested,
  });
  options.onDiscovery?.(base, discovery);
  if (options.reportDiagnostics !== false) {
    reportServerRouteDiagnostics(discovery.diagnostics);
  }

  if (discovery.routes.length === 0) {
    if (!requested) {
      return {
        ...config,
        server: {
          ...config.server,
          routing: undefined,
        },
      };
    }
    if (options.allowEmptyRoutes) {
      return {
        ...config,
        server: {
          ...config.server,
          routing: {
            ...base,
            routes: [],
          },
        },
      };
    }
    throw new Error(createNoServerRoutesFoundMessage(base.dir));
  }

  return {
    ...config,
    server: {
      ...config.server,
      routing: {
        ...base,
        routes: discovery.routes,
      },
    },
  };
}

export async function withServerConventionDefaults<TBundlerCfg>(
  config: ResolvedConfig<TBundlerCfg>,
  cwd: string,
  options: ServerConventionDefaultsOptions = {},
): Promise<ResolvedConfig<TBundlerCfg>> {
  const conventions = config.server.conventions;
  if (conventions?.middleware !== true) {
    return {
      ...config,
      server: {
        ...config.server,
        conventions: undefined,
      },
    };
  }

  const discovery = await discoverServerConventions(cwd, {
    globalFile: CONFIG_DEFAULTS.serverMiddlewareFile,
    routingDir: config.server.routing?.dir,
    middleware: conventions.middleware,
  });
  options.onDiscovery?.(discovery);
  if (options.reportDiagnostics !== false) {
    reportServerConventionDiagnostics(discovery.diagnostics);
  }

  const nextRouting = config.server.routing
    ? {
        ...config.server.routing,
        routes: applyRouteScopedMiddlewares(
          config.server.routing.routes,
          discovery.routeMiddlewares,
        ),
      }
    : undefined;

  return {
    ...config,
    server: {
      ...config.server,
      ...(nextRouting ? { routing: nextRouting } : { routing: undefined }),
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

export function readServerRoutingConfig<TBundlerCfg>(
  config: Config<TBundlerCfg> | undefined,
): ServerRoutingConfigValue<TBundlerCfg> {
  return config?.server?.routing;
}

type ServerRoutingConfigValue<TBundlerCfg> =
  | Exclude<Config<TBundlerCfg>["server"], undefined>["routing"]
  | undefined;

async function syncPageRouteTypes(
  cwd: string,
  routingDir: string,
  mode: NonNullable<ResolvedConfig["routing"]>["mode"],
  routes: NonNullable<ResolvedConfig["routing"]>["routes"],
): Promise<void> {
  const { dir, file, importBaseDir } = getPageRouteTypesPath(cwd, routingDir);

  if (mode !== "spa") {
    await removeAllPageRouteTypes(cwd);
    return;
  }

  const source = generatePageRouteTypes({
    routes,
    importBaseDir,
  });

  await fs.promises.mkdir(dir, { recursive: true });
  await writePageRouteTypesIfChanged(file, source);
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
      .map((file) => fs.promises.rm(file, { force: true })),
  );
}

async function removeAllPageRouteTypes(cwd: string): Promise<void> {
  await Promise.all(
    (await collectGeneratedPageRouteTypeFiles(cwd)).map((file) =>
      fs.promises.rm(file, { force: true }),
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
        PAGE_ROUTE_CONVENTION_DOCS_HINT,
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

export function createNoServerRoutesFoundMessage(dir: string): string {
  return `[evjs] No server routes found in ${dir}. Add a route module exporting GET or POST such as ${dir.replace(/\/+$/, "")}/index.ts or set server.routing: false.`;
}
