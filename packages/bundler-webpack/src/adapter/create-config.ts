import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AppGraph,
  BuildEntry,
  BuildPlan,
  PublicPathOutput,
} from "@evjs/ev/_internal/manifest";
import type { ResolvedConfig } from "@evjs/ev/config";
import type { BundlerCtx, PluginHooks } from "@evjs/ev/plugin";
import { getLogger } from "@logtape/logtape";
import MiniCssExtractPlugin from "mini-css-extract-plugin";
import type { Configuration, EntryObject } from "webpack";
import webpack from "webpack";
import { getOutputPaths } from "./output-paths.js";

const logger = getLogger(["evjs", "bundler-webpack", "config"]);

const require = createRequire(import.meta.url);
const swcLoader = require.resolve("swc-loader");
const cssLoader = require.resolve("css-loader");
const miniCssExtractLoader = require.resolve(
  "mini-css-extract-plugin/dist/loader.js",
);
const serverFunctionLoader = fileURLToPath(
  new URL("./server-function-loader.cjs", import.meta.url),
);
const rscClientReferenceLoader = fileURLToPath(
  new URL("./rsc-client-reference-loader.cjs", import.meta.url),
);
const frameworkEntryLoader = fileURLToPath(
  new URL("./framework-entry-loader.cjs", import.meta.url),
);
const frameworkEntryAnchor = fileURLToPath(
  new URL("./framework-entry-anchor.js", import.meta.url),
);
const pagesEntryLoader = fileURLToPath(
  new URL("./pages-entry-loader.cjs", import.meta.url),
);
const pagesEntryAnchor = fileURLToPath(
  new URL("./pages-entry-anchor.js", import.meta.url),
);
const serverRoutesEntryLoader = fileURLToPath(
  new URL("./server-routes-entry-loader.cjs", import.meta.url),
);
const serverRoutesEntryAnchor = fileURLToPath(
  new URL("./server-routes-entry-anchor.js", import.meta.url),
);
const ReactFlightWebpackPlugin = require("react-server-dom-webpack/plugin");
const clientRscEntry = "@evjs/ev/_internal/client/rsc-runtime";
const clientRscPageContextEntry = "@evjs/ev/_internal/client/rsc-page-context";
const evRouteRscEntry = "@evjs/ev/_internal/client/rsc-page-context";

type RscClientReferenceConfig =
  | string
  | {
      directory: string;
      recursive?: boolean;
      include?: RegExp;
    };

export type WebpackConfig = Configuration | Configuration[];

