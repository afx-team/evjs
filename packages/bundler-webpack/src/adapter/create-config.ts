import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AppGraph,
  BuildEntry,
  BuildPlan,
  BundlerCtx,
  PluginHooks,
  PublicPathOutput,
  ResolvedConfig,
} from "@evjs/ev";
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
const componentPageLoader = fileURLToPath(
  new URL("./component-page-loader.cjs", import.meta.url),
);
const remoteClientLoader = fileURLToPath(
  new URL("./remote-client-loader.cjs", import.meta.url),
);
const serverFunctionLoader = fileURLToPath(
  new URL("./server-function-loader.cjs", import.meta.url),
);
const rscClientReferenceLoader = fileURLToPath(
  new URL("./rsc-client-reference-loader.cjs", import.meta.url),
);
const rscPageRendererLoader = fileURLToPath(
  new URL("./rsc-page-renderer-loader.cjs", import.meta.url),
);
const ReactFlightWebpackPlugin = require("react-server-dom-webpack/plugin");
const clientRootEntry = require.resolve("@evjs/client");
const clientRscEntry = path.join(path.dirname(clientRootEntry), "rsc.js");

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
  const outputPaths = getOutputPaths(cwd, config.serverEnabled, plan.distDir);
  const configs: Configuration[] = [];
  const clientEntries = plan.entries.filter(
    (entry) => entry.environment === "client",
  );
  const serverEntries = plan.entries.filter(
    (entry) => entry.environment === "server",
  );
  const rscServerEntries = serverEntries.filter(
    (entry) => entry.kind === "rsc-page",
  );
  const regularServerEntries = serverEntries.filter(
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
        functionEndpoint: config.server.functionRuntime.endpoint,
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

  if (config.serverEnabled && regularServerEntries.length > 0) {
    configs.push(
      createWebpackConfig({
        cwd,
        entries: regularServerEntries,
        mode: plan.mode,
        name: "server",
        outputPath: outputPaths.serverDir,
        publicPath: plan.runtime.publicPath,
        functionEndpoint: config.server.functionRuntime.endpoint,
        rscClientReferences: getRscClientReferenceModules(cwd, graph),
        enableRscClientRuntime: false,
        clean: (options.clean ?? true) && rscServerEntries.length === 0,
        reactServerConditions: false,
        target: "node",
      }),
    );
  }

  if (config.serverEnabled && rscServerEntries.length > 0) {
    configs.push(
      createWebpackConfig({
        cwd,
        entries: rscServerEntries,
        mode: plan.mode,
        name: "server-rsc",
        outputPath: outputPaths.serverDir,
        publicPath: plan.runtime.publicPath,
        functionEndpoint: config.server.functionRuntime.endpoint,
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
    plan,
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
  functionEndpoint: string;
  rscClientReferences: RscClientReferenceConfig[];
  enableRscClientRuntime: boolean;
  reactServerConditions: boolean;
  clean: boolean;
  target: "web" | "node";
}): Configuration {
  const isProduction = options.mode === "production";

  return {
    name: options.name,
    mode: options.mode,
    context: options.cwd,
    target: options.target,
    entry: createEntryObject(options.cwd, options.entries),
    output: {
      path: options.outputPath,
      filename: isProduction ? "[name].[contenthash:8].js" : "[name].js",
      chunkFilename: isProduction ? "[name].[contenthash:8].js" : "[name].js",
      publicPath: webpackPublicPath(options.publicPath),
      clean: options.clean,
      library:
        options.target === "node"
          ? {
              type: "commonjs2",
            }
          : undefined,
    },
    devtool: isProduction ? false : "source-map",
    experiments: {
      futureDefaults: true,
      css: false,
    },
    resolve: {
      extensions: [".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs", ".json"],
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
      new MiniCssExtractPlugin(),
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

  if (entry.kind === "rsc-page") {
    const component = path.isAbsolute(entry.import)
      ? entry.import
      : path.resolve(cwd, entry.import);
    return `${rscPageRendererLoader}!${component}`;
  }

  if (entry.metadata?.type === "remote-client") {
    const app = path.isAbsolute(entry.metadata.app)
      ? entry.metadata.app
      : path.resolve(cwd, entry.metadata.app);
    return `${remoteClientLoader}!${app}`;
  }

  if (entry.metadata?.type !== "react-component-page") return entry.import;

  const component = path.isAbsolute(entry.metadata.component)
    ? entry.metadata.component
    : path.resolve(cwd, entry.metadata.component);
  const params = new URLSearchParams({
    mount: entry.metadata.mount,
    hydrate: entry.metadata.hydrate,
    render: entry.metadata.render,
  });

  return `${componentPageLoader}?${params.toString()}!${component}`;
}

function webpackPublicPath(publicPath: PublicPathOutput): string {
  return typeof publicPath === "string" ? publicPath : "auto";
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
