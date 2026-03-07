#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configure, getConsoleSink, getLogger } from "@logtape/logtape";
import { Command } from "commander";
import { execa } from "execa";
import fs from "fs-extra";
import prompts from "prompts";

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
 * Resolve the webpack config path.
 *
 * If evf.config.ts exists, generate a temporary webpack config from it.
 * Otherwise, fall back to webpack.config.cjs.
 */
async function resolveWebpackConfig(cwd: string): Promise<string> {
  const { loadConfig } = await import("./load-config.js");

  const evfConfig = await loadConfig(cwd);
  if (evfConfig) {
    // Generate webpack config and write as a temp file
    const { createWebpackConfig } = await import("./create-webpack-config.js");
    const webpackConfig = createWebpackConfig(evfConfig, cwd);
    const tmpPath = path.resolve(
      cwd,
      "node_modules/.cache/evf/webpack.config.cjs",
    );
    fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
    fs.writeFileSync(
      tmpPath,
      `module.exports = ${JSON.stringify(webpackConfig, null, 2)};`,
    );
    logger.info`Using evf.config.ts`;
    return tmpPath;
  }

  // Fallback to webpack.config.cjs
  const fallback = path.resolve(cwd, "webpack.config.cjs");
  if (fs.existsSync(fallback)) {
    logger.info`Using webpack.config.cjs`;
    return fallback;
  }

  logger.error`No evf.config.ts or webpack.config.cjs found.`;
  process.exit(1);
}

program
  .command("dev")
  .description("Start development server")
  .action(async () => {
    const cwd = process.cwd();
    const configPath = await resolveWebpackConfig(cwd);
    const serverPort = (await import("./load-config.js"))
      .loadConfig(cwd)
      .then((c) => c?.build?.serverPort ?? 3001)
      .catch(() => 3001);

    logger.info`Starting development server...`;
    try {
      const clientRun = execa(
        "npx",
        ["webpack", "serve", "--config", configPath],
        {
          stdio: "inherit",
          env: { ...process.env, NODE_ENV: "development" },
        },
      );

      // Background: wait for server bundle, then start Node API
      const port = await serverPort;
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
                  `const port = process.env.PORT || ${port};`,
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

      await clientRun;
    } catch (_e) {
      process.exit(1);
    }
  });

program
  .command("build")
  .description("Build project for production")
  .action(async () => {
    const cwd = process.cwd();
    const configPath = await resolveWebpackConfig(cwd);

    logger.info`Building for production...`;
    try {
      await execa("npx", ["webpack", "--config", configPath], {
        stdio: "inherit",
        env: { ...process.env, NODE_ENV: "production" },
      });
      logger.info`Build complete!`;
    } catch (_e) {
      process.exit(1);
    }
  });

program.parse();
