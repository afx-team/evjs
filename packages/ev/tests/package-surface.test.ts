import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as buildTools from "../src/build-tools/index.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const packageDistribution = {
  "@evjs/ev": { dir: "ev", role: "framework" },
  "@evjs/client": { dir: "client", role: "runtime" },
  "@evjs/server": { dir: "server", role: "runtime" },
  "@evjs/cli": { dir: "cli", role: "tooling" },
  "@evjs/create-app": { dir: "create-app", role: "tooling" },
  "@evjs/bundler-utoopack": { dir: "bundler-utoopack", role: "adapter" },
  "@evjs/bundler-webpack": { dir: "bundler-webpack", role: "adapter" },
  "@evjs/shared": { dir: "shared", role: "contract" },
} as const;

const expectedPackageDirs = Object.values(packageDistribution)
  .map((pkg) => pkg.dir)
  .sort();
type PackageName = keyof typeof packageDistribution;
const expectedPackageNames = Object.keys(
  packageDistribution,
).sort() as PackageName[];

const frameworkEntryPackages = ["@evjs/ev"] as const;

const runtimeImplementationPackages = [
  "@evjs/client",
  "@evjs/server",
] as const satisfies readonly PackageName[];

const publicRuntimePackages = [
  ...frameworkEntryPackages,
  ...runtimeImplementationPackages,
  "@evjs/shared",
] as const satisfies readonly PackageName[];

const bundlerAdapterPackages = [
  "@evjs/bundler-utoopack",
  "@evjs/bundler-webpack",
] as const satisfies readonly PackageName[];

const expectedPublishedFiles = {
  "@evjs/ev": ["esm"],
  "@evjs/client": ["esm"],
  "@evjs/server": ["esm"],
  "@evjs/cli": ["bin", "dist"],
  "@evjs/create-app": ["dist", "templates"],
  "@evjs/bundler-utoopack": ["esm"],
  "@evjs/bundler-webpack": ["esm"],
  "@evjs/shared": ["esm"],
} as const satisfies Record<PackageName, readonly string[]>;

const expectedPrimaryPackageExports = {
  "@evjs/ev": {
    types: "./esm/index.d.ts",
    import: "./esm/index.js",
    default: "./esm/index.js",
  },
  "@evjs/client": {
    types: "./esm/index.d.ts",
    import: "./esm/index.js",
    default: "./esm/index.js",
  },
  "@evjs/server": {
    types: "./esm/index.d.ts",
    import: "./esm/index.js",
    default: "./esm/index.js",
  },
  "@evjs/cli": {
    types: "./dist/index.d.ts",
    import: "./dist/index.js",
  },
  "@evjs/create-app": {
    types: "./dist/index.d.ts",
    import: "./dist/index.js",
    default: "./dist/index.js",
  },
  "@evjs/bundler-utoopack": {
    types: "./esm/index.d.ts",
    import: "./esm/index.js",
    default: "./esm/index.js",
  },
  "@evjs/bundler-webpack": {
    types: "./esm/index.d.ts",
    import: "./esm/index.js",
    default: "./esm/index.js",
  },
  "@evjs/shared": {
    types: "./esm/index.d.ts",
    import: "./esm/index.js",
    default: "./esm/index.js",
  },
} as const satisfies Record<PackageName, Record<string, string>>;

const expectedInternalRuntimeDependencies = {
  "@evjs/ev": ["@evjs/shared"],
  "@evjs/client": ["@evjs/shared"],
  "@evjs/server": ["@evjs/client", "@evjs/shared"],
  "@evjs/cli": ["@evjs/bundler-utoopack", "@evjs/ev"],
  "@evjs/create-app": [],
  "@evjs/bundler-utoopack": ["@evjs/ev"],
  "@evjs/bundler-webpack": ["@evjs/ev"],
  "@evjs/shared": [],
} as const satisfies Record<PackageName, readonly string[]>;

const allowedExamplePackageDependencies = new Set([
  "@evjs/client",
  "@evjs/ev",
  "@evjs/server",
  "@evjs/cli",
  "@evjs/bundler-utoopack",
  "@evjs/bundler-webpack",
]);

const allowedDocumentationImportPackages = new Set([
  "@evjs/client",
  "@evjs/ev",
  "@evjs/server",
  "@evjs/bundler-utoopack",
]);

const allowedSampleBundlerDependencies = {
  "@evjs/bundler-utoopack": [
    "examples/plugin-authoring",
    "packages/create-app/templates/plugin-authoring",
  ],
  "@evjs/bundler-webpack": [
    "examples/deployment-adapters",
    "examples/render-modes",
  ],
} as const satisfies Record<string, readonly string[]>;

