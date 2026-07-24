import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GraphConfig } from "../src/_internal/build/graph/index.js";
import { createCoreGraph } from "../src/_internal/build/graph/index.js";
import { resolvePageConfigModules } from "../src/_internal/build/page-config-module.js";
import {
  analyzePageModuleExports,
  findRemovedPageModuleConfigExports,
} from "../src/_internal/build/page-module-config.js";
import type {
  PageAnchorMetadata,
  PageRouteDiscoveryMetadata,
} from "../src/config/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("page.config modules", () => {
  it("detects removed component rendering exports without evaluating values", () => {
    expect(
      findRemovedPageModuleConfigExports(`
        export function render() {}
        class LegacyHydration {}
        export { LegacyHydration as hydrate };
        export { legacy as prerender } from "./legacy.js";
        export const rsc = getRuntimeValue();
      `),
    ).toEqual(["render", "hydrate", "prerender", "rsc"]);

    expect(
      findRemovedPageModuleConfigExports(`
        export type { render, hydrate, prerender, rsc } from "./types.js";
      `),
    ).toEqual([]);
  });

  it("collects browser route lifecycle exports without evaluating values", () => {
    expect(
      analyzePageModuleExports(`
        export async function beforeLoad() {}
        const load = () => {};
        export { load as loader };
        export { validateSearch } from "./search.js";
        export type { pendingComponent } from "./types.js";
      `),
    ).toEqual({
      removedConfig: [],
      routeLifecycle: ["beforeLoad", "loader", "validateSearch"],
    });
  });

  it("evaluates TypeScript helpers and tracks the transitive dependency closure", async () => {
    const cwd = await createFixture({
      "src/config/channel.ts": 'export const channel = "stable";',
      "src/config/page-settings.ts": `
        import { channel } from "./channel.js";

        export const settings = {
          enabled: true,
          channel,
        } as const;
      `,
      "src/pages/report/page.tsx":
        "export default function Report() { return null; }",
      "src/pages/report/page.config.ts": `
        import type { PageFileConfig } from "@evjs/ev";
        import { settings } from "../../config/page-settings.js";

        const config = {
          title: "Quarterly report",
          meta: {
            description: "Quarterly performance",
            Robots: "noindex",
          },
          render: "ssr",
          hydrate: "none",
          prerender: { revalidate: 60 },
          rsc: true,
          extensions: {
            "@company/feature": settings,
          },
        } satisfies PageFileConfig;

        export default config;
      `,
    });
    const metadata = createPageMetadata(
      "report",
      "./src/pages/report/page.config.ts",
    );

    const first = await resolvePageConfigModules(cwd, metadata);

    expect(first.pages.report).toEqual({
      source: "./src/pages/report/page.config.ts",
      render: "ssr",
      componentModel: "rsc",
      hydrate: "none",
      prerender: { revalidate: 60 },
      metadata: {
        title: "Quarterly report",
        meta: {
          description: "Quarterly performance",
          Robots: "noindex",
        },
      },
      extensions: {
        "@company/feature": {
          enabled: true,
          channel: "stable",
        },
      },
    });
    expect(
      (
        await Promise.all(first.dependencies.map((file) => fs.realpath(file)))
      ).sort(),
    ).toEqual(
      (
        await Promise.all(
          [
            path.join(cwd, "src/config/channel.ts"),
            path.join(cwd, "src/config/page-settings.ts"),
            path.join(cwd, "src/pages/report/page.config.ts"),
          ].map((file) => fs.realpath(file)),
        )
      ).sort(),
    );

    await fs.writeFile(
      path.join(cwd, "src/config/channel.ts"),
      'export const channel = "next";',
      "utf-8",
    );

    const second = await resolvePageConfigModules(cwd, metadata);

    expect(second.pages.report.extensions["@company/feature"]).toEqual({
      enabled: true,
      channel: "next",
    });
    expect(second.dependencies).toEqual(first.dependencies);
  });

  it("invalidates helpers loaded by a previously failing config evaluation", async () => {
    const cwd = await createFixture({
      "src/config/channel.ts": 'export const channel = "stale";',
      "src/pages/report/page.tsx":
        "export default function Report() { return null; }",
      "src/pages/report/page.config.ts": `
        import { channel } from "../../config/channel";
        throw new Error("broken config");
        export default {
          extensions: { "@company/feature": { channel } },
        };
      `,
    });
    const metadata = createPageMetadata(
      "report",
      "./src/pages/report/page.config.ts",
    );

    await expect(resolvePageConfigModules(cwd, metadata)).rejects.toThrow(
      "Failed to load static config module",
    );
    await Promise.all([
      fs.writeFile(
        path.join(cwd, "src/config/channel.ts"),
        'export const channel = "fresh";',
        "utf-8",
      ),
      fs.writeFile(
        path.join(cwd, "src/pages/report/page.config.ts"),
        `
          import { channel } from "../../config/channel";
          export default {
            extensions: { "@company/feature": { channel } },
          };
        `,
        "utf-8",
      ),
    ]);

    const resolved = await resolvePageConfigModules(cwd, metadata);

    expect(resolved.pages.report.extensions["@company/feature"]).toEqual({
      channel: "fresh",
    });
  });

  it("invalidates helpers when a page config root is renamed", async () => {
    const cwd = await createFixture({
      "src/config/channel.ts": 'export const channel = "stale";',
      "src/pages/report/page.tsx":
        "export default function Report() { return null; }",
      "src/pages/report/page.config.ts": `
        import { channel } from "../../config/channel";
        export default {
          extensions: { "@company/feature": { channel } },
        };
      `,
    });
    const typescriptMetadata = createPageMetadata(
      "report",
      "./src/pages/report/page.config.ts",
    );

    const first = await resolvePageConfigModules(cwd, typescriptMetadata);
    expect(first.pages.report.extensions["@company/feature"]).toEqual({
      channel: "stale",
    });

    await Promise.all([
      fs.writeFile(
        path.join(cwd, "src/config/channel.ts"),
        'export const channel = "fresh";',
        "utf-8",
      ),
      fs.rename(
        path.join(cwd, "src/pages/report/page.config.ts"),
        path.join(cwd, "src/pages/report/page.config.js"),
      ),
    ]);

    const second = await resolvePageConfigModules(
      cwd,
      createPageMetadata("report", "./src/pages/report/page.config.js"),
    );

    expect(second.pages.report.extensions["@company/feature"]).toEqual({
      channel: "fresh",
    });
  });

  it.each([
    {
      label: "a missing default export",
      source: "export const config = {};",
      message: /must default-export a Page config object/,
    },
    {
      label: "an asynchronous default export",
      source: "export default Promise.resolve({});",
      message: /default export must be a plain object/,
    },
    {
      label: "a function default export",
      source: "export default function config() {}",
      message: /default export must be a plain object/,
    },
    {
      label: "an unknown top-level field",
      source: 'export default { head: "Home" };',
      message: /has unknown field "head"/,
    },
    {
      label: "a non-string title",
      source: "export default { title: 42 };",
      message: /metadata\.title must be a string/,
    },
    {
      label: "a non-object meta map",
      source: 'export default { meta: ["description"] };',
      message: /metadata\.meta must be a plain object/,
    },
    {
      label: "an empty meta name",
      source: 'export default { meta: { "": "Home" } };',
      message: /meta keys must be non-empty strings/,
    },
    {
      label: "an untrimmed meta name",
      source: 'export default { meta: { " description": "Home" } };',
      message: /must not include leading or trailing whitespace/,
    },
    {
      label: "a non-string meta value",
      source: "export default { meta: { description: true } };",
      message: /meta\.description must be a string/,
    },
    {
      label: "ASCII case-insensitive duplicate meta names",
      source:
        'export default { meta: { Description: "First", description: "Second" } };',
      message: /keys "Description" and "description" conflict/,
    },
    {
      label: "a function in an extension",
      source:
        'export default { extensions: { "@company/feature": () => true } };',
      message: /must be JSON-serializable/,
    },
    {
      label: "a non-finite number in an extension",
      source:
        'export default { extensions: { "@company/feature": Infinity } };',
      message: /must contain finite numbers/,
    },
    {
      label: "a class instance in an extension",
      source:
        'export default { extensions: { "@company/feature": new Date(0) } };',
      message: /must contain only arrays and plain objects/,
    },
    {
      label: "a cyclic extension value",
      source: `
        const value = {};
        value.self = value;
        export default { extensions: { "@company/feature": value } };
      `,
      message: /must not contain cycles/,
    },
    {
      label: "a sparse extension array",
      source: `
        const value = [];
        value.length = 1;
        export default { extensions: { "@company/feature": value } };
      `,
      message: /must not be a sparse array hole/,
    },
  ])("rejects $label", async ({ source, message }) => {
    const cwd = await createFixture({
      "src/pages/home/page.tsx":
        "export default function Home() { return null; }",
      "src/pages/home/page.config.ts": source,
    });

    await expect(
      resolvePageConfigModules(
        cwd,
        createPageMetadata("home", "./src/pages/home/page.config.ts"),
      ),
    ).rejects.toThrow(message);
  });

  it.each([
    {
      field: "render",
      source: 'export default { render: "ppr" };',
      message: /render must be "csr", "ssr", or "ssg"/,
    },
    {
      field: "hydrate",
      source: 'export default { hydrate: "interaction" };',
      message: /hydrate must be "none" or "load"/,
    },
    {
      field: "hydrate: visible",
      source: 'export default { hydrate: "visible" };',
      message: /hydrate must be "none" or "load"/,
    },
    {
      field: "hydrate: idle",
      source: 'export default { hydrate: "idle" };',
      message: /hydrate must be "none" or "load"/,
    },
    {
      field: "rsc",
      source: "export default { rsc: false };",
      message: /rsc must be true when provided/,
    },
    {
      field: "prerender",
      source: "export default { prerender: false };",
      message: /prerender must be true or a plain object/,
    },
  ])("validates the $field core field", async ({ source, message }) => {
    const cwd = await createFixture({
      "src/pages/home/page.tsx":
        "export default function Home() { return null; }",
      "src/pages/home/page.config.ts": source,
    });

    await expect(
      resolvePageConfigModules(
        cwd,
        createPageMetadata("home", "./src/pages/home/page.config.ts"),
      ),
    ).rejects.toThrow(message);
  });

  it.each([
    {
      feature: "RSC",
      source: 'export default { render: "ssr", hydrate: "load", rsc: true };',
      message:
        'Page "home" config "./src/pages/home/page.config.ts" uses RSC and must omit hydrate or declare hydrate: "none".',
    },
    {
      feature: "partial prerendering",
      source:
        'export default { render: "ssr", hydrate: "load", prerender: { partial: true } };',
      message:
        'Page "home" config "./src/pages/home/page.config.ts" uses partial prerendering and must omit hydrate or declare hydrate: "none".',
    },
  ])("rejects hydrate: load for $feature Page configs", async ({
    source,
    message,
  }) => {
    const cwd = await createFixture({
      "src/pages/home/page.tsx":
        "export default function Home() { return null; }",
      "src/pages/home/page.config.ts": source,
    });

    await expect(
      resolvePageConfigModules(
        cwd,
        createPageMetadata("home", "./src/pages/home/page.config.ts"),
      ),
    ).rejects.toThrow(message);
  });

  it.each([
    {
      hydration: "omitted",
      hydrate: "",
    },
    {
      hydration: "none",
      hydrate: 'hydrate: "none",',
    },
  ])("accepts partial prerendering when hydrate is $hydration", async ({
    hydrate,
  }) => {
    const cwd = await createFixture({
      "src/pages/home/page.tsx":
        "export default function Home() { return null; }",
      "src/pages/home/page.config.ts": `
          export default {
            render: "ssr",
            ${hydrate}
            prerender: { partial: true },
          };
        `,
    });

    const resolved = await resolvePageConfigModules(
      cwd,
      createPageMetadata("home", "./src/pages/home/page.config.ts"),
    );

    expect(resolved.pages.home).toMatchObject({
      render: "ssr",
      prerender: { partial: true },
    });
    if (hydrate) {
      expect(resolved.pages.home.hydrate).toBe("none");
    } else {
      expect(resolved.pages.home).not.toHaveProperty("hydrate");
    }
  });

  it("invalidates transitive helpers across graph analyses and publishes all config dependencies", async () => {
    const cwd = await createFixture({
      "index.html": '<div id="app"></div>',
      "src/config/render-mode.ts": 'export const render = "csr";',
      "src/config/page-settings.ts": `
        import { render } from "./render-mode.js";
        export const settings = { render };
      `,
      "src/pages/home/page.tsx":
        "export default function Home() { return null; }",
      "src/pages/home/page.config.ts": `
        import { settings } from "../../config/page-settings";
        export default { render: settings.render };
      `,
    });
    const config = createCanonicalGraphConfig(
      "home",
      "./src/pages/home/page.config.ts",
    );

    const first = await createCoreGraph(config, cwd);
    expect(first.graph.pages.home.render).toBe("csr");
    await expectRealDependencies(first.fileDependencies, [
      path.join(cwd, "src/config/render-mode.ts"),
      path.join(cwd, "src/config/page-settings.ts"),
      path.join(cwd, "src/pages/home/page.config.ts"),
    ]);

    await fs.writeFile(
      path.join(cwd, "src/config/render-mode.ts"),
      'export const render = "ssr";',
      "utf-8",
    );

    const second = await createCoreGraph(config, cwd);
    expect(second.graph.pages.home.render).toBe("ssr");
    await expectRealDependencies(second.fileDependencies, [
      path.join(cwd, "src/config/render-mode.ts"),
      path.join(cwd, "src/config/page-settings.ts"),
      path.join(cwd, "src/pages/home/page.config.ts"),
    ]);
  });

  it("does not consume legacy rendering exports from canonical page anchors", async () => {
    const cwd = await createFixture({
      "index.html": '<div id="app"></div>',
      "src/pages/home/page.tsx": `
        export const render = "ssr";
        export const hydrate = "load";
        export const prerender = true;
        export const rsc = true;
        export default function Home() { return null; }
      `,
    });
    const config = createCanonicalGraphConfig("home");

    const analysis = await createCoreGraph(config, cwd);

    expect(analysis.diagnostics).toEqual([
      {
        level: "error",
        file: "src/pages/home/page.tsx",
        message:
          'Page "home" declares render, hydrate, prerender, or rsc from its component module. Component rendering exports have been removed; move these fields to the adjacent page.config.ts module.',
      },
    ]);
    expect(analysis.graph.pages.home).toMatchObject({
      id: "home",
      render: "csr",
    });
    expect(analysis.graph.pages.home).not.toHaveProperty("hydrate");
    expect(analysis.graph.pages.home).not.toHaveProperty("prerender");
    expect(analysis.graph.pages.home).not.toHaveProperty("componentModel");
    expect(analysis.graph?.pages.home.extensions).toEqual({});
  });
});

