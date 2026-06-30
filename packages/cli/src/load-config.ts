import fs from "node:fs";
import path from "node:path";
import { loadConfigFile } from "@evjs/ev/_internal/build";
import type { Config, DefaultBundlerConfig } from "@evjs/ev/config";

export const CONFIG_FILES = ["ev.config.ts", "ev.config.js", "ev.config.mjs"];

/**
 * Load evjs config from the project root.
 *
 * Looks for `ev.config.ts`, `.js`, or `.mjs` in the given directory.
 * Returns undefined if no config file is found.
 */
export async function loadConfig<TBundlerCfg = DefaultBundlerConfig>(
  cwd: string,
): Promise<Config<TBundlerCfg> | undefined> {
  const configPath = resolveConfigPath(cwd);
  if (!configPath) return undefined;
  return loadConfigFile<TBundlerCfg>(configPath);
}

export function resolveConfigPath(cwd: string): string | undefined {
  for (const filename of CONFIG_FILES) {
    const configPath = path.resolve(cwd, filename);
    if (fs.existsSync(configPath)) return configPath;
  }

  return undefined;
}
