#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import pc from "picocolors";
import prompts from "prompts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf-8"),
);
const templateCopyExcludedBasenames = new Set([
  "node_modules",
  "dist",
  ".turbo",
  ".turbopack",
  ".evjs",
  "route-types.d.ts",
]);

export function shouldCopyTemplatePath(src: string): boolean {
  return !src
    .split(/[\\/]+/)
    .some((segment) => templateCopyExcludedBasenames.has(segment));
}

export async function runCreateAppCli(argv = process.argv): Promise<void> {
  const program = new Command();

  program
    .name("create-evjs-app")
    .description("Scaffold a new evjs project")
    .version(pkg.version)
    .argument("[name]", "Project name")
    .option("-t, --template <template>", "Template to use")
    .action(async (name, options: { template?: string }) => {
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
              { title: "Basic (Routing + Server Functions)", value: "basic" },
              { title: "MPA (Multi-Page Application)", value: "mpa" },
              {
                title: "API Routes (Programmatic REST API via createRoute())",
                value: "api-routes",
              },
              {
                title: "Complex Routing (params, search, root layout, loaders)",
                value: "complex-routing",
              },
              {
                title: "With Tailwind CSS (plugin loaders example)",
                value: "with-tailwind",
              },
              { title: "With tRPC Interop", value: "with-trpc" },
              { title: "With SQLite (Full-stack CRUD)", value: "with-sqlite" },
              {
                title: "Custom Transport (WebSockets)",
                value: "custom-ws-transport",
              },
              { title: "Plugin Authoring", value: "plugin-authoring" },
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
        console.error(pc.red(`✖ Directory ${projectName} already exists!`));
        process.exit(1);
      }

      const templatesRoot = path.resolve(__dirname, "../templates");
      const templateDir = path.resolve(templatesRoot, template);

      // Prevent path traversal outside the templates directory
      if (!templateDir.startsWith(templatesRoot + path.sep)) {
        console.error(pc.red(`✖ Invalid template: ${template}`));
        process.exit(1);
      }

      if (!fs.existsSync(templateDir)) {
        console.error(pc.red(`✖ Template ${template} not found!`));
        process.exit(1);
      }

      console.log(pc.cyan(`⚡ Scaffolding project in ${targetDir}...`));
      fs.cpSync(templateDir, targetDir, {
        recursive: true,
        dereference: true,
        filter: shouldCopyTemplatePath,
      });

      // Post-process package.json: sync @evjs/* versions and set project name
      const pkgPath = path.join(targetDir, "package.json");
      if (fs.existsSync(pkgPath)) {
        const projPkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        projPkg.name = projectName;
        delete projPkg.private; // Templates shouldn't be private by default

        const updateDeps = (deps: Record<string, string> | undefined) => {
          if (!deps) return;
          for (const [depName, val] of Object.entries(deps)) {
            if (
              depName.startsWith("@evjs/") &&
              (val === "*" ||
                (typeof val === "string" && val.includes("workspace")))
            ) {
              deps[depName] = `^${pkg.version}`;
            }
          }
        };

        updateDeps(projPkg.dependencies);
        updateDeps(projPkg.devDependencies);

        fs.writeFileSync(pkgPath, JSON.stringify(projPkg, null, 2));
      }

      console.log(pc.green("✔ Done! Now run:"));
      console.log(`  cd ${projectName}`);
      console.log("  npm install");
      console.log("  npm run dev");
    });

  await program.parseAsync(argv);
}

function isDirectExecution(): boolean {
  const invokedPath = process.argv[1];
  if (!invokedPath) return false;
  return path.resolve(invokedPath) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  runCreateAppCli().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
