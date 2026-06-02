export type {
  ExtractedRoute,
  ExtractedServerRoute,
  RouteAnalysis,
} from "./routes/index.js";
export {
  analyzeRoutes,
  detectServerRouteExports,
  extractClientRoutes,
  extractClientRoutesFromAst,
  extractReactRoutes,
  extractReactRoutesFromAst,
  extractServerRoutes,
  extractServerRoutesFromAst,
  resolveRoutes,
} from "./routes/index.js";
