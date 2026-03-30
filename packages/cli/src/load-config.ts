import fs from "node:fs";
import path from "node:path";
import type { EvConfig } from "./config.js";

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
 */
export async function loadConfig(cwd: string): Promise<EvConfig | undefined> {
  for (const filename of CONFIG_FILES) {
    const configPath = path.resolve(cwd, filename);
    if (fs.existsSync(configPath)) {
      // Register TS loader for .ts config files
      if (filename.endsWith(".ts")) {
        await ensureTsLoader();
      }
      const mod = await import(configPath);
      return mod.default ?? mod;
    }
  }
  return undefined;
}
