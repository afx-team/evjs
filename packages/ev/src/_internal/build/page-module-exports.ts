import { collectModuleExportNames } from "./module-exports.js";
import { parseRouteModuleWithError } from "./routes/shared.js";

const PAGE_RENDERING_CONFIG_EXPORTS = [
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

export type PageRenderingConfigExport =
  (typeof PAGE_RENDERING_CONFIG_EXPORTS)[number];

export type PageRouteLifecycleExport =
  (typeof PAGE_ROUTE_LIFECYCLE_EXPORTS)[number];

export interface PageModuleExportAnalysis {
  renderingConfig: PageRenderingConfigExport[];
  routeLifecycle: PageRouteLifecycleExport[];
}

/** Collect Page exports whose runtime meaning depends on the render contract. */
export function analyzePageModuleExports(
  source: string,
): PageModuleExportAnalysis {
  const { ast } = parseRouteModuleWithError(source);
  if (!ast) {
    return { renderingConfig: [], routeLifecycle: [] };
  }

  const exportedNames = new Set(collectModuleExportNames(ast.body));
  return {
    renderingConfig: PAGE_RENDERING_CONFIG_EXPORTS.filter((name) =>
      exportedNames.has(name),
    ),
    routeLifecycle: PAGE_ROUTE_LIFECYCLE_EXPORTS.filter((name) =>
      exportedNames.has(name),
    ),
  };
}
