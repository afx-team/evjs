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
  ".ev",
  ".evjs",
  "route-types.d.ts",
  "plugin-types.d.ts",
]);

const generatedFrameworkTypeFiles = [
  "route-types.d.ts",
  "plugin-types.d.ts",
] as const;
const packagedTemplateGitignore = "_gitignore";

export function shouldCopyTemplatePath(src: string): boolean {
  return !src
    .split(/[\\/]+/)
    .some((segment) => templateCopyExcludedBasenames.has(segment));
}

export function withGeneratedFrameworkIgnores(source: string): string {
  const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";
  const ignoredPaths = new Set(source.split(/\r?\n/));
  const missing = generatedFrameworkTypeFiles.filter(
    (file) => !ignoredPaths.has(file),
  );
  if (missing.length === 0) return source;

  const separator =
    source.length === 0 || /\r?\n$/.test(source) ? "" : lineEnding;
  return `${source}${separator}${missing.join(lineEnding)}${lineEnding}`;
}

export function restoreScaffoldGitignore(targetDir: string): void {
  const gitignorePath = path.join(targetDir, ".gitignore");
  const packagedGitignorePath = path.join(targetDir, packagedTemplateGitignore);
  let sourcePath = gitignorePath;
  if (fs.existsSync(packagedGitignorePath)) {
    sourcePath = packagedGitignorePath;
  } else if (!fs.existsSync(gitignorePath)) {
    return;
  }

  const source = fs.readFileSync(sourcePath, "utf-8");
  fs.writeFileSync(gitignorePath, withGeneratedFrameworkIgnores(source));
  if (sourcePath === packagedGitignorePath) {
    fs.rmSync(packagedGitignorePath);
  }
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
                title: "API Routes (REST API via server file routes)",
                value: "api-routes",
              },
              {
                title:
                  "Complex Routing (nested Pages, params, search, redirects)",
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

      restoreScaffoldGitignore(targetDir);

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