export async function createWebpackConfigs(
  config: ResolvedConfig<WebpackConfig>,
  plan: BuildPlan,
  graph: AppGraph,
  cwd: string,
  hooks: PluginHooks<WebpackConfig>[],
  options: { clean?: boolean } = {},
): Promise<Configuration[]> {
  const outputPaths = getOutputPaths(cwd, config.output, plan.distDir);
  const configs: Configuration[] = [];
  const clientEntries = plan.entries.filter(
    (entry) => entry.environment === "client",
  );
  const serverEntries = plan.entries.filter(
    (entry) => entry.environment === "server",
  );
  const buildOnlyServerEntries = serverEntries.filter(
    (entry) => entry.phase === "build",
  );
  const runtimeServerEntries = serverEntries.filter(
    (entry) => entry.phase !== "build",
  );
  const rscServerEntries = runtimeServerEntries.filter(
    (entry) => entry.kind === "rsc-page",
  );
  const regularServerEntries = runtimeServerEntries.filter(
    (entry) => entry.kind !== "rsc-page",
  );

  if (clientEntries.length > 0) {
    configs.push(
      createWebpackConfig({
        cwd,
        entries: clientEntries,
        mode: plan.mode,
        name: "client",
        outputPath: outputPaths.clientDir,
        publicPath: plan.runtime.publicPath,
        resolveAlias: plan.resolve?.alias,
        functionEndpoint: config.server.runtime.fn,
        crossOriginLoading: config.output.crossOriginLoading,
        rscClientReferences: getRscClientReferenceModules(cwd, graph),
        enableRscClientRuntime: plan.entries.some(
          (entry) =>
            entry.environment === "client" &&
            entry.kind === "runtime" &&
            entry.name === "evjs-rsc-client",
        ),
        reactServerConditions: false,
        clean: options.clean ?? true,
        target: "web",
      }),
    );
  }

  if (regularServerEntries.length > 0) {
    configs.push(
      createWebpackConfig({
        cwd,
        entries: regularServerEntries,
        mode: plan.mode,
        name: "server",
        outputPath: outputPaths.serverDir,
        publicPath: plan.runtime.publicPath,
        resolveAlias: plan.resolve?.alias,
        functionEndpoint: config.server.runtime.fn,
        crossOriginLoading: undefined,
        rscClientReferences: getRscClientReferenceModules(cwd, graph),
        enableRscClientRuntime: false,
        clean: (options.clean ?? true) && rscServerEntries.length === 0,
        reactServerConditions: false,
        target: "node",
      }),
    );
  }

  if (buildOnlyServerEntries.length > 0) {
    configs.push(
      createWebpackConfig({
        cwd,
        entries: buildOnlyServerEntries,
        mode: plan.mode,
        name: "server-build",
        outputPath: path.join(outputPaths.rootDir, "__evjs_build_server"),
        publicPath: plan.runtime.publicPath,
        resolveAlias: plan.resolve?.alias,
        functionEndpoint: config.server.runtime.fn,
        crossOriginLoading: undefined,
        rscClientReferences: getRscClientReferenceModules(cwd, graph),
        enableRscClientRuntime: false,
        clean: false,
        reactServerConditions: false,
        target: "node",
      }),
    );
  }

  if (rscServerEntries.length > 0) {
    configs.push(
      createWebpackConfig({
        cwd,
        entries: rscServerEntries,
        mode: plan.mode,
        name: "server-rsc",
        outputPath: outputPaths.serverDir,
        publicPath: plan.runtime.publicPath,
        resolveAlias: plan.resolve?.alias,
        functionEndpoint: config.server.runtime.fn,
        crossOriginLoading: undefined,
        rscClientReferences: getRscClientReferenceModules(cwd, graph),
        enableRscClientRuntime: false,
        clean: false,
        reactServerConditions: true,
        target: "node",
      }),
    );
  }

  const ctx: BundlerCtx<WebpackConfig> = {
    mode: plan.mode,
    command: plan.mode === "production" ? "build" : "dev",
    cwd,
    config,
    bundlerName: "webpack",
    environment:
      clientEntries.length > 0 && serverEntries.length > 0
        ? "mixed"
        : clientEntries.length > 0
          ? "client"
          : "server",
    logger,
    addWatchFile() {},
  };

  for (const h of hooks) {
    if (h.bundlerConfig) {
      await h.bundlerConfig(configs, ctx);
    }
  }

  return configs;
}

function createWebpackConfig(options: {
  cwd: string;
  entries: BuildEntry[];
  mode: BuildPlan["mode"];
  name: string;
  outputPath: string;
  publicPath: PublicPathOutput;
  resolveAlias?: NonNullable<BuildPlan["resolve"]>["alias"];
  functionEndpoint: string;
  crossOriginLoading:
    | ResolvedConfig["output"]["crossOriginLoading"]
    | undefined;
  rscClientReferences: RscClientReferenceConfig[];
  enableRscClientRuntime: boolean;
  reactServerConditions: boolean;
  clean: boolean;
  target: "web" | "node";
}): Configuration {
  const isProduction = options.mode === "production";
  const outputExtension = options.target === "node" ? ".cjs" : ".js";

  return {
    name: options.name,
    mode: options.mode,
    context: options.cwd,
    target: options.target,
    entry: createEntryObject(options.cwd, options.entries),
    output: {
      path: options.outputPath,
      filename: isProduction
        ? `[name].[contenthash:8]${outputExtension}`
        : `[name]${outputExtension}`,
      chunkFilename: isProduction
        ? `[name].[contenthash:8]${outputExtension}`
        : `[name]${outputExtension}`,
      publicPath: webpackPublicPath(options.publicPath, options.target),
      crossOriginLoading:
        options.target === "web" ? options.crossOriginLoading : undefined,
      clean: options.clean,
      library:
        options.target === "node"
          ? {
              type: "commonjs2",
            }
          : undefined,
    },
    externals:
      options.target === "node" && !options.reactServerConditions
        ? {
            react: "commonjs react",
            "react-dom": "commonjs react-dom",
            "react-dom/client": "commonjs react-dom/client",
            "react-dom/server": "commonjs react-dom/server",
            "react-dom/server.node": "commonjs react-dom/server.node",
            "react/jsx-dev-runtime": "commonjs react/jsx-dev-runtime",
            "react/jsx-runtime": "commonjs react/jsx-runtime",
          }
        : undefined,
    devtool: isProduction ? false : "source-map",
    experiments: {
      futureDefaults: true,
      css: false,
    },
    resolve: {
      extensions: [".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs", ".json"],
      alias: createResolveAlias(options.cwd, {
        ...(options.resolveAlias ?? {}),
        ...(options.reactServerConditions
          ? {
              "@evjs/client$": clientRscPageContextEntry,
              "@evjs/ev/route$": evRouteRscEntry,
            }
          : {}),
      }),
      ...(options.reactServerConditions
        ? {
            conditionNames: [
              "react-server",
              "import",
              "module",
              "node",
              "default",
            ],
          }
        : {}),
    },
    module: {
      rules: [
        {
          test: /\.[cm]?[jt]sx?$/,
          exclude: /node_modules/,
          use: [
            {
              loader: swcLoader,
              options: {
                jsc: {
                  parser: {
                    syntax: "typescript",
                    tsx: true,
                  },
                  transform: {
                    react: {
                      runtime: "automatic",
                    },
                  },
                },
              },
            },
            {
              loader: serverFunctionLoader,
              options: {
                rootContext: options.cwd,
                isServer: options.target === "node",
              },
            },
            ...(options.target === "node" && options.reactServerConditions
              ? [
                  {
                    loader: rscClientReferenceLoader,
                  },
                ]
              : []),
          ],
        },
        ...createPagesEntryRules(options.entries),
        ...createServerRoutesEntryRules(options.entries),
        ...createFrameworkEntryRules(options.cwd, options.entries),
        {
          test: /\.css$/,
          use: [miniCssExtractLoader, cssLoader],
        },
      ],
    },
    plugins: [
      new webpack.DefinePlugin({
        "process.env.EVJS_FUNCTION_ENDPOINT": JSON.stringify(
          options.functionEndpoint,
        ),
        __EVJS_FUNCTION_ENDPOINT__: JSON.stringify(options.functionEndpoint),
      }),
      new MiniCssExtractPlugin(
        options.target === "web" && options.crossOriginLoading
          ? { attributes: { crossorigin: options.crossOriginLoading } }
          : undefined,
      ),
      ...createRscPlugins(options),
    ],
    stats: {
      assets: true,
      chunks: true,
      entrypoints: true,
      modules: true,
    },
    optimization: {
      moduleIds: "deterministic",
      runtimeChunk: false,
    },
  };
}

