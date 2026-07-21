/**
 * Utoopack bundler adapter.
 *
 * Implements the BundlerAdapter interface using @utoo/pack's
 * programmatic `build()` and `dev()` APIs. Utoopack handles
 * "use server" directives natively — no custom loader or child
 * compiler is needed.
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type {
  BundlerAdapter,
  BundlerBuildContext,
  BundlerBuildFacts,
  BundlerDevContext,
  BundlerDevController,
} from "@evjs/ev/_internal/build";
import type { BuildPlan, BuildPlanUpdate } from "@evjs/ev/_internal/manifest";
import type { ResolvedConfig } from "@evjs/ev/config";
import { getLogger } from "@logtape/logtape";
import type { ConfigComplete } from "@utoo/pack";
import { UtoopackManifestGenerator } from "../manifest-generator.js";
import { getOutputPaths } from "./output-paths.js";

const logger = getLogger(["evjs", "bundler-utoopack"]);
const require = createRequire(import.meta.url);
type UtoopackRuntime = Pick<typeof import("@utoo/pack"), "build" | "serve">;

async function cleanServerOutput(
  cwd: string,
  output: ResolvedConfig<ConfigComplete>["output"],
  distDir: string,
) {
  const outputPaths = getOutputPaths(cwd, output, distDir);
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
): Promise<boolean> {
  const outputPaths = getOutputPaths(cwd, config.output, plan.distDir);
  const clientStatsPath = path.join(outputPaths.clientDir, "stats.json");
  if (!fs.existsSync(clientStatsPath)) return false;

  logger.info`Generating development manifest and HTML...`;
  const generator = new UtoopackManifestGenerator(cwd, plan);
  const facts = await generator.collectBuildFacts();
  await onBuildFacts(facts, options);
  return true;
}

function requireUtoopack(): UtoopackRuntime {
  // @utoo/pack's import condition targets ESM .js files; Node 18 parses them as CJS.
  return require("@utoo/pack") as UtoopackRuntime;
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

    await cleanServerOutput(cwd, config.output, plan.distDir);

    const { build } = requireUtoopack();
    await build({ config: utoopackConfig });

    logger.info`Collecting utoopack build facts...`;
    const generator = new UtoopackManifestGenerator(cwd, plan);

    logger.info`Build complete!`;
    return generator.collectBuildFacts();
  },

  async dev(
    ctx: BundlerDevContext<ConfigComplete>,
  ): Promise<BundlerDevController> {
    const { config, cwd, callbacks, hooks, plan } = ctx;
    const { createUtoopackConfig, updateSpaHistoryFallbackTarget } =
      await import("./create-config.js");
    const utoopackConfig = await createUtoopackConfig(config, plan, cwd, hooks);
    let serverReadyWatcher: fs.FSWatcher | undefined;

    logger.info`Starting development server with utoopack...`;

    const { serve } = requireUtoopack();
    let devServerOrigin = formatDevServerOrigin(config, config.dev.port);
    await serve({ config: utoopackConfig }, undefined, undefined, {
      port: config.dev.port,
      https: config.dev.https !== false,
      hostname: "0.0.0.0",
      logServerInfo: false,
      onReady({ port, hostname }) {
        devServerOrigin = formatDevServerOrigin(config, port, hostname);
        const fallbackUpdated = updateSpaHistoryFallbackTarget(
          utoopackConfig,
          devServerOrigin,
        );
        if (port !== config.dev.port) {
          const fallbackStatus = fallbackUpdated
            ? " The SPA fallback now targets the actual dev server."
            : "";
          logger.warn`Reserved client port ${config.dev.port} became unavailable during startup; Utoopack is listening on ${port}.${fallbackStatus}`;
        }
      },
    });

    await generateDevArtifacts(config, cwd, plan, callbacks.onBuildFacts, {
      isRebuild: false,
    });
    await callbacks.onDevServerReady?.({ origin: devServerOrigin });
    if (!hasRuntimeServerEntry(plan)) {
      return new UtoopackDevController({
        config,
        cwd,
        onBuildFacts: callbacks.onBuildFacts,
      });
    }

    const outDir = getOutputPaths(cwd, config.output, plan.distDir).serverDir;

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
    return new UtoopackDevController({
      config,
      cwd,
      onBuildFacts: callbacks.onBuildFacts,
      closeWatcher() {
        serverReadyWatcher?.close();
      },
    });
  },
};

function hasRuntimeServerEntry(plan: BuildPlan): boolean {
  return plan.entries.some(
    (entry) =>
      entry.environment === "server" && entry.kind === "server-runtime",
  );
}

function formatDevServerOrigin(
  config: ResolvedConfig<ConfigComplete>,
  port: number,
  hostname = "localhost",
): string {
  const protocol = config.dev.https ? "https" : "http";
  const host = hostname === "0.0.0.0" ? "localhost" : hostname;
  return `${protocol}://${host}:${port}`;
}

class UtoopackDevController implements BundlerDevController {
  constructor(
    private options: {
      config: ResolvedConfig<ConfigComplete>;
      cwd: string;
      onBuildFacts: BundlerDevContext<ConfigComplete>["callbacks"]["onBuildFacts"];
      closeWatcher?: () => void;
    },
  ) {}

  close(): void {
    this.options.closeWatcher?.();
  }

  async updatePlan(update: BuildPlanUpdate): Promise<void> {
    if (isEmptyPlanUpdate(update)) return;

    if (!isHtmlOnlyUpdate(update)) {
      throw new Error(
        `[evjs] Utoopack dev cannot apply framework plan changes without restarting ev dev (${formatUnsupportedPlanUpdate(update)}). HTML-only framework plan updates are supported; entry additions, removals, server changes, and route metadata changes still require a lower-layer Utoopack update API.`,
      );
    }

    const emitted = await generateDevArtifacts(
      this.options.config,
      this.options.cwd,
      update.next,
      this.options.onBuildFacts,
      { isRebuild: true },
    );
    if (!emitted) {
      throw new Error(
        "[evjs] Utoopack dev cannot regenerate framework artifacts before client build stats are available.",
      );
    }
  }
}

function isEmptyPlanUpdate(update: BuildPlanUpdate): boolean {
  return (
    !update.serverChanged &&
    update.entries.added.length === 0 &&
    update.entries.removed.length === 0 &&
    update.entries.changed.length === 0 &&
    update.html.added.length === 0 &&
    update.html.removed.length === 0 &&
    update.html.changed.length === 0
  );
}

function isHtmlOnlyUpdate(update: BuildPlanUpdate): boolean {
  return (
    !update.serverChanged &&
    update.entries.added.length === 0 &&
    update.entries.removed.length === 0 &&
    update.entries.changed.length === 0 &&
    (update.html.added.length > 0 ||
      update.html.removed.length > 0 ||
      update.html.changed.length > 0)
  );
}

function formatUnsupportedPlanUpdate(update: BuildPlanUpdate): string {
  const changes = [
    formatPlanItems("entry additions", update.entries.added, formatBuildEntry),
    formatPlanItems("entry removals", update.entries.removed, formatBuildEntry),
    formatPlanItems("entry changes", update.entries.changed, formatBuildEntry),
    formatPlanItems("HTML additions", update.html.added, formatHtmlPlan),
    formatPlanItems("HTML removals", update.html.removed, formatHtmlPlan),
    formatPlanItems("HTML changes", update.html.changed, formatHtmlPlan),
    update.serverChanged ? "server output changed" : undefined,
  ].filter((change): change is string => Boolean(change));

  return changes.length > 0 ? changes.join("; ") : "unknown plan change";
}

function formatPlanItems<T>(
  label: string,
  items: T[],
  formatItem: (item: T) => string,
): string | undefined {
  if (items.length === 0) return undefined;
  return `${label}: ${items.map(formatItem).join(", ")}`;
}

function formatBuildEntry(entry: BuildPlan["entries"][number]): string {
  return `${entry.name} (${entry.kind})`;
}

function formatHtmlPlan(html: BuildPlan["html"][number]): string {
  return `${html.id} -> ${html.fileName}`;
}
