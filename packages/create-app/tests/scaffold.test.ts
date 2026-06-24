import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
      const hasPageRoutes =
        fs.existsSync(pagesDir) &&
        fs
          .readdirSync(pagesDir, { recursive: true })
          .some(
            (file) =>
              typeof file === "string" &&
              /\.(?:tsx|ts|jsx|js)$/.test(file) &&
              !file.endsWith(".d.ts"),
          );

      expect(
        hasPageRoutes,
        `${template} should have at least one source page route`,
      ).toBe(true);
    }
  });

  it("each template ignores generated framework artifacts", () => {
    const templates = listTemplateNames();

    for (const template of templates) {
      const gitignore = fs.readFileSync(
        path.join(templatesDir, template, ".gitignore"),
        "utf-8",
      );

      const ignoredPaths = gitignore.split(/\r?\n/);
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

  it("copy filter excludes build and generated framework artifacts", async () => {
    expect(shouldCopyTemplatePath("/some/path/node_modules")).toBe(false);
    expect(shouldCopyTemplatePath("/some/path/dist")).toBe(false);
    expect(shouldCopyTemplatePath("/some/path/dist/client/main.js")).toBe(
      false,
    );
    expect(shouldCopyTemplatePath("/some/path/.turbo")).toBe(false);
    expect(shouldCopyTemplatePath("/some/path/.turbopack")).toBe(false);
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