function createResolveAlias(
  cwd: string,
  alias: Record<string, string>,
): NonNullable<Configuration["resolve"]>["alias"] {
  return Object.fromEntries(
    Object.entries(alias).map(([name, target]) => [
      name,
      resolveAliasTarget(cwd, target),
    ]),
  );
}

function resolveAliasTarget(cwd: string, target: string): string {
  if (path.isAbsolute(target)) return target;
  return target.startsWith(".") ? path.resolve(cwd, target) : target;
}

function createRscPlugins(options: {
  target: "web" | "node";
  enableRscClientRuntime: boolean;
  rscClientReferences: RscClientReferenceConfig[];
}): NonNullable<Configuration["plugins"]> {
  if (options.target !== "web" || !options.enableRscClientRuntime) return [];

  return [
    new ReactFlightWebpackPlugin({
      isServer: false,
      clientReferences: options.rscClientReferences,
      clientManifestFilename: "react-client-manifest.json",
      serverConsumerManifestFilename: "react-ssr-manifest.json",
    }),
  ];
}

function createPagesEntryRules(entries: BuildEntry[]) {
  const entry = getPagesAppEntry(entries);
  if (!entry) return [];

  return [
    {
      test: createPagesEntryPathPattern(),
      resourceQuery: /^$/,
      use: [
        {
          loader: pagesEntryLoader,
          options: entry.metadata,
        },
      ],
    },
  ];
}

function createPagesEntryPathPattern(): RegExp {
  return new RegExp(`${escapeRegExp(normalizeRulePath(pagesEntryAnchor))}$`);
}

function createServerRoutesEntryRules(entries: BuildEntry[]) {
  const entry = getServerRoutesEntry(entries);
  if (!entry) return [];

  return [
    {
      test: createServerRoutesEntryPathPattern(),
      resourceQuery: /^$/,
      use: [
        {
          loader: serverRoutesEntryLoader,
          options: entry.metadata,
        },
      ],
    },
  ];
}

function createServerRoutesEntryPathPattern(): RegExp {
  return new RegExp(
    `${escapeRegExp(normalizeRulePath(serverRoutesEntryAnchor))}$`,
  );
}

function createFrameworkEntryRules(cwd: string, entries: BuildEntry[]) {
  return entries.flatMap((entry) => {
    const options = createFrameworkEntryLoaderOptions(cwd, entry);
    if (!options) return [];
    return [
      {
        test: createFrameworkEntryPathPattern(),
        resourceQuery: createFrameworkEntryQueryPattern(entry.name),
        use: [
          {
            loader: frameworkEntryLoader,
            options,
          },
        ],
      },
    ];
  });
}

