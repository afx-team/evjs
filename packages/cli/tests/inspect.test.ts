import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BundlerAdapter } from "@evjs/ev/_internal/build";
import { inspectFrameworkBuild } from "@evjs/ev/_internal/build";
import type { Plugin } from "@evjs/ev/plugin";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatInspectJson,
  formatInspectText,
  hasInspectErrors,
} from "../src/inspect.js";
import { runInspectCommand } from "../src/inspect-command.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("inspect", () => {
  it("reports framework discovery without running a bundler or writing output", async () => {
    const cwd = await createFixture({
      "index.html": '<div id="app"></div>',
      "src/pages/page.tsx": `
        import { getUsers } from "../api/users.server";
        export default function Home() {
          void getUsers;
          return null;
        }
      `,
      "src/pages/page.config.ts": `export default {
        render: "ssr",
        title: "Home",
        meta: { description: "Inspect metadata" },
      };`,
      "src/pages/_card.tsx": "export function Card() { return null; }",
      "src/api/users.server.ts": `
        "use server";
        export async function getUsers() {
          return [];
        }
      `,
      "src/apis/api/health/api.ts": `
        export const GET = () => Response.json({ ok: true });
      `,
    });

    const result = await inspectFrameworkBuild(
      {
        routing: { mode: "spa" },
      },
      { cwd },
    );

    expect(hasInspectErrors(result)).toBe(false);
    expect(result.routing).toMatchObject({
      routingMode: "spa",
      pageRoot: "./src/pages",
    });
    expect(result.pageRoutes).toEqual([
      { id: "index", path: "/", module: "./src/pages/page.tsx" },
    ]);
    expect(result.routeFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "./src/pages/page.tsx",
          status: "route",
          routePath: "/",
        }),
        expect.objectContaining({
          file: "./src/pages/_card.tsx",
          status: "ignored",
        }),
      ]),
    );
    expect(result.graph.pages.index).toMatchObject({
      id: "index",
      render: "ssr",
      metadata: {
        title: "Home",
        meta: { description: "Inspect metadata" },
      },
      source: {
        module: "./src/pages/page.tsx",
        config: "./src/pages/page.config.ts",
        scope: { kind: "directory", root: "./src/pages" },
      },
    });
    expect(result.graph.serverFunctions).toEqual([
      expect.objectContaining({
        module: "src/api/users.server.ts",
        exportName: "getUsers",
      }),
    ]);
    expect(result.graph.serverRoutes).toEqual([
      expect.objectContaining({
        module: "src/apis/api/health/api.ts",
        path: "/api/health",
        methods: ["GET"],
      }),
    ]);
    expect(result.runtime.server).toMatchObject({
      basePath: "/__evjs",
      fn: "__evjs/fn",
      ppr: "__evjs/ppr",
    });
    const text = formatInspectText(result);
    expect(text).toContain("config=./src/pages/page.config.ts");
    expect(text).toContain(
      'metadata={"title":"Home","meta":{"description":"Inspect metadata"}}',
    );
    await expectPathMissing(path.join(cwd, "dist"));
    await expectPathMissing(path.join(cwd, ".ev"));
    await expectPathMissing(path.join(cwd, "src/route-types.d.ts"));
  });

  it("reports explicit application route input without a file convention", async () => {
    const cwd = await createFixture({
      "index.html": '<div id="app"></div>',
      "src/pages/home/page.tsx":
        "export default function Home() { return null; }",
      "src/pages/users/detail/page.tsx":
        "export default function UserDetail() { return null; }",
      "src/middleware.ts":
        "export default async function middleware(_ctx, next) { await next(); }",
      "src/apis/middleware.ts":
        "export default async function middleware(_ctx, next) { await next(); }",
      "src/apis/health/api.ts":
        "export const GET = async () => Response.json({ ok: true });",
    });

    const result = await inspectFrameworkBuild(
      {
        conventions: false,
        application: {
          pageRoot: "./src/pages",
          routes: [
            { path: "/", page: "home" },
            { path: "/users/:userId", page: "users/detail" },
          ],
        },
        output: { client: "dist" },
      },
      { cwd },
    );

    expect(hasInspectErrors(result)).toBe(false);
    expect(result.routing).toMatchObject({
      routingMode: "spa",
      pageRoot: "./src/pages",
    });
    expect(result.pageRoutes).toEqual([
      {
        id: "@evjs/provider/config-route:route:0",
        path: "/",
        module: "./src/pages/home/page.tsx",
      },
      {
        id: "@evjs/provider/config-route:route:1",
        path: "/users/$userId",
        module: "./src/pages/users/detail/page.tsx",
      },
    ]);
    expect(result.routeFiles).toEqual([]);
    expect(result.graph).toMatchObject({
      applications: {
        default: {
          routingMode: "spa",
          pageIds: ["home", "users_detail"],
          documentIds: ["index"],
        },
      },
      pages: {
        home: {
          applicationId: "default",
          source: {
            module: "./src/pages/home/page.tsx",
            scope: { kind: "directory", root: "./src/pages/home" },
          },
        },
        users_detail: {
          applicationId: "default",
          source: {
            module: "./src/pages/users/detail/page.tsx",
            scope: {
              kind: "directory",
              root: "./src/pages/users/detail",
            },
          },
        },
      },
    });
    expect(result.graph.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pattern: { segments: [] },
          target: { kind: "page", pageId: "home" },
        }),
        expect.objectContaining({
          pattern: {
            segments: [
              { kind: "static", value: "users" },
              { kind: "param", name: "userId" },
            ],
          },
          target: { kind: "page", pageId: "users_detail" },
        }),
      ]),
    );
    expect(result.graph.serverRoutes).toEqual([]);

    const text = formatInspectText(result);
    expect(text).not.toContain("source:");
    expect(text).toContain("client:route:0: / -> page:home");
    expect(text).toContain(
      "client:route:1: /users/:userId -> page:users_detail",
    );
    expect(text).not.toContain("provider");
    expect(text).not.toContain("convention");
  });

  it("reports page-anchor routes, facets, and private modules", async () => {
    const cwd = await createFixture({
      "index.html": '<div id="app"></div>',
      "src/pages/page.tsx": "export default function Home() { return null; }",
      "src/pages/layout.tsx":
        "export default function RootLayout() { return null; }",
      "src/pages/error.tsx":
        "export default function RootError() { return null; }",
      "src/pages/not-found.tsx":
        "export default function RootNotFound() { return null; }",
      "src/pages/about.tsx":
        "export default function LegacyAbout() { return null; }",
      "src/pages/users/page.tsx":
        "export default function Users() { return null; }",
      "src/pages/users/layout.tsx":
        "export default function UsersLayout() { return null; }",
      "src/pages/users/model.ts": "export const model = {};",
      "src/pages/orphan/layout.tsx":
        "export default function OrphanLayout() { return null; }",
    });

    const result = await inspectFrameworkBuild(
      {
        routing: { mode: "spa" },
        output: { client: "dist" },
      },
      { cwd },
    );

    expect(hasInspectErrors(result)).toBe(false);
    expect(result.routing).toMatchObject({
      routingMode: "spa",
    });
    expect(result.graph).toMatchObject({
      applications: {
        default: {
          routingMode: "spa",
          layout: "./src/pages/layout.tsx",
          pageIds: ["index", "users"],
          documentIds: ["index"],
        },
      },
      pages: {
        users: {
          applicationId: "default",
          source: {
            module: "./src/pages/users/page.tsx",
            scope: { kind: "directory", root: "./src/pages/users" },
            provider: "@evjs/provider/page-anchor",
          },
        },
      },
      documents: {
        index: {
          owner: { kind: "application" },
          output: "index.html",
        },
      },
    });
    expect(result.graph.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "users",
          target: { kind: "page", pageId: "users" },
          facets: expect.objectContaining({
            layout: "./src/pages/users/layout.tsx",
          }),
        }),
      ]),
    );
    const text = formatInspectText(result);
    expect(text).toContain("Applications");
    expect(text).toContain("Routes");
    expect(text).not.toMatch(/CoreGraph v\d+/);
    expect(text).toContain(
      "client:users: /users -> page:users, layout=./src/pages/users/layout.tsx",
    );
    expect(text).not.toContain("provider=@evjs/provider/page-anchor");
    expect(result.routeFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "./src/pages/users/model.ts",
          status: "ignored",
        }),
        expect.objectContaining({
          file: "./src/pages/about.tsx",
          status: "ignored",
        }),
        expect.objectContaining({
          file: "./src/pages/layout.tsx",
          status: "facet",
          facetKind: "root-layout",
        }),
        expect.objectContaining({
          file: "./src/pages/error.tsx",
          status: "facet",
          facetKind: "error",
        }),
        expect.objectContaining({
          file: "./src/pages/not-found.tsx",
          status: "facet",
          facetKind: "not-found",
        }),
        expect.objectContaining({
          file: "./src/pages/users/layout.tsx",
          status: "facet",
          facetKind: "layout",
          routePath: "/users",
        }),
        expect.objectContaining({
          file: "./src/pages/orphan/layout.tsx",
          status: "ignored",
        }),
      ]),
    );
  });

  it("reports normalized Bigfish SPA route-tree migration input", async () => {
    const cwd = await createFixture({
      "index.html": '<div id="app"></div>',
      "src/pages/account/index.tsx":
        "export default function Account() { return null; }",
      "src/pages/account/model.ts": "export const model = {};",
      "src/pages/account/components/index.tsx":
        "export default function Card() { return null; }",
      "src/pages/home/index.tsx":
        "export default function Home() { return null; }",
    });

    const result = await inspectFrameworkBuild(
      {
        application: {
          routes: [
            { path: "/account", component: "account/index" },
            { path: "/home", component: "home/index" },
          ],
        },
        output: { client: "dist" },
      },
      { cwd },
    );

    expect(hasInspectErrors(result)).toBe(false);
    expect(result.routing).toMatchObject({
      routingMode: "spa",
      pageRoot: "./src/pages",
    });
    expect(result.pageRoutes).toEqual([
      {
        id: "@evjs/provider/config-route:route:0",
        path: "/account",
        module: "./src/pages/account/index.tsx",
      },
      {
        id: "@evjs/provider/config-route:route:1",
        path: "/home",
        module: "./src/pages/home/index.tsx",
      },
    ]);
    expect(result.graph).toMatchObject({
      applications: {
        default: {
          routingMode: "spa",
          pageIds: ["account", "home"],
          documentIds: ["index"],
        },
      },
      pages: {
        home: {
          source: {
            provider: "@evjs/provider/config-route",
            scope: { kind: "directory", root: "./src/pages/home" },
          },
          extensions: {},
        },
      },
      documents: {
        index: {
          output: "index.html",
          owner: { kind: "application" },
        },
      },
    });
    expect(result.buildPlan?.entries.map((entry) => entry.name)).toEqual([
      "main",
    ]);
    expect(result.buildPlan?.html.map((document) => document.fileName)).toEqual(
      ["index.html"],
    );
    expect(result.routeFiles).toEqual([]);
    const text = formatInspectText(result);
    expect(text).toContain("client:route:0: /account -> page:account");
    expect(text).not.toContain("provider=@evjs/provider/config-route");
    expect(text).toContain("Extensions");
    expect(text).not.toMatch(/CoreGraph v\d+/);
    expect(text).not.toContain("@evjs/compat/");
    expect(text).not.toContain("@evjs/provider/");
  });

  it("reports contribution IR without materializing .ev files", async () => {
    const cwd = await createFixture({
      "index.html": '<div id="app"></div>',
      "src/main.tsx": "console.log('app');",
    });
    const plugin: Plugin<Record<string, never>> = {
      name: "inspect-contribution",
      contributions(ctx) {
        const module = ctx.emit.module({
          id: "entry",
          scope: { kind: "application" },
          source: "window.__fromInspect = true;",
        });
        ctx.slot("client.entry").add({
          id: "entry-slot",
          module,
          position: "after-main",
        });
      },
    };

    const result = await inspectFrameworkBuild(
      {
        output: { client: "dist" },
        plugins: [plugin],
      },
      { cwd },
    );

    expect(result.buildPlan?.generated?.modules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "entry",
          pluginName: "inspect-contribution",
        }),
      ]),
    );
    expect(result.buildPlan?.generated?.slots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slot: "client.entry",
          id: "entry-slot",
        }),
      ]),
    );
    await expectPathMissing(path.join(cwd, ".ev"));
  });

  it("reports static Document aliases in JSON and text output", async () => {
    const cwd = await createFixture({
      "index.html": '<div id="app"></div>',
      "src/pages/about/page.tsx":
        "export default function About() { return null; }",
      "src/pages/about/page.config.ts": `
        export default {
          document: { aliases: ["about.html", "legacy/about.htm"] },
        };
      `,
    });
    const result = await inspectFrameworkBuild(
      {
        routing: { mode: "mpa" },
      },
      { cwd },
    );

    expect(result.graph.documents.about?.aliases).toEqual([
      "about.html",
      "legacy/about.htm",
    ]);
    expect(result.buildPlan?.html).toEqual([
      expect.objectContaining({
        id: "about",
        fileName: "about/index.html",
        aliases: ["about.html", "legacy/about.htm"],
      }),
    ]);
    expect(formatInspectText(result)).toContain(
      "about: about/index.html (aliases: about.html, legacy/about.htm)",
    );
    const json = JSON.parse(formatInspectJson(result));
    expect(json.buildPlan.html[0].aliases).toEqual([
      "about.html",
      "legacy/about.htm",
    ]);
  });

  it("formats text and JSON output", async () => {
    const cwd = await createFixture({
      "index.html": '<div id="app"></div>',
      "src/pages/page.tsx": "export default function Home() { return null; }",
    });
    const result = await inspectFrameworkBuild(
      {
        routing: { mode: "spa" },
        output: { client: "dist" },
      },
      { cwd },
    );

    const text = formatInspectText(result);
    expect(text).toContain("ev inspect");
    expect(text).toContain("Routing");
    expect(text).not.toContain("source:");
    expect(text).not.toContain("compatibilitySource");
    expect(text).toContain("/ -> index");

    const json = JSON.parse(formatInspectJson(result));
    expect(json.routing.routingMode).toBe("spa");
    expect(json.pageRoutes[0].path).toBe("/");
  });

  it("formats bundler capabilities and plan gaps", async () => {
    const cwd = await createFixture({
      "index.html": '<div id="app"></div>',
      "src/pages/page.tsx": "export default function Home() { return null; }",
      "src/pages/page.config.ts": 'export default { render: "ssr" };',
    });
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "limited",
      capabilities: {
        build: { server: false, rsc: false, ppr: false },
        dev: {
          html: true,
          entries: false,
          routes: false,
          server: false,
          resolution: false,
        },
      },
      async build() {
        return {};
      },
      async dev() {
        return undefined;
      },
    };

    const result = await inspectFrameworkBuild(
      {
        routing: { mode: "spa" },
        output: { client: "dist" },
      },
      { cwd, bundler },
    );

    const text = formatInspectText(result);
    expect(text).toContain("bundler: limited");
    expect(text).toContain("bundler.build: server=no, rsc=no, ppr=no");
    expect(text).toContain(
      "bundler.dev: html=yes, entries=no, routes=no, server=no, resolution=no",
    );
    expect(text).toContain("bundler.gap: build.server");
    expect(result.bundler?.gaps).toEqual([
      expect.objectContaining({ capability: "build.server" }),
    ]);
  });

  it("returns route diagnostics for rejected files without throwing", async () => {
    const cwd = await createFixture({
      "index.html": '<div id="app"></div>',
      "src/pages/page.tsx": "export default function Home() { return null; }",
      "src/pages/users/[id]/page.tsx":
        "export default function User() { return null; }",
    });

    const result = await inspectFrameworkBuild(
      {
        routing: { mode: "spa" },
        output: { client: "dist" },
      },
      { cwd },
    );

    expect(hasInspectErrors(result)).toBe(true);
    expect(result.routeFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "./src/pages/users/[id]/page.tsx",
          status: "rejected",
        }),
      ]),
    );
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          source: "page-routes",
          file: "src/pages/users/[id]/page.tsx",
          message: expect.stringContaining(
            'Bracket segment "[id]" is not supported',
          ),
        }),
      ]),
    );
    await expectPathMissing(path.join(cwd, "dist"));
    await expectPathMissing(path.join(cwd, "src/route-types.d.ts"));
  });

  it("returns a failing CLI exit code for error diagnostics", async () => {
    const cwd = await createFixture({
      "ev.config.ts": `
        import { defineConfig } from "@evjs/ev";
        export default defineConfig({
          routing: { mode: "spa" },
          output: { client: "dist" },
        });
      `,
      "index.html": '<div id="app"></div>',
      "src/pages/page.tsx": "export default function Home() { return null; }",
      "src/pages/users/[id]/page.tsx":
        "export default function User() { return null; }",
    });

    const result = await runInspectCommand({ cwd, json: true });
    const output = JSON.parse(result.output);

    expect(result.exitCode).toBe(1);
    expect(output.routeFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "./src/pages/users/[id]/page.tsx",
          status: "rejected",
        }),
      ]),
    );
    expect(output.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          source: "page-routes",
        }),
      ]),
    );
    await expectPathMissing(path.join(cwd, "dist"));
    await expectPathMissing(path.join(cwd, "src/route-types.d.ts"));
  });
});

async function createFixture(files: Record<string, string>): Promise<string> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "evjs-inspect-"));
  tempDirs.push(cwd);
  for (const [file, source] of Object.entries(files)) {
    const absolute = path.join(cwd, file);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, source, "utf-8");
  }
  return cwd;
}

async function expectPathMissing(file: string): Promise<void> {
  await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
}
