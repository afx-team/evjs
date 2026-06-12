import type {
  ExtractedRoute,
  ExtractedServerRoute,
} from "@evjs/shared/manifest";
import { extractServerRoutesFromAst } from "./server.js";
import { parseRouteModule } from "./shared.js";

export type {
  ExtractedRoute,
  ExtractedServerRoute,
} from "@evjs/shared/manifest";
export { resolveRoutes } from "@evjs/shared/manifest";
export {
  detectServerRouteExports,
  extractServerRoutes,
  extractServerRoutesFromAst,
} from "./server.js";

export interface RouteAnalysis {
  clientRoutes: ExtractedRoute[];
  serverRoutes: ExtractedServerRoute[];
  diagnostics: RouteAnalysisDiagnostic[];
}

export interface RouteAnalysisDiagnostic {
  level: "warning" | "error";
  message: string;
  line?: number;
  column?: number;
}

/** Parse once and run server route collectors. Client routes come from page files. */
export function analyzeRoutes(source: string): RouteAnalysis {
  const ast = parseRouteModule(source);
  if (!ast) {
    return { clientRoutes: [], serverRoutes: [], diagnostics: [] };
  }

  return {
    clientRoutes: [],
    serverRoutes: extractServerRoutesFromAst(ast),
    diagnostics: [],
  };
}