function createPageMetadata(
  pageId: string,
  configModule?: string,
): PageRouteDiscoveryMetadata {
  const directory =
    pageId === "index" ? "./src/pages" : `./src/pages/${pageId}`;
  const page: PageAnchorMetadata = {
    pageId,
    directory,
    entry: `${directory}/page.tsx`,
    exportName: "default",
    ...(configModule ? { configModule } : {}),
  };
  return { pages: [page] };
}

function createCanonicalGraphConfig(
  pageId: string,
  configModule?: string,
): GraphConfig {
  const metadata = createPageMetadata(pageId, configModule);
  const page = metadata.pages?.[0];
  if (!page) throw new Error("Expected canonical Page metadata.");
  const routePath = pageId === "index" ? "/" : `/${pageId}`;
  return {
    routing: {
      mode: "spa",
      dir: "./src/pages",
      html: "./index.html",
      mount: "#app",
      routes: [
        {
          id: pageId,
          path: routePath,
          module: page.entry,
          scope: {
            kind: "directory",
            root: page.directory,
          },
        },
      ],
      metadata,
    },
    server: {},
  };
}

async function expectRealDependencies(
  received: string[],
  expected: string[],
): Promise<void> {
  const realReceived = new Set(
    await Promise.all(received.map((file) => fs.realpath(file))),
  );
  for (const file of expected) {
    expect(realReceived).toContain(await fs.realpath(file));
  }
}

async function createFixture(files: Record<string, string>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "evjs-page-config-"));
  tempDirs.push(dir);

  for (const [file, content] of Object.entries(files)) {
    const absolute = path.join(dir, file);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content);
  }

  return dir;
}
