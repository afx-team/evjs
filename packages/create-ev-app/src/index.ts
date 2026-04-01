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

const program = new Command();

program
  .name("create-ev-app")
  .description("Scaffold a new evjs project")
  .version(pkg.version)
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
              title: "Basic Server Routes (Programmatic REST API via route())",
              value: "basic-server-routes",
            },
            {
              title: "Configured Server Functions (ev.config.ts + Query)",
              value: "configured-server-fns",
            },
            {
              title: "Complex Routing (params, search, layouts, loaders)",
              value: "complex-routing",
            },
            {
              title: "With Tailwind CSS (plugin loaders example)",
              value: "with-tailwind",
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
      console.error(pc.red(`✖ Directory ${projectName} already exists!`));
      process.exit(1);
    }

    const templateDir = path.resolve(__dirname, "../templates", template);

    if (!fs.existsSync(templateDir)) {
      console.error(pc.red(`✖ Template ${template} not found!`));
      process.exit(1);
    }

    console.log(pc.cyan(`⚡ Scaffolding project in ${targetDir}...`));
    fs.cpSync(templateDir, targetDir, {
      recursive: true,
      dereference: true,
      filter: (src) => {
        const basename = path.basename(src);
        return !["node_modules", "dist", ".turbo"].includes(basename);
      },
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

      await fs.writeFileSync(pkgPath, JSON.stringify(projPkg, null, 2));
    }

    console.log(pc.green("✔ Done! Now run:"));
    console.log(`  cd ${projectName}`);
    console.log("  npm install");
    console.log("  npm run dev");
  });

program.parse();
