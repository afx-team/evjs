import type {
  CoreApplicationPluginSettings,
  CoreGraph,
  PageRouteNode,
  ServerMiddlewareNode,
} from "@evjs/shared/manifest";
import type {
  PageRouteDiscoveryMetadata,
  ResolvedConfigRouteApplication,
} from "../../../config/index.js";
import type { ResolvedPageFileConfigs } from "../config-loading/page-config-module.js";
import type { DiscoveredServerRouteNode } from "../discovery/server-routes.js";
import type {
  PluginSettingsRegistry,
  PluginSettingsResolutionSession,
} from "../plugins/settings.js";

export interface GraphAnalysisResult {
  graph: CoreGraph;
  diagnostics: Diagnostic[];
  fileDependencies: string[];
}

export interface CreateCoreGraphOptions {
  resolve?: {
    alias?: Record<string, string>;
  };
  pluginSettings?: PluginSettingsRegistry;
  /** Application plugin settings resolved before plugin setup. */
  applicationPluginSettings?: CoreApplicationPluginSettings;
  /** Canonical Page configs pre-evaluated once for alias convergence. */
  pageConfigs?: ResolvedPageFileConfigs;
  /** Page plugin setting snapshots reused during one alias-convergence analysis. */
  pluginSettingsSession?: PluginSettingsResolutionSession;
  /** @internal Captures a baseline immediately before framework source reads. */
  beforeSourceRead?: (file: string) => void;
  /** @internal Reports source dependencies discovered by delegated loaders. */
  onSourceDependency?: (file: string) => void;
}

export interface Diagnostic {
  level: "warning" | "error";
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface GraphConfig {
  application?: ResolvedConfigRouteApplication;
  routing?: {
    mode: "spa" | "mpa";
    html: string;
    mount: string;
    routes: PageRouteNode[];
    rootModule?: string;
    metadata?: PageRouteDiscoveryMetadata;
    dependencies?: string[];
  };
  server: {
    routes?: DiscoveredServerRouteNode[];
    conventions?: {
      globalMiddlewares: ServerMiddlewareNode[];
      routeMiddlewares: ServerMiddlewareNode[];
    };
  };
}
