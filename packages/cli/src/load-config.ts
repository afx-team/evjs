import fs from "node:fs";
import path from "node:path";
import type { EvConfig, EvConfigCtx } from "./config.js";

const CONFIG_FILES = ["ev.config.ts", "ev.config.js", "ev.config.mjs"];

/**
 * Historically used @swc-node/register, but it causes ERR_REQUIRE_CYCLE_MODULE inside Node 22.
 * Modern evjs relies on Node's native typescript handling or built-in --loader arguments.
 */
async function ensureTsLoader(): Promise<void> {}

/**
 * Load evjs config from the project root.
 *
 * Looks for `ev.config.ts`, `.js`, or `.mjs` in the given directory.
 * Returns undefined if no config file is found.
 *
 * After loading, all plugin `config` hooks are executed in order.
 * If a plugin injects new plugins, their hooks are also executed.
 */
export async function loadConfig(
  cwd: string,
  ctx?: EvConfigCtx,
): Promise<EvConfig | undefined> {
  for (const filename of CONFIG_FILES) {
    const configPath = path.resolve(cwd, filename);
    if (fs.existsSync(configPath)) {
      // Register TS loader for .ts config files
      if (filename.endsWith(".ts")) {
        await ensureTsLoader();
      }
      const mod = await import(configPath);
      let config: EvConfig = mod.default ?? mod;

      // Execute plugin config hooks
      const currentCtx: EvConfigCtx = ctx ?? { mode: "development" };
      const executedConfigHooks = new Set<string>();

      let hasNewPlugins = true;
      while (hasNewPlugins) {
        hasNewPlugins = false;
        const allPlugins = config.plugins ?? [];

        for (const plugin of allPlugins) {
          if (plugin.config && !executedConfigHooks.has(plugin.name)) {
            config = plugin.config(config, currentCtx) ?? config;
            executedConfigHooks.add(plugin.name);
            hasNewPlugins = true;
            break;
          }
        }
      }

      return config;
    }
  }
  return undefined;
}
