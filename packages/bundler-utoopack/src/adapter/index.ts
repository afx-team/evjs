/**
 * Utoopack bundler adapter.
 *
 * Implements the BundlerAdapter interface using @utoo/pack's
 * programmatic `build()` and `dev()` APIs. Utoopack handles
 * "use server" directives natively — no custom loader or child
 * compiler is needed.
 */

import fs from "node:fs";
import path from "node:path";
import {
  type BundlerAdapter,
  type EvPluginHooks,
  isMpa,
  type ResolvedEvConfig,
} from "@evjs/ev";
import { getLogger } from "@logtape/logtape";
import type { ConfigComplete } from "@utoo/pack";
import { UtoopackManifestGenerator } from "../manifest-generator.js";

const logger = getLogger(["evjs", "bundler-utoopack"]);

async function generateAndEmitHtml(
  config: ResolvedEvConfig<ConfigComplete>,
  cwd: string,
  hooks: EvPluginHooks<ConfigComplete>[],
) {
  const isServerEnabled = config.serverEnabled;
  const clientManifestPath = path.resolve(
    cwd,
    isServerEnabled ? "dist/client/manifest.json" : "dist/manifest.json",
  );
  if (!fs.existsSync(clientManifestPath)) return;
  const clientManifest = JSON.parse(
    await fs.promises.readFile(clientManifestPath, "utf-8"),
  );

  // biome-ignore lint/suspicious/noExplicitAny: match @evjs/manifest type
  let serverManifest: any;
  if (isServerEnabled) {
    const serverManifestPath = path.resolve(cwd, "dist/server/manifest.json");
    if (fs.existsSync(serverManifestPath)) {
      serverManifest = JSON.parse(
        await fs.promises.readFile(serverManifestPath, "utf-8"),
      );
    }
  }

  const { generateHtml } = await import("@evjs/build-tools");
  const { buildHtml } = await import("@evjs/ev");

  // MPA mode: generate one HTML file per page
  if (isMpa(config) && clientManifest.pages) {
    for (const [pageName, pageManifest] of Object.entries(
      clientManifest.pages as Record<
        string,
        { assets: { js: string[]; css: string[] } }
      >,
    )) {
      const pageConfig = config.pages?.[pageName];
      if (!pageConfig) continue;

      const doc = generateHtml({
        template: path.resolve(cwd, pageConfig.html),
        js: pageManifest.assets.js,
        css: pageManifest.assets.css,
      });

      const finalHtml = await buildHtml({
        // biome-ignore lint/suspicious/noExplicitAny: DOM interfaces
        doc: doc as any,
        // biome-ignore lint/suspicious/noExplicitAny: Bundler-agnostic hook generic
        hooks: hooks as any,
        clientManifest,
        serverManifest,
      });

      const outPath = path.resolve(
        cwd,
        isServerEnabled
          ? `dist/client/${pageName}.html`
          : `dist/${pageName}.html`,
      );
      await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
      await fs.promises.writeFile(outPath, finalHtml, "utf-8");
    }
    return;
  }

  // SPA mode: single index.html
  const doc = generateHtml({
    template: path.resolve(cwd, config.html),
    js: clientManifest.assets.js,
    css: clientManifest.assets.css,
  });

  const finalHtml = await buildHtml({
    // biome-ignore lint/suspicious/noExplicitAny: DOM interfaces
    doc: doc as any,
    // biome-ignore lint/suspicious/noExplicitAny: Bundler-agnostic hook generic
    hooks: hooks as any,
    clientManifest,
    serverManifest,
  });

  const outPath = path.resolve(
    cwd,
    isServerEnabled ? "dist/client/index.html" : "dist/index.html",
  );
  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  await fs.promises.writeFile(outPath, finalHtml, "utf-8");
}

async function cleanServerOutput(cwd: string, serverEnabled: boolean) {
  if (!serverEnabled) return;
  await fs.promises.rm(path.resolve(cwd, "dist/server"), {
    recursive: true,
    force: true,
  });
}

export const utoopackAdapter: BundlerAdapter<ConfigComplete> = {
  name: "utoopack",
  async build(
    config: ResolvedEvConfig<ConfigComplete>,
    cwd: string,
    hooks: EvPluginHooks<ConfigComplete>[],
  ): Promise<void> {
    const { createUtoopackConfig } = await import("./create-config.js");
    const utoopackConfig = await createUtoopackConfig(config, cwd, hooks);

    logger.info`Building for production with utoopack...`;

    await cleanServerOutput(cwd, config.serverEnabled);

    const { build } = await import("@utoo/pack");
    await build({ config: utoopackConfig });

    logger.info`Extracting routes and generating client manifest...`;
    const generator = new UtoopackManifestGenerator(cwd, config.serverEnabled);
    await generator.build();

    logger.info`Generating and emitting HTML...`;
    await generateAndEmitHtml(config, cwd, hooks);

    logger.info`Build complete!`;
  },

  async dev(
    config: ResolvedEvConfig<ConfigComplete>,
    cwd: string,
    callbacks: { onServerBundleReady: () => void | Promise<void> },
    hooks: EvPluginHooks<ConfigComplete>[],
  ): Promise<void> {
    const { createUtoopackConfig } = await import("./create-config.js");
    const utoopackConfig = await createUtoopackConfig(config, cwd, hooks);

    logger.info`Starting development server with utoopack...`;

    const { serve } = await import("@utoo/pack");
    await serve({ config: utoopackConfig });

    // Watch for server bundle readiness (utoopack emits server output
    // to dist/server/ when "use server" modules are discovered)
    if (config.serverEnabled) {
      const outDir = path.resolve(cwd, "dist/server");

      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }

      let ready = false;
      const checkReady = async (filename?: string) => {
        if (ready) return;
        const hasBundle = filename
          ? filename === "stats.json" || filename.endsWith(".js")
          : (await fs.promises.readdir(outDir).catch(() => [])).some(
              (f) => f === "stats.json" || f.endsWith(".js"),
            );

        if (hasBundle) {
          ready = true;
          try {
            await callbacks.onServerBundleReady();
            watcher?.close();
          } catch (err) {
            logger.error`Server bundle ready callback failed: ${err}`;
            ready = false;
          }
        }
      };

      const watcher = fs.watch(outDir, (_eventType, filename) => {
        if (filename) void checkReady(filename);
      });

      // Initial check in case it was written before the watcher attached
      await checkReady();
    }
  },
};
