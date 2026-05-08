import type { ExtractedRoute, ExtractedServerRoute } from "@evjs/manifest";
import { extractClientRoutesFromAst } from "./client.js";
import { extractServerRoutesFromAst } from "./server.js";
import { parseRouteModule } from "./shared.js";

export type { ExtractedRoute, ExtractedServerRoute } from "@evjs/manifest";
export { resolveRoutes } from "@evjs/manifest";
export {
  extractClientRoutes,
  extractClientRoutesFromAst,
} from "./client.js";
export {
  detectServerRouteExports,
  extractServerRoutes,
  extractServerRoutesFromAst,
} from "./server.js";

export interface RouteAnalysis {
  clientRoutes: ExtractedRoute[];
  serverRoutes: ExtractedServerRoute[];
}

/** Parse once and run both client and server route collectors. */
export function analyzeRoutes(source: string): RouteAnalysis {
  const ast = parseRouteModule(source);
  if (!ast) {
    return { clientRoutes: [], serverRoutes: [] };
  }

  return {
    clientRoutes: extractClientRoutesFromAst(ast),
    serverRoutes: extractServerRoutesFromAst(ast),
  };
}
