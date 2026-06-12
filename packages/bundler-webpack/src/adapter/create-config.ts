import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
const serverFunctionLoader = fileURLToPath(
  new URL("./server-function-loader.cjs", import.meta.url),
);
const rscClientReferenceLoader = fileURLToPath(
  new URL("./rsc-client-reference-loader.cjs", import.meta.url),
);
const pagesEntryLoader = fileURLToPath(
  new URL("./pages-entry-loader.cjs", import.meta.url),
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
        ...createPagesEntryRules(options.entries),
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

function createPagesEntryRules(entries: BuildEntry[]) {
  const metadata = getPagesAppMetadata(entries);
  if (!metadata) return [];

  return [
    {
      test: createPagesEntryPathPattern(metadata),
      resourceQuery: /^$/,
      use: [
        {
          loader: pagesEntryLoader,
          options: metadata,
        },
      ],
    },
  ];
}

function createPagesEntryPathPattern(
  metadata: NonNullable<BuildEntry["metadata"]>,
): RegExp {
  if (metadata.type !== "pages-app") return /$^/;
  return new RegExp(
    `${escapeRegExp(normalizeRulePath(metadata.routes[0]?.module ?? ""))}$`,
  );
}

function normalizeRulePath(value: string): string {
  return value.replace(/^\.\//, "").replaceAll("\\", "/");
}

function getPagesAppMetadata(
  entries: BuildEntry[],
): NonNullable<BuildEntry["metadata"]> | undefined {
  const metadata = entries.find(
    (entry) => entry.metadata?.type === "pages-app",
  )?.metadata;
  return metadata?.type === "pages-app" ? metadata : undefined;
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
    return createDataUrlEntry(createRscPageRendererSource(component));
  }

  if (
    entry.environment === "server" &&
    (entry.kind === "page-server" ||
      entry.kind === "ppr-shell" ||
      entry.kind === "ppr-region")
  ) {
    const component = path.isAbsolute(entry.import)
      ? entry.import
      : path.resolve(cwd, entry.import);
    return createDataUrlEntry(createServerRendererSource(component));
  }

  if (entry.metadata?.type === "remote-client") {
    const app = path.isAbsolute(entry.metadata.app)
      ? entry.metadata.app
      : path.resolve(cwd, entry.metadata.app);
    return createDataUrlEntry(createRemoteClientSource(app));
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
  if (entry.metadata.route) {
    params.set("routeId", entry.metadata.route.id);
    params.set("routePath", entry.metadata.route.path);
  }

  return createDataUrlEntry(
    createComponentPageSource(component, Object.fromEntries(params)),
  );
}

function createDataUrlEntry(source: string): string {
  return `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`;
}

function moduleSpecifier(file: string): string {
  return pathToFileURL(file).href.replace(/!/g, "%21");
}

function createRscPageRendererSource(component: string): string {
  const componentRequest = moduleSpecifier(component);
  return `
import { createElement } from "react";
import { renderToReadableStream } from "react-server-dom-webpack/server.node";
import Component from ${JSON.stringify(componentRequest)};

function findRouteForPage(manifest, pageId) {
  if (!pageId) return undefined;
  const route = manifest.routes?.find((candidate) => candidate.pageId === pageId);
  return route
    ? {
        id: route.id,
        path: route.path,
      }
    : undefined;
}

function createProps(ctx) {
  return {
    manifest: {
      buildId: ctx.manifest.buildId,
    },
    pageId: ctx.pageId,
    route: findRouteForPage(ctx.manifest, ctx.pageId),
  };
}

export async function renderFlight(ctx) {
  const clientReferenceManifest = ctx.manifest.rsc?.clientReferenceManifest;
  if (!clientReferenceManifest) {
    return new Response("[evjs] RSC client reference manifest is not available.", {
      status: 501,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }

  const stream = await renderToReadableStream(
    createElement(Component, createProps(ctx)),
    clientReferenceManifest,
  );
  return new Response(stream, {
    headers: {
      "Content-Type": "text/x-component; charset=utf-8",
    },
  });
}

export default Component;
`;
}

function createRemoteClientSource(app: string): string {
  const appRequest = moduleSpecifier(app);
  return [
    `import * as mod from ${JSON.stringify(appRequest)};`,
    `import { createRemoteReactModule, registerShellModule } from "@evjs/client";`,
    ``,
    `const currentScript = document.currentScript;`,
    `const href = currentScript && "src" in currentScript ? currentScript.src : undefined;`,
    `if (href) registerShellModule(href, () => createRemoteReactModule(mod));`,
    `export * from ${JSON.stringify(appRequest)};`,
    `export { default } from ${JSON.stringify(appRequest)};`,
  ].join("\n");
}

function createServerRendererSource(component: string): string {
  const componentRequest = moduleSpecifier(component);
  return [
    `export { default } from ${JSON.stringify(componentRequest)};`,
    `export * from ${JSON.stringify(componentRequest)};`,
    ``,
  ].join("\n");
}

function createComponentPageSource(
  component: string,
  options: Record<string, string>,
): string {
  const componentRequest = moduleSpecifier(component);
  const route = options.routePath
    ? {
        id: options.routeId ?? options.routePath,
        path: options.routePath,
      }
    : undefined;
  return [
    `import Component from ${JSON.stringify(componentRequest)};`,
    `import { createReactPageModule, mountReactPage, registerShellModule } from "@evjs/client";`,
    ``,
    `const currentScript = document.currentScript;`,
    `const href = currentScript && "src" in currentScript ? currentScript.src : undefined;`,
    `const loadedByShell = currentScript?.getAttribute?.("data-evjs-shell-load") === "true";`,
    `const mod = createReactPageModule({`,
    `  component: Component,`,
    `  hydrate: ${JSON.stringify(options.hydrate ?? "load")},`,
    `  render: ${JSON.stringify(options.render ?? "csr")},`,
    `  route: ${JSON.stringify(route)},`,
    `});`,
    `if (href) registerShellModule(href, mod);`,
    `if (!loadedByShell) {`,
    `  mountReactPage({`,
    `    component: Component,`,
    `    mount: ${JSON.stringify(options.mount ?? "#app")},`,
    `    hydrate: ${JSON.stringify(options.hydrate ?? "load")},`,
    `    render: ${JSON.stringify(options.render ?? "csr")},`,
    `    route: ${JSON.stringify(route)},`,
    `  });`,
    `}`,
    `export default mod;`,
    ``,
  ].join("\n");
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
