/**
 * Utoopack bundler adapter.
 *
 * Implements the BundlerAdapter interface using @utoo/pack's
 * programmatic `build()` and `dev()` APIs. Unlike the webpack adapter,
 * utoopack handles "use server" directives natively — no custom loader
 * or child compiler is needed.
 */

import fs from "node:fs";
import path from "node:path";
import type { BundlerAdapter, EvPluginHooks, ResolvedEvConfig } from "@evjs/ev";
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["evjs", "bundler-utoopack"]);

export const utoopackAdapter: BundlerAdapter = {
  async build(
    config: ResolvedEvConfig,
    cwd: string,
    hooks: EvPluginHooks[],
  ): Promise<void> {
    const { createUtoopackConfig } = await import("./create-config.js");
    const utoopackConfig = createUtoopackConfig(config, cwd, hooks);

    logger.info`Building for production with utoopack...`;

    const { build } = await import("@utoo/pack");
    await build({ config: utoopackConfig });

    logger.info`Build complete!`;
  },

  async dev(
    config: ResolvedEvConfig,
    cwd: string,
    callbacks: { onServerBundleReady: () => void },
    hooks: EvPluginHooks[],
  ): Promise<void> {
    const { createUtoopackConfig } = await import("./create-config.js");
    const utoopackConfig = createUtoopackConfig(config, cwd, hooks);

    logger.info`Starting development server with utoopack...`;

    const { serve } = await import("@utoo/pack");
    await serve({ config: utoopackConfig });

    // Poll for server manifest readiness (utoopack emits server output
    // to dist/server/ when "use server" modules are discovered)
    if (config.serverEnabled) {
      const manifestPath = path.resolve(cwd, "dist/server/manifest.json");
      const checkInterval = setInterval(() => {
        if (fs.existsSync(manifestPath)) {
          let manifest: { version?: number; entry?: string };
          try {
            manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
          } catch {
            return; // Manifest partially written, wait for next check
          }
          if (manifest.version !== 1 || !manifest.entry) return;

          clearInterval(checkInterval);
          callbacks.onServerBundleReady();
        }
      }, 500);
    }
  },
};