const forbiddenCoreBundlerPackages = [
  "@utoo/pack",
  "webpack",
  "webpack-dev-server",
] as const;

const generatedFrameworkArtifacts = [
  ".evjs",
  ".turbopack",
  "evjs-route-types.d.ts",
] as const;

const forbiddenPackageNames = [
  "@evjs/build-tools",
  "@evjs/manifest",
  "@evjs/router",
  "@evjs/router-tanstack",
];

const expectedBuildToolsRuntimeExports = [
  "analyzeRoutes",
  "createAppGraph",
  "createBuildPlan",
  "detectServerRouteExports",
  "detectUseClient",
  "diffBuildPlan",
  "discoverPageRoutes",
  "extractRscReferences",
  "extractServerFunctionExports",
  "extractServerRoutes",
  "generateHtml",
  "generatePageRouteTypes",
  "loadConfigFile",
  "resolveRoutes",
  "transformRscClientFile",
  "transformServerFile",
  "transpileTypeScriptConfig",
] as const;

const privateBuildToolsRuntimeExports = [
  "detectUseServer",
  "formatModuleExportName",
  "hashServerFunction",
  "makeFnId",
  "makeModuleId",
  "parseModuleRef",
] as const;

const expectedServerSubpathExports = [
  ".",
  "./app",
  "./fetch",
  "./framework",
  "./node",
  "./react",
  "./register",
] as const;

const forbiddenServerSubpathExports = [
  "./context",
  "./ecma",
  "./functions",
  "./middleware",
  "./routes",
] as const;

const expectedPackageExportSubpaths = {
  "@evjs/ev": [".", "./build-tools"],
  "@evjs/client": [
    ".",
    "./transport",
    "./internal",
    "./internal/page-context",
    "./internal/react-page",
    "./internal/route-types",
    "./internal/rsc-page-context",
    "./internal/rsc-runtime",
  ],
  "@evjs/server": expectedServerSubpathExports,
  "@evjs/cli": ["."],
  "@evjs/create-app": ["."],
  "@evjs/bundler-utoopack": ["."],
  "@evjs/bundler-webpack": ["."],
  "@evjs/shared": [".", "./manifest"],
} as const satisfies Record<PackageName, readonly string[]>;

