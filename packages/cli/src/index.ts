#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { execa } from "execa";
import fs from "fs-extra";
import pc from "picocolors";
import prompts from "prompts";
import { VERSION } from "./version.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const program = new Command();

program.name("evjs").description("CLI for the ev framework").version(VERSION);

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
      console.error(pc.red(`Directory ${projectName} already exists!`));
      process.exit(1);
    }

    const templateDir = path.resolve(__dirname, "../templates", template);

    if (!fs.existsSync(templateDir)) {
      console.error(pc.red(`Template ${template} not found!`));
      process.exit(1);
    }

    console.log(pc.blue(`Scaffolding project in ${targetDir}...`));
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
            deps[name] = `^${VERSION}`;
          }
        }
      };

      updateDeps(pkg.dependencies);
      updateDeps(pkg.devDependencies);

      await fs.writeJson(pkgPath, pkg, { spaces: 2 });
    }

    console.log(pc.green("\nDone! Now run:"));
    console.log(pc.cyan(`  cd ${projectName}`));
    console.log(pc.cyan("  npm install"));
    console.log(pc.cyan("  npm run dev"));
  });

program
  .command("dev")
  .description("Start development server")
  .action(async () => {
    const cwd = process.cwd();
    console.log(pc.blue("Starting development server..."));
    try {
      console.log(pc.cyan("Starting Webpack Dev Server..."));

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
        const serverBundlePath = path.resolve(cwd, "dist/server/index.js");

        let started = false;
        while (true) {
          if (fs.existsSync(serverBundlePath)) {
            if (!started) {
              console.log(
                pc.green("Server bundle detected, starting Node API..."),
              );
              started = true;

              // We run a small inline eval script that imports the runner plugin from `@evjs/runtime/server`,
              // dynamically imports the built edge app, and passes the app to the runner.
              // Note: we ensure everything is resolved as absolute URIs for stability.
              const runScript = `
                import { runNodeServer } from '@evjs/runtime/server';
                import { pathToFileURL } from 'node:url';
                const serverUrl = pathToFileURL(${JSON.stringify(serverBundlePath)}).href;
                import(serverUrl).then(mod => {
                  const app = mod.default || mod;
                  runNodeServer(app, { port: 3001 });
                }).catch(err => {
                  console.error('Failed to start ev server API:', err);
                });
              `;

              // We use execa but we don't await it here because it's long-running
              try {
                await execa(
                  "node",
                  [
                    "--input-type=module",
                    "-e",
                    runScript
                  ],
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
    console.log(pc.blue("Building for production..."));
    try {
      await execa("npx", ["webpack", "--config", "webpack.config.cjs"], {
        stdio: "inherit",
        env: { ...process.env, NODE_ENV: "production" },
      });
      console.log(pc.green("Build complete!"));
    } catch (_e) {
      process.exit(1);
    }
  });

program.parse();
