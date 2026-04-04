import fs from "node:fs";
import path from "node:path";
import type { EvConfig } from "@evjs/shared";

const CONFIG_FILES = ["ev.config.ts", "ev.config.js", "ev.config.mjs"];

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
      const mod = await import(configPath);
      return mod.default ?? mod;
    }
  }
  return undefined;
}
