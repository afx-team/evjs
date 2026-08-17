import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { GraphConfig } from "../src/_internal/build/graph/index.js";
import { createCoreGraph } from "../src/_internal/build/graph/index.js";
import { resolvePageConfigModules } from "../src/_internal/build/page-config-module.js";
import { analyzePageModuleExports } from "../src/_internal/build/page-module-exports.js";
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
  it("collects Page rendering config exports without evaluating values", () => {
    expect(
      analyzePageModuleExports(`
        export function render() {}
        class HydrationMode {}
        export { HydrationMode as hydrate };
        export { staticPaths as prerender } from "./static-paths.js";
        export const rsc = getRuntimeValue();
      `),
    ).toMatchObject({
      renderingConfig: ["render", "hydrate", "prerender", "rsc"],
    });

    expect(
      analyzePageModuleExports(`
        export type { render, hydrate, prerender, rsc } from "./types.js";
      `),
    ).toMatchObject({ renderingConfig: [] });
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
      renderingConfig: [],
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
          plugins: {
            analytics: settings,
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
      plugins: {
        analytics: {
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

    expect(second.pages.report.plugins.analytics).toEqual({
      enabled: true,
      channel: "next",
    });
    expect(second.dependencies).toEqual(first.dependencies);
  });

  it("reuses one loading session across Page configs without retaining stale helpers", async () => {
    const cwd = await createFixture({
      "src/config/page-title.ts": 'export const title = "initial";',
      "src/pages/first/page.tsx":
        "export default function First() { return null; }",
      "src/pages/first/page.config.ts": `
        import { title } from "../../config/page-title.js";
        export default { title: \`first:\${title}\` };
      `,
      "src/pages/second/page.tsx":
        "export default function Second() { return null; }",
      "src/pages/second/page.config.ts": `
        import { title } from "../../config/page-title.js";
        export default { title: \`second:\${title}\` };
      `,
    });
    const metadata = createPagesMetadata([
      {
        pageId: "first",
        configModule: "./src/pages/first/page.config.ts",
      },
      {
        pageId: "second",
        configModule: "./src/pages/second/page.config.ts",
      },
    ]);

    const first = await resolvePageConfigModules(cwd, metadata);
    expect(first.pages.first.metadata?.title).toBe("first:initial");
    expect(first.pages.second.metadata?.title).toBe("second:initial");
    await expectRealDependencies(first.dependencies, [
      path.join(cwd, "src/config/page-title.ts"),
      path.join(cwd, "src/pages/first/page.config.ts"),
      path.join(cwd, "src/pages/second/page.config.ts"),
    ]);

    await fs.writeFile(
      path.join(cwd, "src/config/page-title.ts"),
      'export const title = "updated";',
      "utf-8",
    );

    const second = await resolvePageConfigModules(cwd, metadata);
    expect(second.pages.first.metadata?.title).toBe("first:updated");
    expect(second.pages.second.metadata?.title).toBe("second:updated");
    expect(second.dependencies).toEqual(first.dependencies);
  });

  it("keeps package-scoped aliases isolated within a shared loading session", async () => {
    const cwd = await createFixture({
      "src/pages/first/package.json": JSON.stringify({
        imports: { "#settings": "./settings.ts" },
      }),
      "src/pages/first/settings.ts": 'export const title = "first";',
      "src/pages/first/page.tsx":
        "export default function First() { return null; }",
      "src/pages/first/page.config.ts": `
        import { title } from "#settings";
        export default { title };
      `,
      "src/pages/second/package.json": JSON.stringify({
        imports: { "#settings": "./settings.ts" },
      }),
      "src/pages/second/settings.ts": 'export const title = "second";',
      "src/pages/second/page.tsx":
        "export default function Second() { return null; }",
      "src/pages/second/page.config.ts": `
        import { title } from "#settings";
        export default { title };
      `,
    });

    const resolved = await resolvePageConfigModules(
      cwd,
      createPagesMetadata([
        {
          pageId: "first",
          configModule: "./src/pages/first/page.config.ts",
        },
        {
          pageId: "second",
          configModule: "./src/pages/second/page.config.ts",
        },
      ]),
    );

    expect(resolved.pages.first.metadata?.title).toBe("first");
    expect(resolved.pages.second.metadata?.title).toBe("second");
    await expectRealDependencies(resolved.dependencies, [
      path.join(cwd, "src/pages/first/package.json"),
      path.join(cwd, "src/pages/first/settings.ts"),
      path.join(cwd, "src/pages/first/page.config.ts"),
      path.join(cwd, "src/pages/second/package.json"),
      path.join(cwd, "src/pages/second/settings.ts"),
      path.join(cwd, "src/pages/second/page.config.ts"),
    ]);
  });

  it("resolves false, true, and static object Page plugin settings", async () => {
    const cwd = await createFixture({
      "src/pages/checkout/page.tsx":
        "export default function Checkout() { return null; }",
      "src/pages/checkout/page.config.ts": `
        export default {
          plugins: {
            analytics: false,
            monitoring: true,
            checkout: {
              enabled: true,
              nested: { channels: ["web", "app"] },
            },
          },
        };
      `,
    });

    const resolved = await resolvePageConfigModules(
      cwd,
      createPageMetadata("checkout", "./src/pages/checkout/page.config.ts"),
    );

    expect(resolved.pages.checkout.plugins).toEqual({
      analytics: false,
      monitoring: true,
      checkout: {
        enabled: true,
        nested: { channels: ["web", "app"] },
      },
    });
    expect(Object.isFrozen(resolved.pages.checkout.plugins)).toBe(true);
    expect(Object.isFrozen(resolved.pages.checkout.plugins.checkout)).toBe(
      true,
    );
    expect(
      Object.isFrozen(
        (resolved.pages.checkout.plugins.checkout as { nested: object }).nested,
      ),
    ).toBe(true);
  });

  it("supports ESM default imports in Page config dependencies", async () => {
    const cwd = await createFixture({
      "src/config/page-title.ts": `
        import path from "node:path";

        export const title = path.basename("/reports/quarterly");
      `,
      "src/pages/report/page.tsx":
        "export default function Report() { return null; }",
      "src/pages/report/page.config.ts": `
        import { title } from "../../config/page-title.js";

        export default { title };
      `,
    });

    await expect(
      resolvePageConfigModules(
        cwd,
        createPageMetadata("report", "./src/pages/report/page.config.ts"),
      ),
    ).resolves.toMatchObject({
      pages: {
        report: {
          metadata: { title: "quarterly" },
        },
      },
    });
  });

  it("resolves static Document aliases from page.config.ts", async () => {
    const cwd = await createFixture({
      "src/pages/report/page.tsx":
        "export default function Report() { return null; }",
      "src/pages/report/page.config.ts": `
        export default {
          render: "ssg",
          document: {
            aliases: ["report.html", "legacy/report.htm"],
          },
        };
      `,
    });

    const resolved = await resolvePageConfigModules(
      cwd,
      createPageMetadata("report", "./src/pages/report/page.config.ts"),
    );

    expect(resolved.pages.report.document).toEqual({
      aliases: ["report.html", "legacy/report.htm"],
    });
  });

  it("normalizes empty Document and Page plugin configuration", async () => {
    const cwd = await createFixture({
      "src/pages/report/page.tsx":
        "export default function Report() { return null; }",
      "src/pages/report/page.config.ts": `
        export default {
          document: {
            aliases: [],
          },
          plugins: {},
        };
      `,
    });

    const resolved = await resolvePageConfigModules(
      cwd,
      createPageMetadata("report", "./src/pages/report/page.config.ts"),
    );

    expect(resolved.pages.report).toEqual({
      source: "./src/pages/report/page.config.ts",
      plugins: {},
    });
  });

  it.each([
    {
      label: "an absolute alias",
      aliases: '["/report.html"]',
      message: /document\.aliases\[0\] must be a relative output path/,
    },
    {
      label: "a parent traversal alias",
      aliases: '["../report.html"]',
      message: /must not contain empty, "\.", or "\.\." segments/,
    },
    {
      label: "a duplicate alias",
      aliases: '["report.html", "report.html"]',
      message: /document\.aliases\[1\] duplicates alias "report\.html"/,
    },
    {
      label: "a non-HTML alias",
      aliases: '["main.js"]',
      message: /must end with "\.html" or "\.htm"/,
    },
  ])("rejects $label", async ({ aliases, message }) => {
    const cwd = await createFixture({
      "src/pages/report/page.tsx":
        "export default function Report() { return null; }",
      "src/pages/report/page.config.ts": `
        export default {
          render: "ssg",
          document: { aliases: ${aliases} },
        };
      `,
    });

    await expect(
      resolvePageConfigModules(
        cwd,
        createPageMetadata("report", "./src/pages/report/page.config.ts"),
      ),
    ).rejects.toThrow(message);
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
          plugins: { feature: { channel } },
        };
      `,
    });
    const metadata = createPageMetadata(
      "report",
      "./src/pages/report/page.config.ts",
    );
    const observedDependencies = new Set<string>();

    await expect(
      resolvePageConfigModules(cwd, metadata, {
        onSourceDependency(file) {
          observedDependencies.add(path.resolve(file));
        },
      }),
    ).rejects.toThrow("Failed to load static config module");
    await expectRealDependencies(
      [...observedDependencies],
      [
        path.resolve(cwd, "src/config/channel.ts"),
        path.resolve(cwd, "src/pages/report/page.config.ts"),
      ],
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
            plugins: { feature: { channel } },
          };
        `,
        "utf-8",
      ),
    ]);

    const resolved = await resolvePageConfigModules(cwd, metadata);

    expect(resolved.pages.report.plugins.feature).toEqual({
      channel: "fresh",
    });
  });

  it("observes unresolved helper candidates before config evaluation", async () => {
    const cwd = await createFixture({
      "src/config/.keep": "",
      "src/pages/report/page.tsx":
        "export default function Report() { return null; }",
      "src/pages/report/page.config.ts": `
        import { channel } from "../../config/channel.js";
        export default {
          plugins: { feature: { channel } },
        };
      `,
    });
    const metadata = createPageMetadata(
      "report",
      "./src/pages/report/page.config.ts",
    );
    const helper = path.resolve(cwd, "src/config/channel.ts");
    const observedDependencies = new Set<string>();

    await expect(
      resolvePageConfigModules(cwd, metadata, {
        onSourceDependency(file) {
          observedDependencies.add(path.resolve(file));
        },
      }),
    ).rejects.toThrow("Failed to load static config module");
    expect(observedDependencies).toContain(helper);

    await fs.writeFile(helper, 'export const channel = "recovered";', "utf-8");
    const resolved = await resolvePageConfigModules(cwd, metadata);

    expect(resolved.pages.report.plugins.feature).toEqual({
      channel: "recovered",
    });
  });

  it("keeps higher-priority missing helper candidates observable", async () => {
    const cwd = await createFixture({
      "src/config/title.ts": 'export const title = "TypeScript";',
      "src/pages/report/page.tsx":
        "export default function Report() { return null; }",
      "src/pages/report/page.config.ts": `
        import { title } from "../../config/title.js";
        export default { title };
      `,
    });
    const metadata = createPageMetadata(
      "report",
      "./src/pages/report/page.config.ts",
    );
    const javascriptCandidate = path.resolve(cwd, "src/config/title.js");
    const typescriptHelper = path.resolve(cwd, "src/config/title.ts");
    const observedDependencies = new Set<string>();

    const first = await resolvePageConfigModules(cwd, metadata, {
      onSourceDependency(file) {
        observedDependencies.add(path.resolve(file));
      },
    });

    expect(first.pages.report.metadata?.title).toBe("TypeScript");
    expect([...observedDependencies]).toEqual(
      expect.arrayContaining([javascriptCandidate, typescriptHelper]),
    );
    const firstRealDependencies = await Promise.all(
      first.dependencies.map((file) => fs.realpath(file)),
    );
    expect(firstRealDependencies).toContain(
      await fs.realpath(typescriptHelper),
    );
    expect(first.dependencies).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/[/\\]title\.js$/)]),
    );

    await fs.writeFile(
      javascriptCandidate,
      'export const title = "JavaScript";',
      "utf-8",
    );

    const second = await resolvePageConfigModules(cwd, metadata);

    expect(second.pages.report.metadata?.title).toBe("JavaScript");
    const secondRealDependencies = await Promise.all(
      second.dependencies.map((file) => fs.realpath(file)),
    );
    expect(secondRealDependencies).toContain(
      await fs.realpath(javascriptCandidate),
    );
    expect(secondRealDependencies).not.toContain(
      await fs.realpath(typescriptHelper),
    );
  });

  it("observes project package imports before config evaluation", async () => {
    const cwd = await createFixture({
      "package.json": JSON.stringify({
        name: "page-config-imports",
        imports: {
          "#settings": "./src/config/settings.ts",
        },
      }),
      "src/config/settings.ts": `
        throw new Error("broken package import");
        export const channel = "recovered";
      `,
      "src/pages/report/page.tsx":
        "export default function Report() { return null; }",
      "src/pages/report/page.config.ts": `
        import { channel } from "#settings";
        export default {
          plugins: { feature: { channel } },
        };
      `,
    });
    const metadata = createPageMetadata(
      "report",
      "./src/pages/report/page.config.ts",
    );
    const helper = path.resolve(cwd, "src/config/settings.ts");
    const observedDependencies = new Set<string>();

    await expect(
      resolvePageConfigModules(cwd, metadata, {
        onSourceDependency(file) {
          observedDependencies.add(path.resolve(file));
        },
      }),
    ).rejects.toThrow("Failed to load static config module");
    await expectRealDependencies([...observedDependencies], [helper]);

    await fs.writeFile(helper, 'export const channel = "recovered";', "utf-8");
    const resolved = await resolvePageConfigModules(cwd, metadata);

    expect(resolved.pages.report.plugins.feature).toEqual({
      channel: "recovered",
    });
  });

  it("reloads project package import mappings from the current manifest", async () => {
    const cwd = await createFixture({
      "package.json": JSON.stringify({
        name: "page-config-import-reload",
        imports: {
          "#settings": {
            node: {
              require: "./src/config/first.ts",
              import: "./src/config/import-only.ts",
            },
          },
        },
      }),
      "src/config/first.ts": 'export const channel = "first";',
      "src/config/import-only.ts": 'export const channel = "import-only";',
      "src/config/second.ts": 'export const channel = "second";',
      "src/pages/report/page.tsx":
        "export default function Report() { return null; }",
      "src/pages/report/page.config.ts": `
        import { channel } from "#settings";
        export default { plugins: { feature: { channel } } };
      `,
    });
    const metadata = createPageMetadata(
      "report",
      "./src/pages/report/page.config.ts",
    );

    await expect(
      resolvePageConfigModules(cwd, metadata),
    ).resolves.toMatchObject({
      pages: {
        report: { plugins: { feature: { channel: "first" } } },
      },
    });
    await fs.writeFile(
      path.join(cwd, "package.json"),
      JSON.stringify({
        name: "page-config-import-reload",
        imports: {
          "#settings": {
            node: {
              require: "./src/config/second.ts",
              import: "./src/config/import-only.ts",
            },
          },
        },
      }),
      "utf-8",
    );

    await expect(
      resolvePageConfigModules(cwd, metadata),
    ).resolves.toMatchObject({
      pages: {
        report: { plugins: { feature: { channel: "second" } } },
      },
    });

    await fs.writeFile(
      path.join(cwd, "package.json"),
      JSON.stringify({
        name: "page-config-import-reload",
        imports: {
          "#settings": {
            node: {
              require: "./src/config/missing.ts",
              import: "./src/config/import-only.ts",
            },
          },
        },
      }),
      "utf-8",
    );

    await expect(
      resolvePageConfigModules(cwd, metadata),
    ).resolves.toMatchObject({
      pages: {
        report: { plugins: { feature: { channel: "import-only" } } },
      },
    });
  });

  it.each([
    ["blocked", null],
    ["invalid", "../escaped-settings.ts"],
  ])("does not bypass an explicitly %s require package target", async (_label, requireTarget) => {
    const cwd = await createFixture({
      "package.json": JSON.stringify({
        imports: {
          "#settings": {
            node: {
              require: requireTarget,
              import: "./src/config/import-only.ts",
            },
          },
        },
      }),
      "src/config/import-only.ts": 'export const channel = "must-not-load";',
      "src/pages/report/page.tsx":
        "export default function Report() { return null; }",
      "src/pages/report/page.config.ts": `
          import { channel } from "#settings";
          export default { plugins: { feature: { channel } } };
        `,
    });

    await expect(
      resolvePageConfigModules(
        cwd,
        createPageMetadata("report", "./src/pages/report/page.config.ts"),
      ),
    ).rejects.toThrow("Failed to load static config module");
  });

  it("observes missing project package import targets and manifests", async () => {
    const cwd = await createFixture({
      "package.json": JSON.stringify({
        name: "missing-page-config-import",
        imports: {
          "#settings": "./src/config/settings.ts",
        },
      }),
      "src/config/.keep": "",
      "src/pages/report/page.tsx":
        "export default function Report() { return null; }",
      "src/pages/report/page.config.ts": `
        import { channel } from "#settings";
        export default {
          plugins: { feature: { channel } },
        };
      `,
    });
    const metadata = createPageMetadata(
      "report",
      "./src/pages/report/page.config.ts",
    );
    const helper = path.resolve(cwd, "src/config/settings.ts");
    const realHelper = path.join(
      await fs.realpath(path.dirname(helper)),
      path.basename(helper),
    );
    const manifest = path.resolve(cwd, "package.json");
    const observedDependencies = new Set<string>();

    await expect(
      resolvePageConfigModules(cwd, metadata, {
        onSourceDependency(file) {
          observedDependencies.add(path.resolve(file));
        },
      }),
    ).rejects.toThrow("Failed to load static config module");
    expect(observedDependencies).toContain(realHelper);
    await expectRealDependencies([...observedDependencies], [manifest]);

    await fs.writeFile(helper, 'export const channel = "recovered";', "utf-8");
    const resolved = await resolvePageConfigModules(cwd, metadata);

    expect(resolved.pages.report.plugins.feature).toEqual({
      channel: "recovered",
    });
  });

  it("recovers after adding a project package import mapping", async () => {
    const cwd = await createFixture({
      "package.json": JSON.stringify({ name: "added-page-config-import" }),
      "src/config/.keep": "",
      "src/pages/report/page.tsx":
        "export default function Report() { return null; }",
      "src/pages/report/page.config.ts": `
        import { channel } from "#settings";
        export default { plugins: { feature: { channel } } };
      `,
    });
    const metadata = createPageMetadata(
      "report",
      "./src/pages/report/page.config.ts",
    );
    const manifest = path.resolve(cwd, "package.json");
    const observedDependencies = new Set<string>();

    await expect(
      resolvePageConfigModules(cwd, metadata, {
        onSourceDependency(file) {
          observedDependencies.add(path.resolve(file));
        },
      }),
    ).rejects.toThrow("Failed to load static config module");
    await expectRealDependencies([...observedDependencies], [manifest]);

    await Promise.all([
      fs.writeFile(
        path.join(cwd, "src/config/settings.ts"),
        'export const channel = "added";',
        "utf-8",
      ),
      fs.writeFile(
        manifest,
        JSON.stringify({
          name: "added-page-config-import",
          imports: { "#settings": "./src/config/settings.ts" },
        }),
        "utf-8",
      ),
    ]);

    const resolved = await resolvePageConfigModules(cwd, metadata);
    expect(resolved.pages.report.plugins.feature).toEqual({ channel: "added" });
  });

  it("does not observe Page config dependencies through escaped symlinks", async () => {
    const externalDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "evjs-page-config-external-"),
    );
    tempDirs.push(externalDirectory);
    const externalHelper = path.join(externalDirectory, "settings.ts");
    await fs.writeFile(
      externalHelper,
      [
        'throw new Error("broken external settings");',
        'export const channel = "external";',
      ].join("\n"),
      "utf-8",
    );
    const cwd = await createFixture({
      "src/config/.keep": "",
      "src/pages/report/page.tsx":
        "export default function Report() { return null; }",
      "src/pages/report/page.config.ts": `
        import { channel } from "../../config/settings";
        export default {
          plugins: { feature: { channel } },
        };
      `,
    });
    const linkedHelper = path.resolve(cwd, "src/config/settings.ts");
    await fs.symlink(externalHelper, linkedHelper);
    const observedDependencies = new Set<string>();

    await expect(
      resolvePageConfigModules(
        cwd,
        createPageMetadata("report", "./src/pages/report/page.config.ts"),
        {
          onSourceDependency(file) {
            observedDependencies.add(path.resolve(file));
          },
        },
      ),
    ).rejects.toThrow("Failed to load static config module");

    expect(observedDependencies).not.toContain(linkedHelper);
    expect(observedDependencies).not.toContain(externalHelper);
  });

  it("rejects external file URLs in Page config modules", async () => {
    const externalDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "evjs-page-config-file-url-"),
    );
    tempDirs.push(externalDirectory);
    const externalHelper = path.join(externalDirectory, "settings.ts");
    await fs.writeFile(
      externalHelper,
      'export const channel = "external";',
      "utf-8",
    );
    const cwd = await createFixture({
      "src/pages/report/page.tsx":
        "export default function Report() { return null; }",
      "src/pages/report/page.config.ts": `
        import { channel } from ${JSON.stringify(pathToFileURL(externalHelper).href)};
        export default { plugins: { feature: { channel } } };
      `,
    });

    await expect(
      resolvePageConfigModules(
        cwd,
        createPageMetadata("report", "./src/pages/report/page.config.ts"),
      ),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining("resolves outside project root"),
      },
    });
  });

  it("rejects package manifests that resolve through escaped symlinks", async () => {
    const externalDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "evjs-page-config-manifest-external-"),
    );
    tempDirs.push(externalDirectory);
    const externalManifest = path.join(externalDirectory, "package.json");
    await fs.writeFile(
      externalManifest,
      JSON.stringify({ name: "external-package-scope" }),
      "utf-8",
    );
    const cwd = await createFixture({
      "src/pages/report/page.tsx":
        "export default function Report() { return null; }",
      "src/pages/report/page.config.ts": `
        export default { title: "Report" };
      `,
    });
    await fs.symlink(externalManifest, path.join(cwd, "package.json"));
    const observedDependencies = new Set<string>();

    await expect(
      resolvePageConfigModules(
        cwd,
        createPageMetadata("report", "./src/pages/report/page.config.ts"),
        {
          onSourceDependency(file) {
            observedDependencies.add(path.resolve(file));
          },
        },
      ),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining("resolves outside project root"),
      },
    });

    const observedRealPaths = await Promise.all(
      [...observedDependencies].map((file) =>
        fs.realpath(file).catch(() => path.resolve(file)),
      ),
    );
    expect(observedRealPaths).not.toContain(
      await fs.realpath(externalManifest),
    );
  });

  it("invalidates helpers when a page config root is renamed", async () => {
    const cwd = await createFixture({
      "src/config/channel.ts": 'export const channel = "stale";',
      "src/pages/report/page.tsx":
        "export default function Report() { return null; }",
      "src/pages/report/page.config.ts": `
        import { channel } from "../../config/channel";
        export default {
          plugins: { feature: { channel } },
        };
      `,
    });
    const typescriptMetadata = createPageMetadata(
      "report",
      "./src/pages/report/page.config.ts",
    );

    const first = await resolvePageConfigModules(cwd, typescriptMetadata);
    expect(first.pages.report.plugins.feature).toEqual({
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

    expect(second.pages.report.plugins.feature).toEqual({
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
      label: "an undefined default export",
      source: "export default undefined;",
      message: /default export must be a plain object/,
    },
    {
      label: "an unknown top-level field",
      source: 'export default { head: "Home" };',
      message: /has unknown field "head"/,
    },
    {
      label: "the removed Page extension bag",
      source: "export default { extensions: {} };",
      message: /has unknown field "extensions"/,
    },
    {
      label: "the removed Route owner config",
      source: "export default { route: {} };",
      message: /has unknown field "route"/,
    },
    {
      label: "the removed Document extension bag",
      source: "export default { document: { extensions: {} } };",
      message: /document has unknown field "extensions"/,
    },
    {
      label: "a legacy namespaced plugin id",
      source: 'export default { plugins: { "@company/feature": true } };',
      message: /must be a lower camel case or lowercase kebab-case plugin id/,
    },
    {
      label: "an invalid Page plugin setting",
      source: "export default { plugins: { feature: null } };",
      message: /must be false, true, or a plain object/,
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
      label: "a function in a plugin config",
      source:
        "export default { plugins: { feature: { callback: () => true } } };",
      message: /must be JSON-serializable/,
    },
    {
      label: "a non-finite number in a plugin config",
      source: "export default { plugins: { feature: { value: Infinity } } };",
      message: /must contain finite numbers/,
    },
    {
      label: "a class instance in a plugin config",
      source:
        "export default { plugins: { feature: { value: new Date(0) } } };",
      message: /must contain only arrays and plain objects/,
    },
    {
      label: "a cyclic plugin config",
      source: `
        const value = {};
        value.self = value;
        export default { plugins: { feature: value } };
      `,
      message: /must not contain cycles/,
    },
    {
      label: "a sparse array in a plugin config",
      source: `
        const value = [];
        value.length = 1;
        export default { plugins: { feature: { value } } };
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
      rendering: "default CSR with load hydration",
      source: 'export default { hydrate: "load" };',
    },
    {
      rendering: "default CSR with disabled hydration",
      source: 'export default { hydrate: "none" };',
    },
    {
      rendering: "explicit CSR with load hydration",
      source: 'export default { render: "csr", hydrate: "load" };',
    },
    {
      rendering: "explicit CSR with disabled hydration",
      source: 'export default { render: "csr", hydrate: "none" };',
    },
  ])("rejects $rendering", async ({ source }) => {
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
    ).rejects.toThrow(
      'Page "home" config "./src/pages/home/page.config.ts" resolves to render: "csr" and must omit hydrate. Hydration is only configurable for render: "ssr" or "ssg".',
    );
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

  it("rejects Page rendering configuration exported by a component", async () => {
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
          'Page "home" exports rendering configuration "render", "hydrate", "prerender", "rsc" from its component module. Define these fields in the adjacent page.config.ts module; Page component exports are runtime values, not build configuration.',
      },
    ]);
    expect(analysis.graph.pages.home).toMatchObject({
      id: "home",
      render: "csr",
    });
    expect(analysis.graph.pages.home).not.toHaveProperty("hydrate");
    expect(analysis.graph.pages.home).not.toHaveProperty("prerender");
    expect(analysis.graph.pages.home).not.toHaveProperty("componentModel");
    expect(analysis.graph.pages.home.plugins).toEqual({});
  });
});

function createPageMetadata(
  pageId: string,
  configModule?: string,
): PageRouteDiscoveryMetadata {
  return createPagesMetadata([{ pageId, configModule }]);
}

function createPagesMetadata(
  entries: Array<{ pageId: string; configModule?: string }>,
): PageRouteDiscoveryMetadata {
  return {
    pages: entries.map(({ pageId, configModule }): PageAnchorMetadata => {
      const directory =
        pageId === "index" ? "./src/pages" : `./src/pages/${pageId}`;
      return {
        pageId,
        directory,
        entry: `${directory}/page.tsx`,
        exportName: "default",
        ...(configModule ? { configModule } : {}),
      };
    }),
  };
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
    (
      await Promise.all(
        received.map((file) => fs.realpath(file).catch(() => undefined)),
      )
    ).filter((file): file is string => file !== undefined),
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
