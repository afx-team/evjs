import type {
  ExtractedRoute,
  ExtractedServerRoute,
} from "@evjs/shared/manifest";
import { analyzeServerRoutesFromAst } from "./server.js";
import {
  formatParseErrorMessage,
  parseRouteModuleWithError,
} from "./shared.js";

export type {
  ExtractedRoute,
  ExtractedServerRoute,
} from "@evjs/shared/manifest";
export { resolveRoutes } from "@evjs/shared/manifest";
export {
  analyzeServerRoutesFromAst,
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

const SERVER_ROUTE_PARSE_DIAGNOSTIC_PREFIX =
  "Server route module could not be parsed:";
const SERVER_ROUTE_IMPORT_MARKERS = ["@evjs/server"];

/** Parse once and run server route collectors. Client routes come from page files. */
export function analyzeRoutes(source: string): RouteAnalysis {
  const { ast, error } = parseRouteModuleWithError(source);
  if (!ast) {
    const diagnostics: RouteAnalysisDiagnostic[] = [];
    if (mayHaveServerRoute(source)) {
      diagnostics.push({
        level: "error",
        message: `${SERVER_ROUTE_PARSE_DIAGNOSTIC_PREFIX} ${formatParseErrorMessage(error, { firstLine: true })}`,
      });
    }

    return {
      clientRoutes: [],
      serverRoutes: [],
      diagnostics,
    };
  }

  const serverAnalysis = analyzeServerRoutesFromAst(ast);
  return {
    clientRoutes: [],
    serverRoutes: serverAnalysis.serverRoutes,
    diagnostics: serverAnalysis.diagnostics,
  };
}

function mayHaveServerRoute(source: string): boolean {
  return (
    SERVER_ROUTE_IMPORT_MARKERS.some((marker) => source.includes(marker)) &&
    source.includes("createRoute")
  );
}
