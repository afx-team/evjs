import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Config } from "@evjs/ev";

const CONFIG_FILES = ["ev.config.ts", "ev.config.js", "ev.config.mjs"];

/**
 * Load evjs config from the project root.
 *
 * Looks for `ev.config.ts`, `.js`, or `.mjs` in the given directory.
 * Returns undefined if no config file is found.
 */
export async function loadConfig(cwd: string): Promise<Config | undefined> {
  for (const filename of CONFIG_FILES) {
    const configPath = path.resolve(cwd, filename);
    if (fs.existsSync(configPath)) {
      const configUrl = pathToFileURL(configPath);
      configUrl.searchParams.set("t", String(Date.now()));
      const mod = await import(configUrl.href);
      return mod.default ?? mod;
    }
  }
  return undefined;
}
