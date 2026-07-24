import { collectModuleExportNames } from "./module-exports.js";
import { parseRouteModuleWithError } from "./routes/shared.js";

const REMOVED_PAGE_MODULE_CONFIG_EXPORTS = [
  "render",
  "hydrate",
  "prerender",
  "rsc",
] as const;

export type RemovedPageModuleConfigExport =
  (typeof REMOVED_PAGE_MODULE_CONFIG_EXPORTS)[number];

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
  const { ast } = parseRouteModuleWithError(source);
  if (!ast) return [];

  const exportedNames = new Set(collectModuleExportNames(ast.body));
  return REMOVED_PAGE_MODULE_CONFIG_EXPORTS.filter((name) =>
    exportedNames.has(name),
  );
}
