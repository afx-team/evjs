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
    await fs.copy(templateDir, targetDir);

    console.log(pc.green("\nDone! Now run:"));
    console.log(pc.cyan(`  cd ${projectName}`));
    console.log(pc.cyan("  npm install"));
    console.log(pc.cyan("  npm run dev"));
  });

program
  .command("dev")
  .description("Start development server")
  .action(async () => {
    console.log(pc.blue("Starting development server..."));
    try {
      const hasServer = fs.existsSync(path.resolve(process.cwd(), "src/server.ts"));

      if (hasServer) {
        console.log(pc.cyan("Building initial server bundle..."));
        await execa("npx", ["webpack", "--config", "webpack.config.cjs", "--config-name", "server"], {
          stdio: "inherit",
          env: { ...process.env, NODE_ENV: "development" }
        });

        console.log(pc.cyan("Starting client and API dev servers..."));

        const serverBuild = execa("npx", ["webpack", "--watch", "--config", "webpack.config.cjs", "--config-name", "server"], {
          stdio: "inherit",
          env: { ...process.env, NODE_ENV: "development" }
        });

        const serverRun = execa("node", ["--watch", "dist/server/index.js"], {
          stdio: "inherit",
          env: { ...process.env, NODE_ENV: "development" }
        });

        console.log(pc.cyan("Waiting for API server to boot..."));

        // Wait for port 3001 to become active
        const http = await import("node:http");
        await new Promise<void>((resolve) => {
          let attempts = 0;
          const interval = setInterval(() => {
            attempts++;
            const req = http.request({ method: "HEAD", host: "127.0.0.1", port: 3001, path: "/" }, (res) => {
              clearInterval(interval);
              resolve();
            });
            req.on("error", () => {
              if (attempts > 30) {
                // Give up after 3 seconds, let client start anyway
                clearInterval(interval);
                resolve();
              }
            });
            req.end();
          }, 100);
        });

        const client = execa("npx", ["webpack", "serve", "--config", "webpack.config.cjs", "--config-name", "client"], {
          stdio: "inherit",
          env: { ...process.env, NODE_ENV: "development" }
        });

        await Promise.all([client, serverBuild, serverRun]);
      } else {
        await execa("npx", ["webpack", "serve", "--config", "webpack.config.cjs"], {
          stdio: "inherit",
          env: { ...process.env, NODE_ENV: "development" },
        });
      }
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
