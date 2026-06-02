import type {
  ExtractedRoute,
  ExtractedServerRoute,
} from "@evjs/shared/manifest";
import { extractClientRoutesFromAst } from "./client.js";
import {
  extractReactRouteDiagnosticsFromAst,
  extractReactRoutesFromAst,
} from "./react.js";
import { extractServerRoutesFromAst } from "./server.js";
import { parseRouteModule } from "./shared.js";

export type {
  ExtractedRoute,
  ExtractedServerRoute,
} from "@evjs/shared/manifest";
export { resolveRoutes } from "@evjs/shared/manifest";
export {
  extractClientRoutes,
  extractClientRoutesFromAst,
} from "./client.js";
export { extractReactRoutes, extractReactRoutesFromAst } from "./react.js";
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

/** Parse once and run both client and server route collectors. */
export function analyzeRoutes(source: string): RouteAnalysis {
  const ast = parseRouteModule(source);
  if (!ast) {
    return { clientRoutes: [], serverRoutes: [], diagnostics: [] };
  }

  return {
    clientRoutes: [
      ...extractClientRoutesFromAst(ast),
      ...extractReactRoutesFromAst(ast),
    ],
    serverRoutes: extractServerRoutesFromAst(ast),
    diagnostics: extractReactRouteDiagnosticsFromAst(ast, source),
  };
}