describe("workspace package surface", () => {
  it("keeps the distributed evjs package set intentional", async () => {
    const packageDirs = await listPackageDirs();
    expect(packageDirs).toEqual(expectedPackageDirs);

    const packageNames = await Promise.all(packageDirs.map(readPackageName));
    expect(packageNames.sort()).toEqual(expectedPackageNames);
    expect(packageNames).not.toEqual(
      expect.arrayContaining(forbiddenPackageNames),
    );
  });

  it("keeps published package manifests ESM-only and narrow", async () => {
    for (const packageName of expectedPackageNames) {
      const packageJson = await readPackageJsonByName(packageName);
      expect(packageJson.type).toBe("module");
      expect(packageJson.private).not.toBe(true);
      expect(packageJson.license).toBe("MIT");
      expect(packageJson.publishConfig?.access).toBe("public");
      expect([...(packageJson.files ?? [])].sort()).toEqual(
        [...expectedPublishedFiles[packageName]].sort(),
      );
      expect(Object.keys(packageJson.exports ?? {}).sort()).toEqual(
        [...expectedPackageExportSubpaths[packageName]].sort(),
      );
      expect(packageJson.exports?.["."]).toEqual(
        expectedPrimaryPackageExports[packageName],
      );
      expect(packageJson.types).toBe(
        expectedPrimaryPackageExports[packageName].types,
      );
    }
  });

  it("keeps internal runtime package dependencies explicit and workspace-local", async () => {
    for (const packageName of expectedPackageNames) {
      const packageJson = await readPackageJsonByName(packageName);
      const internalDependencies = evjsRuntimeDependencyNames(packageJson);

      expect(internalDependencies).toEqual(
        [...expectedInternalRuntimeDependencies[packageName]].sort(),
      );

      for (const dependencyName of internalDependencies) {
        expect(packageJson.dependencies?.[dependencyName]).toBe("*");
      }
    }
  });

  it("keeps application-facing packages free of tooling dependencies", async () => {
    for (const packageName of frameworkEntryPackages) {
      expect(packageDistribution[packageName].role).toBe("framework");
    }
    for (const packageName of runtimeImplementationPackages) {
      expect(packageDistribution[packageName].role).toBe("runtime");
    }

    for (const packageName of publicRuntimePackages) {
      const packageJson = await readPackageJsonByName(packageName);
      expect(runtimeDependencyNames(packageJson)).not.toEqual(
        expect.arrayContaining([
          "@evjs/cli",
          "@evjs/create-app",
          "@evjs/bundler-utoopack",
          "@evjs/bundler-webpack",
        ]),
      );
    }
  });

  it("keeps @evjs/ev focused on framework config and build tooling", async () => {
    const evPackageJson = await readPackageJson("ev");
    const exportedSubpaths = Object.keys(evPackageJson.exports ?? {}).sort();

    expect(exportedSubpaths).toEqual(expectedPackageExportSubpaths["@evjs/ev"]);
    expect(exportedSubpaths).not.toEqual(
      expect.arrayContaining([
        "./client",
        "./client/internal",
        "./client/internal/page-context",
        "./client/internal/react-page",
        "./client/internal/route-types",
        "./client/internal/rsc-page-context",
        "./client/internal/rsc-runtime",
        "./server",
        "./server/fetch",
        "./server/node",
        "./server/react",
        "./server/register",
      ]),
    );
    expect(evjsRuntimeDependencyNames(evPackageJson)).toEqual(["@evjs/shared"]);
  });

  it("keeps default bundler ownership in the CLI package", async () => {
    const consumers = await packagesWithRuntimeDependency(
      "@evjs/bundler-utoopack",
    );
    expect(consumers).toEqual(["@evjs/cli"]);

    const webpackConsumers = await packagesWithRuntimeDependency(
      "@evjs/bundler-webpack",
    );
    expect(webpackConsumers).toEqual([]);
  });

  it("keeps bundler adapters on the framework package", async () => {
    for (const packageName of bundlerAdapterPackages) {
      const packageJson = await readPackageJsonByName(packageName);
      const declaredEvjsPackages = [...allDependencyNames(packageJson)]
        .filter((dependencyName) => dependencyName.startsWith("@evjs/"))
        .sort();

      expect(declaredEvjsPackages).toEqual(["@evjs/ev"]);
    }
  });

  it("keeps @evjs/ev independent from concrete bundler packages", async () => {
    const evPackageJson = await readPackageJson("ev");
    const declaredDependencies = allDependencyNames(evPackageJson);
    const violations: string[] = [];

    for (const packageName of forbiddenCoreBundlerPackages) {
      if (declaredDependencies.has(packageName)) {
        violations.push(`packages/ev/package.json declares ${packageName}`);
      }
    }

    for (const sourceFile of await listSourceFiles(
      path.join(repoRoot, "packages/ev/src"),
    )) {
      const relativeFile = path.relative(repoRoot, sourceFile);
      const source = await fs.readFile(sourceFile, "utf-8");

      for (const packageName of forbiddenCoreBundlerPackages) {
        const packageLiteral = new RegExp(
          `["']${escapeRegExp(packageName)}["']`,
        );
        if (packageLiteral.test(source)) {
          violations.push(`${relativeFile} references ${packageName}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps @evjs/ev/build-tools limited to bundler and CLI tooling APIs", () => {
    const runtimeExports = Object.keys(buildTools).sort();

    expect(runtimeExports).toEqual([...expectedBuildToolsRuntimeExports]);
    expect(runtimeExports).not.toEqual(
      expect.arrayContaining([...privateBuildToolsRuntimeExports]),
    );
  });

  it("does not keep @evjs/ev source shims for runtime packages", async () => {
    const removedFacadeFiles = [
      "packages/ev/src/client.ts",
      "packages/ev/src/client-internal.ts",
      "packages/ev/src/client-internal-page-context.ts",
      "packages/ev/src/client-internal-react-page.ts",
      "packages/ev/src/client-internal-route-types.ts",
      "packages/ev/src/client-internal-rsc-page-context.ts",
      "packages/ev/src/client-internal-rsc-runtime.ts",
      "packages/ev/src/server.ts",
      "packages/ev/src/server-fetch.ts",
      "packages/ev/src/server-node.ts",
      "packages/ev/src/server-react.ts",
      "packages/ev/src/server-register.ts",
    ];

    for (const removedFile of removedFacadeFiles) {
      expect(await fileExists(path.join(repoRoot, removedFile))).toBe(false);
    }
  });

  it("keeps shared as a contract package instead of a feature package", async () => {
    const sharedPackageJson = await readPackageJson("shared");
    expect(runtimeDependencyNames(sharedPackageJson)).toEqual([]);

    const readme = await fs.readFile(
      path.join(repoRoot, "packages/shared/README.md"),
      "utf-8",
    );
    expect(readme).toContain(
      "Application code should not import this package directly",
    );
    expect(readme).toContain("@evjs/shared/manifest");
    expect(readme).toContain("@evjs/client");
    expect(readme).toContain("@evjs/server");
    expect(readme).toContain("build identifier validation");
    expect(readme).toContain("path pattern validation");
    expect(readme).toContain("server-function ID validation");
    expect(readme).not.toContain("npm install @evjs/shared");
    expect(readme).not.toContain('from "@evjs/shared";');
  });

  it("documents every distributed package role for users and agents", async () => {
    const architectureDoc = await fs.readFile(
      path.join(repoRoot, "docs/docs/architecture.md"),
      "utf-8",
    );

    for (const packageName of expectedPackageNames) {
      expect(architectureDoc).toContain(packageName);
    }
    expect(architectureDoc).toContain(
      "Application code imports config, plugin, build, and deployment APIs through",
    );
    expect(architectureDoc).toContain(
      "`@evjs/ev`. Runtime APIs come from `@evjs/client` and `@evjs/server`",
    );
    expect(architectureDoc).toContain("`@evjs/ev` consumes");
    expect(architectureDoc).toContain("does not publish runtime subpaths");
    expect(architectureDoc).toContain("@evjs/client/internal/*");
    expect(architectureDoc).toContain("@evjs/client/internal/route-types");
    expect(architectureDoc).toContain("generated-only internal helpers");
    expect(architectureDoc).toContain(
      "Published package manifests stay ESM-only and intentionally narrow",
    );
    expect(architectureDoc).toContain(
      "Subpath exports stay explicit and documented",
    );
    expect(architectureDoc).toContain(
      "Internal `@evjs/*` runtime dependencies are kept explicit",
    );
    expect(architectureDoc).toContain(
      "Documentation code examples follow the same package boundary",
    );
  });

  it("keeps the root agent guide discoverable and package-boundary aware", async () => {
    const readme = await fs.readFile(path.join(repoRoot, "README.md"), "utf-8");
    const agentGuide = await fs.readFile(
      path.join(repoRoot, "AGENTS.md"),
      "utf-8",
    );

    expect(readme).toContain("[AGENTS.md](./AGENTS.md)");
    expect(agentGuide).toContain("[AGENT.md](./AGENT.md)");
    expect(agentGuide).toContain("[ARCHITECTURE.md](./ARCHITECTURE.md)");
    expect(agentGuide).toContain("[CONTRIBUTING.md](./CONTRIBUTING.md)");
    expect(agentGuide).toContain(
      "Keep config/build/plugin imports on `@evjs/ev`",
    );
    expect(agentGuide).toContain("`@evjs/client` and `@evjs/server`");
    expect(agentGuide).toContain(
      "packages/ev/src/build-tools/page-route-conventions.ts",
    );
    expect(agentGuide).toContain("packages/ev/src/build-tools/page-routes.ts");
    expect(agentGuide).toContain(
      "packages/ev/tests/build-tools-page-routes.test.ts",
    );
    expect(agentGuide).toContain(
      "Do not add new distributed `@evjs/*` packages",
    );
    expect(agentGuide).toContain("Scaffolded apps and template packs");
  });

  it("keeps public package guidance on direct runtime packages", async () => {
    const packageTableDocs = [
      "README.md",
      "docs/docs/quick-start.md",
      "docs/i18n/zh-Hans/docusaurus-plugin-content-docs/current/quick-start.md",
    ];
    const facadeGuidanceDocs = [
      ...packageTableDocs,
      "docs/docs/roadmap.md",
      "docs/i18n/zh-Hans/docusaurus-plugin-content-docs/current/roadmap.md",
    ];

    for (const doc of packageTableDocs) {
      const source = await fs.readFile(path.join(repoRoot, doc), "utf-8");
      expect(source).toContain("@evjs/ev");
      expect(source).toContain("@evjs/client");
      expect(source).toContain("@evjs/server");
      expect(source).not.toContain("@evjs/ev/client");
      expect(source).not.toContain("@evjs/ev/server");
    }

    for (const doc of facadeGuidanceDocs) {
      const source = await fs.readFile(path.join(repoRoot, doc), "utf-8");
      expect(source).toContain("@evjs/client");
      expect(source).not.toContain(
        "Direct `@evjs/client` and `@evjs/server` imports remain supported runtime",
      );
      expect(source).not.toContain(
        "直接从 `@evjs/client` 和 `@evjs/server` 导入仍然是受支持的 runtime 包边界",
      );
      expect(source).not.toContain("from the public `@evjs/client` package");
      expect(source).not.toContain("通过公开 `@evjs/client` 包");
    }
  });

  it("keeps root engineering guides aligned with package boundaries", async () => {
    const rootArchitecture = await fs.readFile(
      path.join(repoRoot, "ARCHITECTURE.md"),
      "utf-8",
    );
    const rootContributing = await fs.readFile(
      path.join(repoRoot, "CONTRIBUTING.md"),
      "utf-8",
    );

    for (const packageName of expectedPackageNames) {
      expect(rootArchitecture).toContain(packageName);
      expect(rootContributing).toContain(packageName);
    }
    expect(rootArchitecture).toContain(
      "`@evjs/ev` owns config, plugin, build, and deployment APIs",
    );
    expect(rootArchitecture).toContain("`@evjs/client`");
    expect(rootArchitecture).toContain(
      "`@evjs/ev` exports stay limited to framework",
    );
    expect(rootArchitecture).toContain("and build tooling entries");
    expect(rootArchitecture).toContain(
      "Internal `@evjs/*` runtime dependencies are kept explicit",
    );
    expect(rootArchitecture).toContain(
      "Subpath exports stay explicit and documented",
    );
    expect(rootArchitecture).toContain(
      "Do not reintroduce legacy split packages",
    );
    expect(rootContributing).toContain(
      "Internal `@evjs/*` runtime dependency versions stay",
    );
    expect(rootContributing).toContain(
      "Config/build imports stay on `@evjs/ev`; runtime imports use `@evjs/client`",
    );
    expect(rootContributing).toContain("and `@evjs/server`");
    expect(rootContributing).toContain("intentional and documented");
    expect(rootContributing).toContain("Generated page");
    expect(rootContributing).toContain("shell runtime primitives stay behind");
  });

  it("keeps examples and templates on declared public packages", async () => {
    const violations: string[] = [];
    const sampleDirs = [
      ...(await listExampleDirs()),
      ...(await listTemplateDirs()),
    ];

    for (const sampleDir of sampleDirs) {
      const relativeSampleDir = path.relative(repoRoot, sampleDir);
      const packageJson = await readSamplePackageJson(sampleDir);
      const declaredDependencies = allDependencyNames(packageJson);

      for (const dependencyName of declaredDependencies) {
        if (
          dependencyName.startsWith("@evjs/") &&
          !allowedExamplePackageDependencies.has(dependencyName)
        ) {
          violations.push(
            `${path.relative(repoRoot, sampleDir)} declares ${dependencyName}`,
          );
        }
        if (
          dependencyName.startsWith("@evjs/bundler-") &&
          !isAllowedSampleBundlerDependency(relativeSampleDir, dependencyName)
        ) {
          violations.push(
            `${relativeSampleDir} declares adapter dependency ${dependencyName}`,
          );
        }
      }

      const sourceFiles = await listSourceFiles(sampleDir);
      for (const sourceFile of sourceFiles) {
        const relativeFile = path.relative(repoRoot, sourceFile);
        const source = await fs.readFile(sourceFile, "utf-8");

        for (const importSpecifier of parseEvjsImportSpecifiers(source)) {
          const packageName = packageNameFromSpecifier(importSpecifier);
          if (!declaredDependencies.has(packageName)) {
            violations.push(
              `${relativeFile} imports undeclared ${packageName}`,
            );
          }
          if (
            importSpecifier.startsWith("@evjs/shared") ||
            importSpecifier.startsWith("@evjs/create-app") ||
            importSpecifier.startsWith("@evjs/ev/build-tools") ||
            forbiddenPackageNames.some(
              (forbiddenName) =>
                importSpecifier === forbiddenName ||
                importSpecifier.startsWith(`${forbiddenName}/`),
            )
          ) {
            violations.push(
              `${relativeFile} imports private ${importSpecifier}`,
            );
          }
          if (
            importSpecifier.startsWith("@evjs/client/internal") &&
            !relativeFile.endsWith("src/evjs-route-types.d.ts")
          ) {
            violations.push(
              `${relativeFile} imports generated-only ${importSpecifier}`,
            );
          }
          if (
            importSpecifier.startsWith("@evjs/bundler-") &&
            !relativeFile.endsWith("ev.config.ts")
          ) {
            violations.push(
              `${relativeFile} imports adapter outside config ${importSpecifier}`,
            );
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps examples and templates ignoring generated framework artifacts", async () => {
    const violations: string[] = [];
    const sampleDirs = [
      ...(await listExampleDirs()),
      ...(await listTemplateDirs()),
    ];

    for (const sampleDir of sampleDirs) {
      const relativeSampleDir = path.relative(repoRoot, sampleDir);
      const gitignorePath = path.join(sampleDir, ".gitignore");

      if (!(await fileExists(gitignorePath))) {
        violations.push(`${relativeSampleDir} is missing .gitignore`);
        continue;
      }

      const ignoredEntries = new Set(
        (await fs.readFile(gitignorePath, "utf-8"))
          .split(/\r?\n/)
          .map((entry) => entry.trim())
          .filter(Boolean),
      );

      for (const artifact of generatedFrameworkArtifacts) {
        if (!ignoredEntries.has(artifact)) {
          violations.push(
            `${relativeSampleDir}/.gitignore does not ignore ${artifact}`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps server-disabled examples off the server runtime package", async () => {
    const violations: string[] = [];
    const sampleDirs = [
      ...(await listExampleDirs()),
      ...(await listTemplateDirs()),
    ];

    for (const sampleDir of sampleDirs) {
      if (!(await sampleDisablesFrameworkServer(sampleDir))) continue;

      const relativeSampleDir = path.relative(repoRoot, sampleDir);
      const packageJson = await readSamplePackageJson(sampleDir);
      const declaredDependencies = allDependencyNames(packageJson);
      if (declaredDependencies.has("@evjs/server")) {
        violations.push(
          `${relativeSampleDir} declares @evjs/server with server: false`,
        );
      }

      const sourceFiles = await listSourceFiles(sampleDir);
      for (const sourceFile of sourceFiles) {
        const relativeFile = path.relative(repoRoot, sourceFile);
        const source = await fs.readFile(sourceFile, "utf-8");
        for (const importSpecifier of parseEvjsImportSpecifiers(source)) {
          if (packageNameFromSpecifier(importSpecifier) === "@evjs/server") {
            violations.push(
              `${relativeFile} imports ${importSpecifier} with server: false`,
            );
          }
        }
        if (hasUseServerDirective(source)) {
          violations.push(
            `${relativeFile} uses "use server" with server: false`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps MPA examples router-free and runtime-light", async () => {
    const violations: string[] = [];
    const sampleDirs = [
      ...(await listExampleDirs()),
      ...(await listTemplateDirs()),
    ];

    for (const sampleDir of sampleDirs) {
      if (!(await sampleUsesMpaRouting(sampleDir))) continue;

      const relativeSampleDir = path.relative(repoRoot, sampleDir);
      const packageJson = await readSamplePackageJson(sampleDir);
      const declaredDependencies = allDependencyNames(packageJson);
      for (const packageName of ["@evjs/client", "@evjs/server"]) {
        if (declaredDependencies.has(packageName)) {
          violations.push(
            `${relativeSampleDir} declares ${packageName} with routing.mode: "mpa"`,
          );
        }
      }

      const sourceFiles = await listSourceFiles(sampleDir);
      for (const sourceFile of sourceFiles) {
        const relativeFile = path.relative(repoRoot, sourceFile);
        const source = await fs.readFile(sourceFile, "utf-8");
        for (const importSpecifier of parseEvjsImportSpecifiers(source)) {
          const packageName = packageNameFromSpecifier(importSpecifier);
          if (
            packageName === "@evjs/client" ||
            packageName === "@evjs/server"
          ) {
            violations.push(
              `${relativeFile} imports ${importSpecifier} with routing.mode: "mpa"`,
            );
          }
        }
      }

      for (const routeTypesFile of await listFilesNamed(
        sampleDir,
        "evjs-route-types.d.ts",
      )) {
        violations.push(
          `${path.relative(repoRoot, routeTypesFile)} should not exist in an MPA sample`,
        );
      }
    }

    expect(violations).toEqual([]);
  });

  it("detects evjs imports across static, side-effect, re-export, and dynamic syntax", () => {
    expect(
      parseEvjsImportSpecifiers(`
        import { defineConfig } from "@evjs/ev";
        import { createRoute } from "@evjs/server";
        import "@evjs/server/register";
        export { createApp } from "@evjs/server";
        export * from "@evjs/client/internal";
        const runtime = import("@evjs/shared/manifest");
      `),
    ).toEqual([
      "@evjs/ev",
      "@evjs/server",
      "@evjs/server/register",
      "@evjs/server",
      "@evjs/client/internal",
      "@evjs/shared/manifest",
    ]);
  });

  it("keeps documentation code examples on public package imports", async () => {
    const violations: string[] = [];
    const docsFiles = await listDocumentationFiles();

    for (const docsFile of docsFiles) {
      const relativeFile = path.relative(repoRoot, docsFile);
      const source = await fs.readFile(docsFile, "utf-8");

      for (const importSpecifier of parseEvjsImportSpecifiers(source)) {
        const packageName = packageNameFromSpecifier(importSpecifier);
        if (!allowedDocumentationImportPackages.has(packageName)) {
          violations.push(
            `${relativeFile} imports non-documentation package ${importSpecifier}`,
          );
          continue;
        }

        if (
          importSpecifier.startsWith("@evjs/client/internal") ||
          importSpecifier.startsWith("@evjs/ev/build-tools") ||
          importSpecifier.startsWith("@evjs/shared") ||
          forbiddenPackageNames.some(
            (forbiddenName) =>
              importSpecifier === forbiddenName ||
              importSpecifier.startsWith(`${forbiddenName}/`),
          )
        ) {
          violations.push(`${relativeFile} imports private ${importSpecifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps the lockfile on the intentional evjs package set", async () => {
    const lockfile = JSON.parse(
      await fs.readFile(path.join(repoRoot, "package-lock.json"), "utf-8"),
    ) as {
      packages?: Record<string, { name?: string }>;
    };

    const lockedPackageNames = [
      ...new Set(
        Object.values(lockfile.packages ?? {})
          .map((pkg) => pkg.name)
          .filter((name): name is string => typeof name === "string"),
      ),
    ].sort();
    const lockedEvjsPackageNames = lockedPackageNames.filter((name) =>
      name.startsWith("@evjs/"),
    );

    expect(lockedEvjsPackageNames).toEqual(expectedPackageNames);
    expect(lockedPackageNames).not.toEqual(
      expect.arrayContaining(forbiddenPackageNames),
    );
  });

  it("keeps @evjs/client published subpath exports intentional", async () => {
    const clientPackageJson = JSON.parse(
      await fs.readFile(
        path.join(repoRoot, "packages/client/package.json"),
        "utf-8",
      ),
    ) as {
      exports?: Record<string, unknown>;
    };

    const exportedSubpaths = Object.keys(
      clientPackageJson.exports ?? {},
    ).sort();
    expect(exportedSubpaths).toEqual([
      ".",
      "./internal",
      "./internal/page-context",
      "./internal/react-page",
      "./internal/route-types",
      "./internal/rsc-page-context",
      "./internal/rsc-runtime",
      "./transport",
    ]);
    expect(clientPackageJson.exports?.["./transport"]).toEqual({
      types: "./esm/transport.d.ts",
      import: "./esm/transport.js",
      default: "./esm/transport.js",
    });
    expect(exportedSubpaths).not.toEqual(
      expect.arrayContaining([
        "./app",
        "./internal/app",
        "./internal/page-route",
        "./internal/react",
        "./internal/shell",
        "./navigation",
        "./page-route",
        "./route",
        "./tanstack",
      ]),
    );
  });

  it("keeps @evjs/server subpath exports intentional and documented", async () => {
    const serverPackageJson = JSON.parse(
      await fs.readFile(
        path.join(repoRoot, "packages/server/package.json"),
        "utf-8",
      ),
    ) as {
      exports?: Record<string, unknown>;
    };

    const exportedSubpaths = Object.keys(
      serverPackageJson.exports ?? {},
    ).sort();
    expect(exportedSubpaths).toEqual([...expectedServerSubpathExports]);
    expect(exportedSubpaths).not.toEqual(
      expect.arrayContaining([...forbiddenServerSubpathExports]),
    );

    const readme = await fs.readFile(
      path.join(repoRoot, "packages/server/README.md"),
      "utf-8",
    );
    expect(readme).toContain("@evjs/server/node");
    expect(readme).toContain("@evjs/server/fetch");
    expect(readme).toContain(`export { fetch } from "@evjs/server/fetch"`);
    expect(readme).not.toContain("@evjs/server/ecma");
  });
});

async function listPackageDirs(): Promise<string[]> {
  const entries = await fs.readdir(path.join(repoRoot, "packages"), {
    withFileTypes: true,
  });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function readPackageName(packageDir: string): Promise<string> {
  const packageJson = await readPackageJson(packageDir);
  if (!packageJson.name) {
    throw new Error(`Missing package name for packages/${packageDir}`);
  }
  return packageJson.name;
}

type PackageJson = {
  name?: string;
  type?: string;
  types?: string;
  private?: boolean;
  license?: string;
  publishConfig?: {
    access?: string;
  };
  files?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  exports?: Record<string, unknown>;
};

async function readPackageJson(packageDir: string): Promise<PackageJson> {
  return JSON.parse(
    await fs.readFile(
      path.join(repoRoot, "packages", packageDir, "package.json"),
      "utf-8",
    ),
  ) as PackageJson;
}

async function readPackageJsonByName(
  packageName: keyof typeof packageDistribution,
): Promise<PackageJson> {
  return readPackageJson(packageDistribution[packageName].dir);
}

function runtimeDependencyNames(packageJson: PackageJson): string[] {
  return Object.keys(packageJson.dependencies ?? {}).sort();
}

function evjsRuntimeDependencyNames(packageJson: PackageJson): string[] {
  return runtimeDependencyNames(packageJson).filter((dependencyName) =>
    dependencyName.startsWith("@evjs/"),
  );
}

function allDependencyNames(packageJson: PackageJson): Set<string> {
  return new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
  ]);
}

function isAllowedSampleBundlerDependency(
  relativeSampleDir: string,
  dependencyName: string,
): boolean {
  const allowedSampleDirs = (
    allowedSampleBundlerDependencies as Record<string, readonly string[]>
  )[dependencyName];
  return allowedSampleDirs?.includes(relativeSampleDir) ?? false;
}

async function listExampleDirs(): Promise<string[]> {
  return listChildPackageDirs(path.join(repoRoot, "examples"));
}

async function listTemplateDirs(): Promise<string[]> {
  return listChildPackageDirs(
    path.join(repoRoot, "packages/create-app/templates"),
  );
}

async function listChildPackageDirs(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, {
    withFileTypes: true,
  });
  const dirs: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (!(await isDirectory(entryPath))) {
      continue;
    }
    if (await fileExists(path.join(entryPath, "package.json"))) {
      dirs.push(entryPath);
    }
  }

  return dirs.sort();
}

async function readSamplePackageJson(sampleDir: string): Promise<PackageJson> {
  return JSON.parse(
    await fs.readFile(path.join(sampleDir, "package.json"), "utf-8"),
  ) as PackageJson;
}

async function sampleDisablesFrameworkServer(
  sampleDir: string,
): Promise<boolean> {
  const configPath = path.join(sampleDir, "ev.config.ts");
  if (!(await fileExists(configPath))) return false;
  const source = await fs.readFile(configPath, "utf-8");
  return /\bserver\s*:\s*false\b/.test(source);
}

async function sampleUsesMpaRouting(sampleDir: string): Promise<boolean> {
  const configPath = path.join(sampleDir, "ev.config.ts");
  if (!(await fileExists(configPath))) return false;
  const source = await fs.readFile(configPath, "utf-8");
  return /\bmode\s*:\s*["']mpa["']/.test(source);
}

async function listSourceFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const sourceFiles: string[] = [];

  for (const entry of entries) {
    if (
      [".turbo", "dist", "node_modules"].includes(entry.name) ||
      generatedFrameworkArtifacts.includes(
        entry.name as (typeof generatedFrameworkArtifacts)[number],
      )
    ) {
      continue;
    }

    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles.push(...(await listSourceFiles(entryPath)));
      continue;
    }

    if (entry.isFile() && isSourceFile(entryPath)) {
      sourceFiles.push(entryPath);
    }
  }

  return sourceFiles.sort();
}

async function listFilesNamed(dir: string, name: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if ([".turbo", "dist", "node_modules"].includes(entry.name)) {
      continue;
    }

    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesNamed(entryPath, name)));
      continue;
    }

    if (entry.isFile() && entry.name === name) {
      files.push(entryPath);
    }
  }

  return files.sort();
}

async function listDocumentationFiles(): Promise<string[]> {
  return [
    ...(await listMarkdownFiles(path.join(repoRoot, "docs/docs"))),
    ...(await listMarkdownFiles(
      path.join(
        repoRoot,
        "docs/i18n/zh-Hans/docusaurus-plugin-content-docs/current",
      ),
    )),
  ].sort();
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const markdownFiles: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      markdownFiles.push(...(await listMarkdownFiles(entryPath)));
      continue;
    }

    if (entry.isFile() && path.extname(entryPath) === ".md") {
      markdownFiles.push(entryPath);
    }
  }

  return markdownFiles.sort();
}

function isSourceFile(filePath: string): boolean {
  return [".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"].includes(
    path.extname(filePath),
  );
}

function parseEvjsImportSpecifiers(source: string): string[] {
  return Array.from(
    source.matchAll(
      /(?:from\s+["']|import\s+(?:[^"';]+\s+from\s+)?["']|import\s*\(\s*["'])(@evjs\/[^"']+)/g,
    ),
    (match) => match[1],
  );
}

function packageNameFromSpecifier(specifier: string): string {
  const [scope, name] = specifier.split("/");
  return `${scope}/${name}`;
}

function hasUseServerDirective(source: string): boolean {
  return /(?:^|\n)\s*["']use server["']/.test(source);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isDirectory();
  } catch {
    return false;
  }
}

async function packagesWithRuntimeDependency(
  dependencyName: string,
): Promise<string[]> {
  const consumers: string[] = [];

  for (const packageName of expectedPackageNames) {
    const packageJson = await readPackageJsonByName(packageName);
    if (runtimeDependencyNames(packageJson).includes(dependencyName)) {
      if (!packageJson.name) {
        throw new Error(`Missing package name for dependency consumer`);
      }
      consumers.push(packageJson.name);
    }
  }

  return consumers.sort();
}
