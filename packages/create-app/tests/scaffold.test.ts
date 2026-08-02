import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  restoreScaffoldGitignore,
  shouldCopyTemplatePath,
  withGeneratedFrameworkIgnores,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatesDir = path.resolve(__dirname, "../templates");

describe("create-app scaffolding", () => {
  it("has templates directory", () => {
    expect(fs.existsSync(templatesDir)).toBe(true);
  });

  it("has all expected templates", () => {
    const expectedTemplates = [
      "api-routes",
      "basic",
      "complex-routing",
      "custom-ws-transport",
      "mpa",
      "plugin-authoring",
      "with-sqlite",
      "with-trpc",
      "with-tailwind",
    ];

    for (const template of expectedTemplates) {
      const templatePath = path.join(templatesDir, template);
      expect(
        fs.existsSync(templatePath),
        `Template ${template} should exist at ${templatePath}`,
      ).toBe(true);
    }
  });

  it("keeps complex-routing as the advanced file-route template", () => {
    const templateDir = path.join(templatesDir, "complex-routing");
    const configSource = fs.readFileSync(
      path.join(templateDir, "ev.config.ts"),
      "utf-8",
    );

    expect(configSource).toMatch(/routing:\s*{\s*mode:\s*"spa"\s*}/);
    expect(configSource).not.toMatch(/\bapplication\s*:/);
    expect(configSource).not.toMatch(/\broutes\s*:/);
    expect(
      fs.existsSync(
        path.join(templateDir, "src", "pages", "posts", "page.tsx"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(templateDir, "src", "pages", "posts", "$postId", "page.tsx"),
      ),
    ).toBe(true);
  });

  it("each template has required files", () => {
    const templates = listTemplateNames();

    for (const template of templates) {
      const templateDir = path.join(templatesDir, template);

      expect(
        fs.existsSync(path.join(templateDir, "package.json")),
        `${template} should have package.json`,
      ).toBe(true);

      expect(
        fs.existsSync(path.join(templateDir, "index.html")),
        `${template} should have index.html`,
      ).toBe(true);

      const pagesDir = path.join(templateDir, "src", "pages");
      const hasPages =
        fs.existsSync(pagesDir) &&
        fs
          .readdirSync(pagesDir, { recursive: true })
          .some(
            (file) =>
              typeof file === "string" &&
              /(?:^|[/\\])page\.(?:tsx|ts|jsx|js)$/.test(file),
          );

      expect(
        hasPages,
        `${template} should have at least one page.* anchor`,
      ).toBe(true);
    }
  });

  it("all templates use one Page authoring model selected only by mode", () => {
    for (const template of listTemplateNames()) {
      const templateDir = path.join(templatesDir, template);
      const configSource = fs.readFileSync(
        path.join(templateDir, "ev.config.ts"),
        "utf-8",
      );
      const expectedMode = template === "mpa" ? "mpa" : "spa";
      const rootConfigSource = configSource.slice(
        configSource.indexOf("export default defineConfig("),
      );

      expect(rootConfigSource).toMatch(
        new RegExp(`routing:\\s*{\\s*mode:\\s*["']${expectedMode}["']\\s*}`),
      );
      expect(rootConfigSource).not.toMatch(/\bapplication\s*:/);
      expect(rootConfigSource).not.toMatch(/\btopology\s*:/);
      expect(rootConfigSource).not.toMatch(/\bpageRoot\s*:/);
      expect(rootConfigSource).not.toMatch(/\bdocument\s*:/);
      expect(rootConfigSource).not.toMatch(/\broutes\s*:/);
      expect(rootConfigSource).not.toMatch(/\bconvention\s*:/);
    }
  });

  it("uses the same page.* convention for the MPA template", () => {
    const templateDir = path.join(templatesDir, "mpa");
    const config = fs.readFileSync(
      path.join(templateDir, "ev.config.ts"),
      "utf-8",
    );

    expect(config).toMatch(/routing:\s*{\s*mode:\s*"mpa"\s*}/);
    expect(fs.existsSync(path.join(templateDir, "src/pages/page.tsx"))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(templateDir, "src/pages/about/page.tsx")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(templateDir, "src/pages/about/index.html")),
    ).toBe(true);
    expect(config).not.toMatch(/\bapplication\s*:/);
    expect(config).not.toContain("src/pages/about/index.html");
  });

  it("keeps nested index modules inside a Page private scope", () => {
    const templateDir = path.join(templatesDir, "basic");

    expect(
      fs.existsSync(path.join(templateDir, "src/pages/components/index.tsx")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(templateDir, "src/pages/components/page.tsx")),
    ).toBe(false);
  });

  it("uses directory-owned api.ts anchors for server request routes", () => {
    const templateDir = path.join(templatesDir, "api-routes");

    expect(
      fs.existsSync(path.join(templateDir, "src/apis/api/health/api.ts")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(templateDir, "src/apis/api/posts/api.ts")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(templateDir, "src/apis/api/posts/$id/api.ts")),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(templateDir, "src/apis/api/posts/posts-store.ts"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(templateDir, "src/apis/api/health.ts")),
    ).toBe(false);
    expect(fs.existsSync(path.join(templateDir, "src/apis/api/posts.ts"))).toBe(
      false,
    );
  });

  it("each scaffolded template ignores generated framework artifacts", () => {
    const templates = listTemplateNames();

    for (const template of templates) {
      const gitignore = withGeneratedFrameworkIgnores(
        fs.readFileSync(
          path.join(templatesDir, template, ".gitignore"),
          "utf-8",
        ),
      );

      const ignoredPaths = gitignore.split(/\r?\n/);
      expect(ignoredPaths).toContain(".ev");
      expect(ignoredPaths).toContain(".evjs");
      expect(ignoredPaths).toContain("route-types.d.ts");
      expect(ignoredPaths).toContain("plugin-types.d.ts");
    }
  });

  it("restores the packaged template ignore file as .gitignore", () => {
    const targetDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "evjs-scaffold-ignore-"),
    );
    try {
      fs.writeFileSync(
        path.join(targetDir, "_gitignore"),
        ".ev\n.evjs\n.turbopack\nroute-types.d.ts\n",
      );

      restoreScaffoldGitignore(targetDir);

      expect(fs.existsSync(path.join(targetDir, "_gitignore"))).toBe(false);
      const gitignore = fs.readFileSync(
        path.join(targetDir, ".gitignore"),
        "utf-8",
      );
      expect(gitignore.split(/\r?\n/)).toEqual(
        expect.arrayContaining([
          ".ev",
          ".evjs",
          ".turbopack",
          "route-types.d.ts",
          "plugin-types.d.ts",
        ]),
      );
    } finally {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
  });

  it("template package.json uses workspace references for @evjs deps", () => {
    const templates = listTemplateNames();

    for (const template of templates) {
      const pkg = JSON.parse(
        fs.readFileSync(
          path.join(templatesDir, template, "package.json"),
          "utf-8",
        ),
      );

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };

      for (const [name, version] of Object.entries(allDeps)) {
        if (name.startsWith("@evjs/")) {
          expect(
            version,
            `${template}: ${name} should use "*" workspace reference, got "${version}"`,
          ).toBe("*");
        }
      }
    }
  });

  it("template tsconfig enables the default source import alias", () => {
    const templates = listTemplateNames();

    for (const template of templates) {
      const tsconfig = JSON.parse(
        fs.readFileSync(
          path.join(templatesDir, template, "tsconfig.json"),
          "utf-8",
        ),
      );

      expect(tsconfig.compilerOptions?.baseUrl).toBeUndefined();
      expect(tsconfig.compilerOptions?.paths?.["@/*"]).toEqual(["./src/*"]);
    }
  });

  it("copy filter excludes build and generated framework artifacts", async () => {
    expect(shouldCopyTemplatePath("/some/path/node_modules")).toBe(false);
    expect(shouldCopyTemplatePath("/some/path/dist")).toBe(false);
    expect(shouldCopyTemplatePath("/some/path/dist/client/main.js")).toBe(
      false,
    );
    expect(shouldCopyTemplatePath("/some/path/.turbo")).toBe(false);
    expect(shouldCopyTemplatePath("/some/path/.turbopack")).toBe(false);
    expect(shouldCopyTemplatePath("/some/path/.ev")).toBe(false);
    expect(shouldCopyTemplatePath("/some/path/.ev/manifest.json")).toBe(false);
    expect(shouldCopyTemplatePath("/some/path/.evjs")).toBe(false);
    expect(shouldCopyTemplatePath("/some/path/.evjs/dev/manifest.json")).toBe(
      false,
    );
    expect(shouldCopyTemplatePath("/some/path/src/route-types.d.ts")).toBe(
      false,
    );
    expect(shouldCopyTemplatePath("/some/path/src/plugin-types.d.ts")).toBe(
      false,
    );
    expect(shouldCopyTemplatePath("/some/path/src")).toBe(true);
    expect(shouldCopyTemplatePath("/some/path/package.json")).toBe(true);
    expect(shouldCopyTemplatePath("/some/path/index.html")).toBe(true);
  });

  it("prepack dereference excludes generated framework artifacts", async () => {
    const { shouldDerefTemplatePath, withGeneratedFrameworkIgnores } =
      await loadDerefTemplateHelpers();

    expect(shouldDerefTemplatePath("/some/path/.ev")).toBe(false);
    expect(shouldDerefTemplatePath("/some/path/.ev/manifest.json")).toBe(false);
    expect(shouldDerefTemplatePath("/some/path/.evjs")).toBe(false);
    expect(shouldDerefTemplatePath("/some/path/src/route-types.d.ts")).toBe(
      false,
    );
    expect(shouldDerefTemplatePath("/some/path/src/plugin-types.d.ts")).toBe(
      false,
    );
    expect(shouldDerefTemplatePath("/some/path/src/pages/page.tsx")).toBe(true);

    expect(withGeneratedFrameworkIgnores("route-types.d.ts\n")).toBe(
      "route-types.d.ts\nplugin-types.d.ts\n",
    );
  });

  it("packs an executable npm bin and a portable template ignore", async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "evjs-create-app-pack-"),
    );
    try {
      const stagingDir = path.join(tempDir, "package");
      const tarballsDir = path.join(tempDir, "tarballs");
      const consumerDir = path.join(tempDir, "consumer");
      const cacheDir = path.join(tempDir, "npm-cache");
      fs.mkdirSync(path.join(stagingDir, "bin"), { recursive: true });
      fs.mkdirSync(path.join(stagingDir, "dist"), { recursive: true });
      fs.mkdirSync(path.join(stagingDir, "templates", "basic"), {
        recursive: true,
      });
      fs.mkdirSync(tarballsDir, { recursive: true });
      fs.mkdirSync(consumerDir, { recursive: true });

      const packageJson = JSON.parse(
        fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf-8"),
      );
      packageJson.scripts = {};
      packageJson.dependencies = {};
      packageJson.devDependencies = {};
      fs.writeFileSync(
        path.join(stagingDir, "package.json"),
        JSON.stringify(packageJson, null, 2),
      );
      fs.copyFileSync(
        path.resolve(__dirname, "../bin/create-evjs-app.js"),
        path.join(stagingDir, "bin", "create-evjs-app.js"),
      );
      fs.writeFileSync(
        path.join(stagingDir, "dist", "index.js"),
        'export async function runCreateAppCli() { console.log("create-app-bin-ok"); }\n',
      );
      fs.writeFileSync(
        path.join(stagingDir, "dist", "index.d.ts"),
        "export declare function runCreateAppCli(): Promise<void>;\n",
      );
      fs.writeFileSync(
        path.join(stagingDir, "templates", "basic", ".gitignore"),
        ".ev\n.evjs\n.turbopack\nroute-types.d.ts\nplugin-types.d.ts\n",
      );
      const { preparePackagedTemplateGitignore } =
        await loadDerefTemplateHelpers();
      preparePackagedTemplateGitignore(
        path.join(stagingDir, "templates", "basic"),
      );

      const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
      const packResult = JSON.parse(
        execFileSync(
          npmCommand,
          [
            "pack",
            "--ignore-scripts",
            "--json",
            "--loglevel=error",
            "--cache",
            cacheDir,
            "--pack-destination",
            tarballsDir,
          ],
          { cwd: stagingDir, encoding: "utf-8" },
        ),
      ) as Array<{
        filename: string;
        files: Array<{ path: string }>;
      }>;
      const packed = packResult[0];
      if (!packed) throw new Error("npm pack did not return package metadata.");
      const packedFiles = packed.files.map((file) => file.path);
      expect(packedFiles).toContain("bin/create-evjs-app.js");
      expect(packedFiles).toContain("templates/basic/_gitignore");
      expect(packedFiles).not.toContain("templates/basic/.gitignore");
      expect(packedFiles).not.toContain("templates/basic/.npmignore");

      fs.writeFileSync(
        path.join(consumerDir, "package.json"),
        JSON.stringify({ name: "create-app-consumer", private: true }),
      );
      execFileSync(
        npmCommand,
        [
          "install",
          "--ignore-scripts",
          "--no-package-lock",
          "--no-audit",
          "--no-fund",
          "--loglevel=error",
          "--cache",
          cacheDir,
          path.join(tarballsDir, packed.filename),
        ],
        { cwd: consumerDir, encoding: "utf-8" },
      );

      const installedPackage = path.join(
        consumerDir,
        "node_modules",
        "@evjs",
        "create-app",
      );
      expect(
        fs.existsSync(
          path.join(installedPackage, "templates", "basic", "_gitignore"),
        ),
      ).toBe(true);
      const installedBin = path.join(
        consumerDir,
        "node_modules",
        ".bin",
        process.platform === "win32"
          ? "create-evjs-app.cmd"
          : "create-evjs-app",
      );
      expect(
        execFileSync(installedBin, ["--version"], { encoding: "utf-8" }).trim(),
      ).toBe("create-app-bin-ok");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }, 30_000);
});

async function loadDerefTemplateHelpers(): Promise<{
  preparePackagedTemplateGitignore(templateDir: string): void;
  shouldDerefTemplatePath(src: string): boolean;
  withGeneratedFrameworkIgnores(source: string): string;
}> {
  const derefScriptUrl = pathToFileURL(
    path.resolve(__dirname, "../scripts/deref-templates.js"),
  ).href;
  return import(derefScriptUrl) as Promise<{
    preparePackagedTemplateGitignore(templateDir: string): void;
    shouldDerefTemplatePath(src: string): boolean;
    withGeneratedFrameworkIgnores(source: string): string;
  }>;
}

function listTemplateNames(): string[] {
  return fs
    .readdirSync(templatesDir, { withFileTypes: true })
    .filter((entry) => {
      if (entry.isDirectory()) return true;
      if (!entry.isSymbolicLink()) return false;
      return fs.statSync(path.join(templatesDir, entry.name)).isDirectory();
    })
    .map((entry) => entry.name)
    .sort();
}
