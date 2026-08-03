import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { BuildPlan } from "@evjs/shared/manifest";
import { build as utoopackBuild } from "@utoo/pack";
import { afterEach, describe, expect, it } from "vitest";
import { createUtoopackConfig } from "../src/adapter/create-config.js";
import { runUtoopackBuild } from "../src/adapter/runtime.js";
import { UtoopackManifestGenerator } from "../src/manifest-generator.js";

const require = createRequire(import.meta.url);
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.promises.rm(dir, { recursive: true, force: true })),
  );
});

describe("Utoopack multi-server entries", () => {
  it("builds independently loadable runtime and page entries with shared chunks", async () => {
    const cwd = await fs.promises.mkdtemp(
      path.join(process.cwd(), ".tmp-utoopack-multi-server-"),
    );
    tempDirs.push(cwd);
    await writeFixture(cwd);
    const plan = createPlan();
    const config = await createUtoopackConfig(
      createResolvedConfig(),
      plan,
      cwd,
      [],
    );

    expect(config.server?.entry).toEqual([
      { name: "server", import: "./src/server.ts" },
      {
        name: "page-server-dashboard",
        import: "./src/dashboard.server.ts",
      },
      {
        name: "page-server-detail",
        import: "./src/detail.server.ts",
      },
    ]);

    await runUtoopackBuild({ build: utoopackBuild }, config, cwd);
    await fs.promises.writeFile(
      path.join(cwd, "dist/server/package.json"),
      JSON.stringify({ type: "commonjs" }),
    );

    const facts = await new UtoopackManifestGenerator(cwd, plan).build();
    const stats = JSON.parse(
      await fs.promises.readFile(
        path.join(cwd, "dist/server/stats.json"),
        "utf-8",
      ),
    ) as {
      entrypoints: Record<string, { assets: Array<{ name: string }> }>;
    };

    expect(Object.keys(stats.entrypoints).sort()).toEqual([
      "page-server-dashboard",
      "page-server-detail",
      "server",
    ]);
    expect(Object.keys(facts.serverEntryAssets ?? {}).sort()).toEqual([
      "page-server-dashboard",
      "page-server-detail",
      "server",
    ]);

    const assetReferenceCounts = new Map<string, number>();
    for (const entrypoint of Object.values(stats.entrypoints)) {
      const entrypointAssets = new Set(
        entrypoint.assets.map((asset) => asset.name.replace(/^\.\//, "")),
      );
      for (const asset of entrypointAssets) {
        assetReferenceCounts.set(
          asset,
          (assetReferenceCounts.get(asset) ?? 0) + 1,
        );
      }
    }
    const sharedAssets = [...assetReferenceCounts]
      .filter(([, references]) => references > 1)
      .map(([asset]) => asset);
    expect(sharedAssets.length).toBeGreaterThan(0);
    await expect(
      Promise.all(
        sharedAssets.map((asset) =>
          fs.promises.access(path.join(cwd, "dist/server", asset)),
        ),
      ),
    ).resolves.toBeDefined();

    for (const entry of Object.values(facts.serverEntryAssets ?? {})) {
      const entryAsset = entry.js[0];
      expect(entryAsset).toBeDefined();
      expect(() =>
        require(path.join(cwd, "dist/server", entryAsset as string)),
      ).not.toThrow();
    }
  }, 120_000);
});

function createResolvedConfig(): Parameters<typeof createUtoopackConfig>[0] {
  return {
    conventions: true,
    routing: {
      mode: "spa",
      html: "./index.html",
      mount: "#app",
      routes: [],
    },
    output: {
      client: "dist/client",
      server: "dist/server",
      crossOriginLoading: "anonymous",
    },
    dev: {
      port: 41234,
      https: false,
      proxy: [],
    },
    server: {
      basePath: "/__evjs",
      runtime: {
        basePath: "/__evjs",
        fn: "__evjs/fn",
        ppr: "__evjs/ppr",
      },
      dev: {
        port: 3001,
        https: false,
      },
    },
    transport: {},
    plugins: [],
  };
}

function createPlan(): BuildPlan {
  const renderers = [
    {
      name: "page-server-dashboard",
      import: "./src/dashboard.server.ts",
      kind: "page-server" as const,
      owner: { pageId: "dashboard", routeId: "dashboard" },
    },
    {
      name: "page-server-detail",
      import: "./src/detail.server.ts",
      kind: "page-server" as const,
      owner: { pageId: "detail", routeId: "detail" },
    },
  ];
  return {
    version: 1,
    buildId: "multi-server-test",
    mode: "production",
    distDir: "dist",
    output: {
      clientDir: "dist/client",
      serverDir: "dist/server",
    },
    entries: [
      {
        name: "main",
        import: "./src/client.ts",
        environment: "client",
        runtime: "browser",
        kind: "app-client",
        owner: { appId: "default" },
      },
      ...renderers.map((renderer) => ({
        ...renderer,
        environment: "server" as const,
        runtime: "node" as const,
      })),
      {
        name: "server",
        import: "./src/server.ts",
        environment: "server",
        runtime: "node",
        kind: "server-runtime",
      },
    ],
    html: [],
    server: {
      entry: "./src/server.ts",
      renderers,
    },
    dev: {
      clientRoutes: [],
      serverRequestRoutePaths: [],
      serverRenderedPagePaths: ["/dashboard", "/detail"],
      hasPpr: false,
    },
    runtime: {
      publicPath: "auto",
      server: {
        basePath: "/__evjs",
        fn: "__evjs/fn",
      },
    },
  };
}

async function writeFixture(cwd: string): Promise<void> {
  const sourceDir = path.join(cwd, "src");
  await fs.promises.mkdir(sourceDir, { recursive: true });
  await Promise.all([
    fs.promises.writeFile(
      path.join(sourceDir, "client.ts"),
      'console.log("client");\n',
    ),
    fs.promises.writeFile(
      path.join(sourceDir, "shared-all.ts"),
      'export const sharedAll = "shared by every server entry";\n',
    ),
    fs.promises.writeFile(
      path.join(sourceDir, "shared-primary.ts"),
      'import { sharedAll } from "./shared-all";\nexport const sharedPrimary = "primary " + sharedAll;\n',
    ),
    fs.promises.writeFile(
      path.join(sourceDir, "server.ts"),
      'import { sharedPrimary } from "./shared-primary";\nexport const serverEntry = sharedPrimary;\n',
    ),
    fs.promises.writeFile(
      path.join(sourceDir, "dashboard.server.ts"),
      'import { sharedPrimary } from "./shared-primary";\nexport const dashboardEntry = sharedPrimary;\n',
    ),
    fs.promises.writeFile(
      path.join(sourceDir, "detail.server.ts"),
      'import { sharedAll } from "./shared-all";\nexport const detailEntry = sharedAll;\n',
    ),
  ]);
}
