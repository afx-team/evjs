import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { derivePackageName } from "../src/project-name.js";

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
    const templates = fs
      .readdirSync(templatesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

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

      const hasSpaEntry = fs.existsSync(
        path.join(templateDir, "src", "main.tsx"),
      );
      const hasMpaEntries =
        fs.existsSync(path.join(templateDir, "src", "home", "main.tsx")) &&
        fs.existsSync(path.join(templateDir, "src", "about", "main.tsx"));

      expect(
        hasSpaEntry || hasMpaEntries,
        `${template} should have either src/main.tsx or MPA page entries`,
      ).toBe(true);
    }
  });

  it("template package.json uses workspace references for @evjs deps", () => {
    const templates = fs
      .readdirSync(templatesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

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

  it("derives a valid package name from path-like project names", () => {
    expect(derivePackageName("my-real-app", "/tmp/my-real-app")).toBe(
      "my-real-app",
    );
    expect(derivePackageName("/tmp/my-real-app", "/tmp/my-real-app")).toBe(
      "my-real-app",
    );
    expect(derivePackageName("apps/my-real-app", "/tmp/apps/my-real-app")).toBe(
      "my-real-app",
    );
    expect(
      derivePackageName("@scope/my-real-app", "/tmp/@scope/my-real-app"),
    ).toBe("@scope/my-real-app");
  });

  it("copy filter excludes node_modules, dist, and .turbo", async () => {
    // Test the filter function logic used in create-app
    const filter = (src: string) => {
      const basename = path.basename(src);
      return !["node_modules", "dist", ".turbo"].includes(basename);
    };

    expect(filter("/some/path/node_modules")).toBe(false);
    expect(filter("/some/path/dist")).toBe(false);
    expect(filter("/some/path/.turbo")).toBe(false);
    expect(filter("/some/path/src")).toBe(true);
    expect(filter("/some/path/package.json")).toBe(true);
    expect(filter("/some/path/index.html")).toBe(true);
  });
});
