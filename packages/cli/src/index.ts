#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import fs from "fs-extra";
import { execa } from "execa";
import pc from "picocolors";
import prompts from "prompts";
import { fileURLToPath } from "node:url";
import { VERSION } from "./version.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const program = new Command();

program
  .name("evjs")
  .description("CLI for the ev framework")
  .version(VERSION);

program
  .command("init")
  .description("Initialize a new ev project")
  .argument("[name]", "Project name")
  .option("-t, --template <template>", "Template to use")
  .action(async (name, options) => {
    const response = await prompts([
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
        ],
      },
    ], {
      onCancel: () => {
        process.exit(1);
      }
    });

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
        return !["node_modules", "dist", ".turbo", ".evjs"].includes(basename);
      }
    });

    // Post-process package.json: sync @evjs/* versions and set project name
    const pkgPath = path.join(targetDir, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = await fs.readJson(pkgPath);
      pkg.name = projectName;
      delete pkg.private; // Templates shouldn't be private by default

      const updateDeps = (deps: any) => {
        if (!deps) return;
        for (const [name, val] of Object.entries(deps)) {
          // Sync all @evjs/* packages to current CLI version
          if (name.startsWith("@evjs/") && (val === "*" || (typeof val === "string" && val.includes("workspace")))) {
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

      const clientRun = execa("npx", ["webpack", "serve", "--config", "webpack.config.cjs"], {
        stdio: "inherit",
        env: { ...process.env, NODE_ENV: "development" }
      });

      // The background Node API execution (will wait for child compiler output)
      const serverRun = (async () => {
        const serverBundlePath = path.resolve(cwd, "dist/server/index.js");

        let started = false;
        while (true) {
          if (fs.existsSync(serverBundlePath)) {
            if (!started) {
              console.log(pc.green("Server bundle detected, starting Node API..."));
              started = true;

              // We use execa but we don't await it here because it's long-running
              try {
                await execa("node", ["--watch", "--watch-preserve-output", "dist/server/index.js"], {
                  stdio: "inherit",
                  env: { ...process.env, NODE_ENV: "development" }
                });
              } catch (e) {
                // If it crashes, mark as not started so it can retry or restart
                started = false;
              }
            }
          }
          await new Promise(r => setTimeout(r, 500));
        }
      })();

      await clientRun;
    } catch (e) {
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
    } catch (e) {
      process.exit(1);
    }
  });

program.parse();
