/**
 * @evjs/ev — minimal config authoring entry for evjs.
 */

export type {
  Config,
  ExtractInstalledPlugin,
  InstalledPluginRegistry,
  PageFileConfig,
  PageMetadata,
  PagePluginConfigValues,
  StaticConfigCompatible,
  StaticConfigObject,
  StaticConfigValue,
} from "./config/index.js";
export { defineConfig, definePageConfig } from "./config/index.js";
