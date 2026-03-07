import fs from "node:fs";
import path from "node:path";
import type { EvfConfig } from "./config.js";

const CONFIG_FILES = [
  "ev.config.ts",
  "ev.config.js",
  "ev.config.mjs",
];

/**
 * Load evf config from the project root.
 *
 * Looks for `ev.config.ts`, `.js`, or `.mjs` in the given directory.
 * Returns undefined if no config file is found.
 */
export async function loadConfig(cwd: string): Promise<EvfConfig | undefined> {
  for (const filename of CONFIG_FILES) {
    const configPath = path.resolve(cwd, filename);
    if (fs.existsSync(configPath)) {
      // Use dynamic import for both TS and JS configs
      // For .ts files, the user must have a loader registered (tsx, ts-node, etc.)
      const mod = await import(configPath);
      return mod.default ?? mod;
    }
  }
  return undefined;
}
