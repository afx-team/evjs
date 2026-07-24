import { collectModuleExportNames } from "./module-exports.js";
import { parseRouteModuleWithError } from "./routes/shared.js";

const REMOVED_PAGE_MODULE_CONFIG_EXPORTS = [
  "render",
  "hydrate",
  "prerender",
  "rsc",
] as const;

const PAGE_ROUTE_LIFECYCLE_EXPORTS = [
  "beforeLoad",
  "loader",
  "validateSearch",
  "pendingComponent",
  "errorComponent",
  "notFoundComponent",
] as const;

export type RemovedPageModuleConfigExport =
  (typeof REMOVED_PAGE_MODULE_CONFIG_EXPORTS)[number];

export type PageRouteLifecycleExport =
  (typeof PAGE_ROUTE_LIFECYCLE_EXPORTS)[number];

export interface PageModuleExportAnalysis {
  removedConfig: RemovedPageModuleConfigExport[];
  routeLifecycle: PageRouteLifecycleExport[];
}

/**
 * Find rendering configuration that is still exported from a Page component.
 *
 * Rendering configuration is evaluated only from adjacent `page.config.*`
 * modules. This check deliberately looks at export names without interpreting
 * their values so component modules cannot become a second config source.
 */
export function findRemovedPageModuleConfigExports(
  source: string,
): RemovedPageModuleConfigExport[] {
  return analyzePageModuleExports(source).removedConfig;
}

/** Collect Page exports whose runtime meaning depends on the render contract. */
export function analyzePageModuleExports(
  source: string,
): PageModuleExportAnalysis {
  const { ast } = parseRouteModuleWithError(source);
  if (!ast) {
    return {
      removedConfig: [],
      routeLifecycle: [],
    };
  }

  const exportedNames = new Set(collectModuleExportNames(ast.body));
  return {
    removedConfig: REMOVED_PAGE_MODULE_CONFIG_EXPORTS.filter((name) =>
      exportedNames.has(name),
    ),
    routeLifecycle: PAGE_ROUTE_LIFECYCLE_EXPORTS.filter((name) =>
      exportedNames.has(name),
    ),
  };
}
