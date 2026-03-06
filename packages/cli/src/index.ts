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
    { category: ["evjs"], sinks: ["console"], lowestLevel: "info" },
  ],
});

const logger = getLogger(["evjs", "cli"]);

const pkg = fs.readJsonSync(path.resolve(__dirname, "../package.json"));
const program = new Command();

program
  .name("evjs")
  .description("CLI for the ev framework")
  .version(pkg.version);

program
  .command("init")
  .description("Initialize a new ev project")
  .argument("[name]", "Project name")
  .option("-t, --template <template>", "Template to use")
  .action(async (name, options) => {
    const response = await prompts(
      [
        {
          type: name ? null : "text",
          name: "projectName",
          message: "Project name:",
          initial: name || "my-ev-app",
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

program
  .command("dev")
  .description("Start development server")
  .action(async () => {
    const cwd = process.cwd();
    logger.info`Starting development server...`;
    try {
      logger.info`Starting Webpack Dev Server...`;

      const clientRun = execa(
        "npx",
        ["webpack", "serve", "--config", "webpack.config.cjs"],
        {
          stdio: "inherit",
          env: { ...process.env, NODE_ENV: "development" },
        },
      );

      // The background Node API execution (will wait for child compiler output)
      const _serverRun = (async () => {
        const manifestPath = path.resolve(cwd, "dist/server/manifest.json");
        const bootstrapPath = path.resolve(cwd, "dist/server/_dev_start.cjs");

        let started = false;
        while (true) {
          if (fs.existsSync(manifestPath)) {
            if (!started) {
              logger.info`Server bundle detected, starting Node API...`;
              started = true;

              // Read manifest to get server bundle filename
              const manifest = JSON.parse(
                fs.readFileSync(manifestPath, "utf-8"),
              );
              const serverBundlePath = path.resolve(
                cwd,
                "dist/server",
                manifest.entry,
              );

              // Write a CJS bootstrap that requires the server bundle,
              // creates the app (sharing the function registry), and starts the server.
              fs.writeFileSync(
                bootstrapPath,
                [
                  `const bundle = require(${JSON.stringify(serverBundlePath)});`,
                  `const app = bundle.createApp();`,
                  `const { serve } = require("@hono/node-server");`,
                  `const port = process.env.PORT || 3001;`,
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
                // If it crashes, mark as not started so it can retry or restart
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
    logger.info`Building for production...`;
    try {
      await execa("npx", ["webpack", "--config", "webpack.config.cjs"], {
        stdio: "inherit",
        env: { ...process.env, NODE_ENV: "production" },
      });
      logger.info`Build complete!`;
    } catch (_e) {
      process.exit(1);
    }
  });

program.parse();
