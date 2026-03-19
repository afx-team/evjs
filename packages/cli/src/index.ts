#!/usr/bin/env node
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configure, getConsoleSink, getLogger } from "@logtape/logtape";
import { Command } from "commander";
import { execa } from "execa";
import fs from "fs-extra";
import prompts from "prompts";
import { CONFIG_DEFAULTS } from "./config.js";

const esmRequire = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

await configure({
  sinks: { console: getConsoleSink() },
  loggers: [
    { category: ["logtape", "meta"], lowestLevel: "warning" },
    { category: ["evjs"], sinks: ["console"], lowestLevel: "info" },
  ],
});

const logger = getLogger(["evjs", "cli"]);

const pkg = fs.readJsonSync(path.resolve(__dirname, "../package.json"));
const program = new Command();

program
  .name("ev")
  .description("CLI for the evjs framework")
  .version(pkg.version);

program
  .command("init")
  .description("Initialize a new evjs project")
  .argument("[name]", "Project name")
  .option("-t, --template <template>", "Template to use")
  .action(async (name, options) => {
    const response = await prompts(
      [
        {
          type: name ? null : "text",
          name: "projectName",
          message: "Project name:",
          initial: name || "my-evjs-app",
        },
        {
          type: options.template ? null : "select",
          name: "template",
          message: "Select a template:",
          choices: [
            { title: "Basic CSR (Client-Side Rendering)", value: "basic-csr" },
            { title: "Basic Server Functions", value: "basic-server-fns" },
            {
              title: "Configured Server Functions (ev.config.ts + Query)",
              value: "configured-server-fns",
            },
            {
              title: "Complex Routing (params, search, layouts, loaders)",
              value: "complex-routing",
            },
          ],
        },
      ],
      {
        onCancel: () => {
          process.exit(1);
        },
      },
    );

    const projectName = response.projectName || name;
    const template = response.template || options.template;
    const targetDir = path.resolve(process.cwd(), projectName);

    if (fs.existsSync(targetDir)) {
      logger.error`Directory ${projectName} already exists!`;
      process.exit(1);
    }

    const templateDir = path.resolve(__dirname, "../templates", template);

    if (!fs.existsSync(templateDir)) {
      logger.error`Template ${template} not found!`;
      process.exit(1);
    }

    logger.info`Scaffolding project in ${targetDir}...`;
    await fs.copy(templateDir, targetDir, {
      dereference: true,
      filter: (src) => {
        const basename = path.basename(src);
        return !["node_modules", "dist", ".turbo"].includes(basename);
      },
    });

    // Post-process package.json: sync @evjs/* versions and set project name
    const pkgPath = path.join(targetDir, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = await fs.readJson(pkgPath);
      pkg.name = projectName;
      delete pkg.private; // Templates shouldn't be private by default

      const updateDeps = (deps: Record<string, string> | undefined) => {
        if (!deps) return;
        for (const [name, val] of Object.entries(deps)) {
          // Sync all @evjs/* packages to current CLI version
          if (
            name.startsWith("@evjs/") &&
            (val === "*" ||
              (typeof val === "string" && val.includes("workspace")))
          ) {
            deps[name] = `^${pkg.version}`;
          }
        }
      };

      updateDeps(pkg.dependencies);
      updateDeps(pkg.devDependencies);

      await fs.writeJson(pkgPath, pkg, { spaces: 2 });
    }

    logger.info`Done! Now run:`;
    logger.info`  cd ${projectName}`;
    logger.info`  npm install`;
    logger.info`  npm run dev`;
  });

/**
 * Load config and create webpack configuration object.
 *
 * Uses ev.config.ts when present, otherwise falls back to zero-config defaults.
 * No webpack.config.cjs fallback — the meta-framework owns the build config.
 */
