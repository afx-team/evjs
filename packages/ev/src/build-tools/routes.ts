export type {
  ExtractedRoute,
  ExtractedServerRoute,
  RouteAnalysis,
} from "./routes/index.js";
export {
  analyzeRoutes,
  detectServerRouteExports,
  extractServerRoutes,
  extractServerRoutesFromAst,
  resolveRoutes,
} from "./routes/index.js";
