import type {
  RuntimePlan,
  ServerBuildPlan,
  ServerMiddlewareNode,
} from "@evjs/shared/manifest";
import type { DiscoveredServerRouteNode } from "../discovery/server-routes.js";

export interface BuildPlanConfig {
  routing?: {
    mode: "spa" | "mpa";
    basepath?: string;
  };
  transport?: {
    baseUrl?: string;
  };
  output: {
    client: string;
    server: string;
  };
  server: {
    routes?: DiscoveredServerRouteNode[];
    conventions?: {
      globalMiddlewares: ServerMiddlewareNode[];
    };
    basepath: string;
    runtime: {
      fn: string;
      ppr?: string;
      rsc?: string;
    };
    resolve?: ServerBuildPlan["resolve"];
    externals?: ServerBuildPlan["externals"];
  };
}

export interface CreateBuildPlanOptions {
  mode?: "development" | "production";
  buildId?: string;
  distDir?: string;
  publicPath?: RuntimePlan["publicPath"];
}