async function resolveWebpackConfig(cwd: string) {
  const { loadConfig } = await import("./load-config.js");
  const evjsConfig = await loadConfig(cwd);

  const { createWebpackConfig } = await import("./create-webpack-config.js");
  logger.info`Using ${evjsConfig ? "ev.config.ts" : "zero-config defaults"}`;
  const webpackConfig = createWebpackConfig(evjsConfig, cwd);

  return { evjsConfig, webpackConfig };
}

program
  .command("dev")
  .description("Start development server")
  .action(async () => {
    const cwd = process.cwd();
    process.env.NODE_ENV ??= "development";

    const { evjsConfig, webpackConfig } = await resolveWebpackConfig(cwd);
    const serverPort =
      evjsConfig?.server?.dev?.port ?? CONFIG_DEFAULTS.serverPort;

    logger.info`Starting development server...`;
    try {
      const webpack = esmRequire("webpack");
      const WebpackDevServer = esmRequire("webpack-dev-server");

      const compiler = webpack(webpackConfig);
      const devServerOptions =
        (webpackConfig as { devServer?: object }).devServer ?? {};
      const server = new WebpackDevServer(devServerOptions, compiler);
      await server.start();

      // Background: start Node API when server bundle is ready
      let apiStarted = false;
      compiler.hooks.done.tap("EvDevServer", async () => {
        if (apiStarted) return;

        const manifestPath = path.resolve(cwd, "dist/manifest.json");
        const bootstrapPath = path.resolve(cwd, "dist/server/_dev_start.cjs");

        if (fs.existsSync(manifestPath)) {
          apiStarted = true;
          const backendConfig = evjsConfig?.server?.backend ?? "node";
          const [backend, ...backendExtraArgs] = backendConfig.split(/\s+/);
          logger.info`Server bundle detected, starting ${backend} API...`;

          try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
            const serverBundlePath = path.resolve(
              cwd,
              "dist/server",
              manifest.server.entry,
            );

            fs.writeFileSync(
              bootstrapPath,
              [
                `const bundle = require(${JSON.stringify(serverBundlePath)});`,
                `const app = bundle.createApp({ endpoint: ${JSON.stringify(evjsConfig?.server?.endpoint ?? CONFIG_DEFAULTS.endpoint)} });`,
                `const { serve } = require("@evjs/runtime/server/node");`,
                `serve(app, { port: ${serverPort} });`,
              ].join("\n"),
            );

            // node gets --watch flags; other runtimes use their own args as-is
            const backendArgs =
              backend === "node"
                ? [
                    "--watch",
                    "--watch-preserve-output",
                    ...backendExtraArgs,
                    bootstrapPath,
                  ]
                : [...backendExtraArgs, bootstrapPath];

            // Don't await execa here since it's a long-running watch process
            execa(backend, backendArgs, {
              stdio: "inherit",
              env: { ...process.env, NODE_ENV: "development" },
            }).catch(() => {
              apiStarted = false;
            });
          } catch (err) {
            logger.error`Server backend failed: ${err}`;
            apiStarted = false;
          }
        }
      });
    } catch (err) {
      logger.error`Dev server failed to start: ${err}`;
      process.exit(1);
    }
  });

program
  .command("build")
  .description("Build project for production")
  .action(async () => {
    const cwd = process.cwd();
    process.env.NODE_ENV ??= "production";
    const { webpackConfig } = await resolveWebpackConfig(cwd);

    logger.info`Building for production...`;
    const webpack = esmRequire("webpack");
    const compiler = webpack(webpackConfig);

    await new Promise<void>((resolve, reject) => {
      compiler.run(
        (
          err: Error | null,
          stats: {
            hasErrors: () => boolean;
            toString: (opts: object) => string;
          },
        ) => {
          if (err) {
            reject(err);
            return;
          }
          console.log(
            stats.toString({
              colors: true,
              modules: false,
              children: true,
            }),
          );
          if (stats.hasErrors()) {
            process.exit(1);
          }
          compiler.close(() => resolve());
        },
      );
    });
    logger.info`Build complete!`;
  });

program.parse();
