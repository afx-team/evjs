import fs from "node:fs";
import path from "node:path";
import type { EvConfig } from "./config.js";

const CONFIG_FILES = ["ev.config.ts", "ev.config.js", "ev.config.mjs"];

/**
 * Ensure a TypeScript loader is registered before importing `.ts` config files.
 * Tries `@swc-node/register/esm-register` (ships alongside `@swc/core` which
 * the CLI already bundles), then falls back to Node's built-in `--loader tsx`
 * pathway. If neither is available the raw `import()` is attempted anyway —
 * Node will throw a clear error telling the user to install a loader.
 */
async function ensureTsLoader(): Promise<void> {
  try {
    await import("@swc-node/register/esm-register");
  } catch {
    // Loader not available — Node may still handle .ts via --loader flag
  }
}

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
