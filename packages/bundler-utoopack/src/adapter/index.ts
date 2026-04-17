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
import { UtoopackManifestGenerator } from "../manifest-generator.js";

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

    logger.info`Extracting routes and generating client manifest...`;
    const generator = new UtoopackManifestGenerator(
      cwd,
      config.serverEnabled,
      config.assetPrefix,
    );
    await generator.build();

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

    logger.info`Starting route watcher for dev manifest...`;
    const generator = new UtoopackManifestGenerator(
      cwd,
      config.serverEnabled,
      config.assetPrefix,
    );
    await generator.watch();

    // Watch for server manifest readiness (utoopack emits server output
    // to dist/server/ when "use server" modules are discovered)
    if (config.serverEnabled) {
      const outDir = path.resolve(cwd, "dist/server");
      const manifestPath = path.resolve(outDir, "manifest.json");

      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }

      let ready = false;
      const checkManifest = async () => {
        if (ready) return;
        try {
          const content = await fs.promises.readFile(manifestPath, "utf-8");
          const manifest = JSON.parse(content);
          if (manifest.version === 1 && manifest.entry) {
            ready = true;
            callbacks.onServerBundleReady();
            watcher?.close();
          }
        } catch {
          // Manifest partially written or missing, wait for next event
        }
      };

      const watcher = fs.watch(outDir, (_eventType, filename) => {
        if (filename === "manifest.json") {
          checkManifest();
        }
      });

      // Initial check in case it was written before the watcher attached
      checkManifest();
    }
  },
};
