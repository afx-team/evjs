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
  BuildPlan,
  BundlerAdapter,
  BundlerBuildContext,
  BundlerBuildFacts,
  BundlerDevContext,
  BundlerDevController,
  ResolvedConfig,
} from "@evjs/ev";
import { getLogger } from "@logtape/logtape";
import type { ConfigComplete } from "@utoo/pack";
import { UtoopackManifestGenerator } from "../manifest-generator.js";
import { getOutputPaths } from "./output-paths.js";

const logger = getLogger(["evjs", "bundler-utoopack"]);

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
  plan: BuildPlan,
  onBuildFacts: (
    facts: BundlerBuildFacts,
    options?: { isRebuild?: boolean },
  ) => void | Promise<void>,
  options: { isRebuild?: boolean } = {},
) {
  const outputPaths = getOutputPaths(cwd, config.serverEnabled);
  const clientStatsPath = path.join(outputPaths.clientDir, "stats.json");
  if (!fs.existsSync(clientStatsPath)) return;

  logger.info`Generating development manifest and HTML...`;
  const generator = new UtoopackManifestGenerator(
    cwd,
    config.serverEnabled,
    plan,
  );
  const facts = await generator.collectBuildFacts();
  await onBuildFacts(facts, options);
}

export const utoopackAdapter: BundlerAdapter<ConfigComplete> = {
  name: "utoopack",
  async build(
    ctx: BundlerBuildContext<ConfigComplete>,
  ): Promise<BundlerBuildFacts> {
    const { config, cwd, hooks, plan } = ctx;
    const { createUtoopackConfig } = await import("./create-config.js");
    const utoopackConfig = await createUtoopackConfig(config, plan, cwd, hooks);

    logger.info`Building for production with utoopack...`;

    await cleanServerOutput(cwd, config.serverEnabled);

    const { build } = await import("@utoo/pack");
    await build({ config: utoopackConfig });

    logger.info`Collecting utoopack build facts...`;
    const generator = new UtoopackManifestGenerator(
      cwd,
      config.serverEnabled,
      plan,
    );

    logger.info`Build complete!`;
    return generator.collectBuildFacts();
  },

  async dev(
    ctx: BundlerDevContext<ConfigComplete>,
  ): Promise<BundlerDevController> {
    const { config, cwd, callbacks, hooks, plan } = ctx;
    const { createUtoopackConfig } = await import("./create-config.js");
    const utoopackConfig = await createUtoopackConfig(config, plan, cwd, hooks);
    let serverReadyWatcher: fs.FSWatcher | undefined;

    logger.info`Starting development server with utoopack...`;

    const { serve } = await import("@utoo/pack");
    await serve({ config: utoopackConfig });

    await generateDevArtifacts(config, cwd, plan, callbacks.onBuildFacts, {
      isRebuild: false,
    });

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
