#!/usr/bin/env node
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configure, getConsoleSink, getLogger } from "@logtape/logtape";
import { Command } from "commander";
import { execa } from "execa";
import fs from "fs-extra";
import prompts from "prompts";

const esmRequire = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

await configure({
  sinks: { console: getConsoleSink() },
  loggers: [
    { category: ["logtape", "meta"], lowestLevel: "warning" },
    { category: ["evf"], sinks: ["console"], lowestLevel: "info" },
  ],
});

const logger = getLogger(["evf", "cli"]);

const pkg = fs.readJsonSync(path.resolve(__dirname, "../package.json"));
const program = new Command();

program
  .name("ev")
  .description("CLI for the evf framework")
  .version(pkg.version);

program
  .command("init")
  .description("Initialize a new evf project")
  .argument("[name]", "Project name")
  .option("-t, --template <template>", "Template to use")
  .action(async (name, options) => {
    const response = await prompts(
      [
        {
          type: name ? null : "text",
          name: "projectName",
          message: "Project name:",
          initial: name || "my-evf-app",
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
            { title: "tRPC + Server Functions", value: "trpc-server-fns" },
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
 * Resolve the webpack configuration object.
 *
 * If ev.config.ts exists, build config from it.
 * If neither ev.config.ts nor webpack.config.cjs exists, use zero-config defaults.
 * Falls back to webpack.config.cjs if present and no ev.config.ts.
 */
async function resolveWebpackConfig(
  cwd: string,
): Promise<Record<string, unknown>> {
  const { loadConfig } = await import("./load-config.js");
  const evfConfig = await loadConfig(cwd);

  const fallback = path.resolve(cwd, "webpack.config.cjs");
  if (evfConfig || !fs.existsSync(fallback)) {
    const { createWebpackConfig } = await import("./create-webpack-config.js");
    logger.info`Using ${evfConfig ? "ev.config.ts" : "zero-config defaults"}`;
    return createWebpackConfig(evfConfig, cwd);
  }

  // Fallback to webpack.config.cjs
  logger.info`Using webpack.config.cjs`;
  const mod = await import(fallback);
  return mod.default ?? mod;
}

program
  .command("dev")
  .description("Start development server")
  .action(async () => {
    const cwd = process.cwd();
    process.env.NODE_ENV ??= "development";
    const webpackConfig = await resolveWebpackConfig(cwd);

    const { loadConfig } = await import("./load-config.js");
    const evfConfig = await loadConfig(cwd);
    const serverPort = evfConfig?.server?.dev?.port ?? 3001;

    logger.info`Starting development server...`;
    try {
      const webpack = esmRequire("webpack");
      const WebpackDevServer = esmRequire("webpack-dev-server");

      const compiler = webpack(webpackConfig);
      const devServerOptions =
        (webpackConfig as { devServer?: object }).devServer ?? {};
      const server = new WebpackDevServer(devServerOptions, compiler);
      await server.start();

      // Background: wait for server bundle, then start Node API
      const _serverRun = (async () => {
        const manifestPath = path.resolve(cwd, "dist/server/manifest.json");
        const bootstrapPath = path.resolve(cwd, "dist/server/_dev_start.cjs");

        let started = false;
        while (true) {
          if (fs.existsSync(manifestPath)) {
            if (!started) {
              logger.info`Server bundle detected, starting Node API...`;
              started = true;

              const manifest = JSON.parse(
                fs.readFileSync(manifestPath, "utf-8"),
              );
              const serverBundlePath = path.resolve(
                cwd,
                "dist/server",
                manifest.entry,
              );

              fs.writeFileSync(
                bootstrapPath,
                [
                  `const bundle = require(${JSON.stringify(serverBundlePath)});`,
                  `const app = bundle.createApp();`,
                  `const { serve } = require("@hono/node-server");`,
                  `const port = process.env.PORT || ${serverPort};`,
                  `serve({ fetch: app.fetch, port }, (info) => {`,
                  `  console.log("Server API ready at http://localhost:" + info.port);`,
                  `});`,
                ].join("\n"),
              );

              try {
                await execa(
                  "node",
                  ["--watch", "--watch-preserve-output", bootstrapPath],
                  {
                    stdio: "inherit",
                    env: { ...process.env, NODE_ENV: "development" },
                  },
                );
              } catch (_e) {
                started = false;
              }
            }
          }
          await new Promise((r) => setTimeout(r, 500));
        }
      })();
    } catch (_e) {
      process.exit(1);
    }
  });

program
  .command("build")
  .description("Build project for production")
  .action(async () => {
    const cwd = process.cwd();
    process.env.NODE_ENV ??= "production";
    const webpackConfig = await resolveWebpackConfig(cwd);

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

