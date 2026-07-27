import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { shouldCopyTemplatePath } from "../src/index.js";

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

      expect(configSource).toMatch(
        new RegExp(`routing:\\s*{\\s*mode:\\s*["']${expectedMode}["']\\s*}`),
      );
      expect(configSource).not.toMatch(/\bapplication\s*:/);
      expect(configSource).not.toMatch(/\btopology\s*:/);
      expect(configSource).not.toMatch(/\bpageRoot\s*:/);
      expect(configSource).not.toMatch(/\bdocument\s*:/);
      expect(configSource).not.toMatch(/\broutes\s*:/);
      expect(configSource).not.toMatch(/\bconvention\s*:/);
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

  it("each template ignores generated framework artifacts", () => {
    const templates = listTemplateNames();

    for (const template of templates) {
      const gitignore = fs.readFileSync(
        path.join(templatesDir, template, ".gitignore"),
        "utf-8",
      );

      const ignoredPaths = gitignore.split(/\r?\n/);
      expect(ignoredPaths).toContain(".ev");
      expect(ignoredPaths).toContain(".evjs");
      expect(ignoredPaths).toContain("route-types.d.ts");
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
    expect(shouldCopyTemplatePath("/some/path/src")).toBe(true);
    expect(shouldCopyTemplatePath("/some/path/package.json")).toBe(true);
    expect(shouldCopyTemplatePath("/some/path/index.html")).toBe(true);
  });

  it("prepack dereference excludes generated framework artifacts", async () => {
    const derefScriptUrl = pathToFileURL(
      path.resolve(__dirname, "../scripts/deref-templates.js"),
    ).href;
    const { shouldDerefTemplatePath } = (await import(derefScriptUrl)) as {
      shouldDerefTemplatePath: (src: string) => boolean;
    };

    expect(shouldDerefTemplatePath("/some/path/.ev")).toBe(false);
    expect(shouldDerefTemplatePath("/some/path/.ev/manifest.json")).toBe(false);
    expect(shouldDerefTemplatePath("/some/path/.evjs")).toBe(false);
    expect(shouldDerefTemplatePath("/some/path/src/route-types.d.ts")).toBe(
      false,
    );
    expect(shouldDerefTemplatePath("/some/path/src/pages/page.tsx")).toBe(true);
  });
});

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
