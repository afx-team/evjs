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
import type {
  AppGraph,
  BuildOutput,
  BuildPlan,
  BundlerAdapter,
  BundlerBuildContext,
  BundlerDevContext,
  BundlerDevController,
  PluginHooks,
  ResolvedConfig,
} from "@evjs/ev";
import { getLogger } from "@logtape/logtape";
import type { ConfigComplete } from "@utoo/pack";
import { UtoopackManifestGenerator } from "../manifest-generator.js";
import { getOutputPaths } from "./output-paths.js";

const logger = getLogger(["evjs", "bundler-utoopack"]);

async function generateAndEmitHtml(
  config: ResolvedConfig<ConfigComplete>,
  cwd: string,
  hooks: PluginHooks<ConfigComplete>[],
  output: BuildOutput,
  plan: BuildPlan,
  options: { isRebuild?: boolean } = {},
) {
  const isServerEnabled = config.serverEnabled;
  const outputPaths = getOutputPaths(cwd, isServerEnabled);
  const { generateHtml } = await import("@evjs/ev/build-tools");
  const { buildHtml } = await import("@evjs/ev");

  for (const html of plan.html) {
    const pageId = html.owner.pageId;
    const appId = html.owner.appId;
    const assets = pageId
      ? output.pages[pageId]?.assets
      : appId
        ? output.apps[appId]?.assets
        : undefined;
    if (!assets) continue;

    const doc = generateHtml({
      template: path.resolve(cwd, html.template),
      js: assets.js,
      css: assets.css,
    });
    doc.documentElement?.setAttribute("data-evjs-build", output.buildId);
    if (pageId) {
      doc.documentElement?.setAttribute("data-evjs-kind", "page");
      doc.documentElement?.setAttribute("data-evjs-id", pageId);
      doc.documentElement?.setAttribute("data-evjs-page", pageId);
    } else if (appId) {
      doc.documentElement?.setAttribute("data-evjs-kind", "app");
      doc.documentElement?.setAttribute("data-evjs-id", appId);
      doc.documentElement?.setAttribute("data-evjs-app", appId);
    }

    const finalHtml = await buildHtml({
      // biome-ignore lint/suspicious/noExplicitAny: DOM interfaces
      doc: doc as any,
      hooks,
      pluginContext: {
        mode: plan.mode,
        command: plan.mode === "production" ? "build" : "dev",
        cwd,
        config,
        logger,
        addWatchFile() {},
      },
      html: pageId
        ? {
            kind: "page",
            htmlId: html.id,
            pageId,
            template: html.template,
            fileName: html.fileName,
            assets,
          }
        : {
            kind: "app",
            htmlId: html.id,
            appId: appId ?? "default",
            template: html.template,
            fileName: html.fileName,
            assets,
          },
      output,
      isRebuild: options.isRebuild,
    });

    const outPath = path.join(outputPaths.clientDir, html.fileName);
    await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
    await fs.promises.writeFile(outPath, finalHtml, "utf-8");
  }
}

async function cleanServerOutput(cwd: string, serverEnabled: boolean) {
  if (!serverEnabled) return;
  const outputPaths = getOutputPaths(cwd, serverEnabled);
  await fs.promises.rm(outputPaths.serverDir, {
    recursive: true,
    force: true,
  });
}

async function generateDevArtifacts(
  config: ResolvedConfig<ConfigComplete>,
  cwd: string,
  hooks: PluginHooks<ConfigComplete>[],
  graph: AppGraph,
  plan: BuildPlan,
  onBuildOutput: (output: BuildOutput) => void | Promise<void>,
) {
  const outputPaths = getOutputPaths(cwd, config.serverEnabled);
  const clientStatsPath = path.join(outputPaths.clientDir, "stats.json");
  if (!fs.existsSync(clientStatsPath)) return;

  logger.info`Generating development manifest and HTML...`;
  const generator = new UtoopackManifestGenerator(
    cwd,
    config.serverEnabled,
    graph,
    plan,
  );
  const output = await generator.link();
  await onBuildOutput(output);
  await generator.emit(output);
  await generateAndEmitHtml(config, cwd, hooks, output, plan);
}

export const utoopackAdapter: BundlerAdapter<ConfigComplete> = {
  name: "utoopack",
  async build(ctx: BundlerBuildContext<ConfigComplete>): Promise<void> {
    const { callbacks, config, cwd, graph, hooks, plan } = ctx;
    const { createUtoopackConfig } = await import("./create-config.js");
    const utoopackConfig = await createUtoopackConfig(config, plan, cwd, hooks);

    logger.info`Building for production with utoopack...`;

    await cleanServerOutput(cwd, config.serverEnabled);

    const { build } = await import("@utoo/pack");
    await build({ config: utoopackConfig });

    logger.info`Linking framework manifest...`;
    const generator = new UtoopackManifestGenerator(
      cwd,
      config.serverEnabled,
      graph,
      plan,
    );
    const output = await generator.link();
    await callbacks.onBuildOutput(output);
    await generator.emit(output);

    logger.info`Generating and emitting HTML...`;
    await generateAndEmitHtml(config, cwd, hooks, output, plan);

    logger.info`Build complete!`;
  },

  async dev(
    ctx: BundlerDevContext<ConfigComplete>,
  ): Promise<BundlerDevController> {
    const { config, cwd, callbacks, graph, hooks, plan } = ctx;
    const { createUtoopackConfig } = await import("./create-config.js");
    const utoopackConfig = await createUtoopackConfig(config, plan, cwd, hooks);
    let serverReadyWatcher: fs.FSWatcher | undefined;

    logger.info`Starting development server with utoopack...`;

    const { serve } = await import("@utoo/pack");
    await serve({ config: utoopackConfig });

    await generateDevArtifacts(
      config,
      cwd,
      hooks,
      graph,
      plan,
      callbacks.onBuildOutput,
    );

    // Watch for server bundle readiness (utoopack emits server output
    // to dist/server/ when "use server" modules are discovered)
    if (!config.serverEnabled) {
      return createUnsupportedDevController(() => {
        serverReadyWatcher?.close();
      });
    }

    const outDir = getOutputPaths(cwd, config.serverEnabled).serverDir;

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
          serverReadyWatcher?.close();
        } catch (err) {
          logger.error`Server bundle ready callback failed: ${err}`;
          ready = false;
        }
      }
    };

    serverReadyWatcher = fs.watch(outDir, (_eventType, filename) => {
      if (filename) void checkReady(filename);
    });

    // Initial check in case it was written before the watcher attached
    await checkReady();
    return createUnsupportedDevController(() => {
      serverReadyWatcher?.close();
    });
  },
};

function createUnsupportedDevController(
  closeWatcher: () => void,
): BundlerDevController {
  return {
    close() {
      closeWatcher();
    },
    async updatePlan() {
      throw new Error(
        "[evjs] Utoopack dev plan updates are not supported yet. Dynamic MPA page entry updates require a lower-layer Utoopack update API.",
      );
    },
  };
}