function createFrameworkEntryPathPattern(): RegExp {
  return new RegExp(
    `${escapeRegExp(normalizeRulePath(frameworkEntryAnchor))}$`,
  );
}

function createFrameworkEntryQueryPattern(name: string): RegExp {
  return new RegExp(`^\\?${escapeRegExp(createFrameworkEntryQuery(name))}$`);
}

function createFrameworkEntryQuery(name: string): string {
  return new URLSearchParams({ "evjs-entry": name }).toString();
}

function normalizeRulePath(value: string): string {
  return value.replace(/^\.\//, "").replaceAll("\\", "/");
}

function getPagesAppEntry(entries: BuildEntry[]):
  | (BuildEntry & {
      metadata: Extract<
        NonNullable<BuildEntry["metadata"]>,
        { type: "pages-app" }
      >;
    })
  | undefined {
  return entries.find(
    (
      entry,
    ): entry is BuildEntry & {
      metadata: Extract<
        NonNullable<BuildEntry["metadata"]>,
        { type: "pages-app" }
      >;
    } => entry.metadata?.type === "pages-app",
  );
}

function getServerRoutesEntry(entries: BuildEntry[]):
  | (BuildEntry & {
      metadata: Extract<
        NonNullable<BuildEntry["metadata"]>,
        { type: "server-app" }
      >;
    })
  | undefined {
  return entries.find(
    (
      entry,
    ): entry is BuildEntry & {
      metadata: Extract<
        NonNullable<BuildEntry["metadata"]>,
        { type: "server-app" }
      >;
    } => entry.metadata?.type === "server-app",
  );
}

function createEntryObject(cwd: string, entries: BuildEntry[]): EntryObject {
  return Object.fromEntries(
    entries.map((entry) => [
      entry.name,
      {
        import: createEntryImport(cwd, entry),
      },
    ]),
  );
}

function createEntryImport(cwd: string, entry: BuildEntry): string {
  if (entry.name === "evjs-rsc-client" && entry.kind === "runtime") {
    return clientRscEntry;
  }

  if (entry.metadata?.type === "pages-app") {
    return pagesEntryAnchor;
  }

  if (entry.metadata?.type === "server-app") {
    return serverRoutesEntryAnchor;
  }

  if (createFrameworkEntryLoaderOptions(cwd, entry)) {
    return `${frameworkEntryAnchor}?${createFrameworkEntryQuery(entry.name)}`;
  }

  return entry.import;
}

function createFrameworkEntryLoaderOptions(
  cwd: string,
  entry: BuildEntry,
): Record<string, unknown> | undefined {
  if (entry.kind === "rsc-page") {
    return {
      type: "rsc-page-renderer",
      module: resolveEntryModule(cwd, entry.import),
    };
  }

  if (
    entry.environment === "server" &&
    (entry.kind === "page-server" ||
      entry.kind === "ppr-shell" ||
      entry.kind === "ppr-region")
  ) {
    return {
      type: "server-renderer",
      module: resolveEntryModule(cwd, entry.import),
    };
  }

  if (entry.metadata?.type === "react-component-page") {
    return {
      type: "react-component-page",
      module: resolveEntryModule(cwd, entry.metadata.component),
      mount: entry.metadata.mount,
      hydrate: entry.metadata.hydrate,
      render: entry.metadata.render,
      ...(entry.metadata.route ? { route: entry.metadata.route } : {}),
    };
  }

  return undefined;
}

function resolveEntryModule(cwd: string, specifier: string): string {
  return path.isAbsolute(specifier) ? specifier : path.resolve(cwd, specifier);
}

function webpackPublicPath(
  publicPath: PublicPathOutput,
  target: "web" | "node",
): string {
  if (target === "node" && publicPath === "auto") return "/";
  return publicPath;
}

function getRscClientReferenceModules(
  cwd: string,
  graph: AppGraph,
): RscClientReferenceConfig[] {
  const modules = [
    ...new Set(
      (graph.clientReferences ?? []).map((reference) =>
        normalizeRealPath(
          path.isAbsolute(reference.module)
            ? reference.module
            : path.resolve(cwd, reference.module),
        ),
      ),
    ),
  ];

  return modules.map((modulePath) => ({
    directory: path.dirname(modulePath),
    recursive: false,
    include: new RegExp(`${escapeRegExp(path.basename(modulePath))}$`),
  }));
}

function normalizeRealPath(file: string): string {
  try {
    return fs.realpathSync.native(file);
  } catch {
    return file;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
