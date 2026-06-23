import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { linkBuildOutput } from "@evjs/shared/manifest";
import { afterEach, describe, expect, it } from "vitest";
import type { BuildPlanConfig, GraphConfig } from "../src/build-tools/index.js";
import {
  createAppGraph,
  createBuildPlan,
  diffBuildPlan,
} from "../src/build-tools/index.js";
import { hashServerFunction } from "../src/build-tools/utils.js";

const tempDirs: string[] = [];

function relativeFileDependencies(cwd: string, files: string[]): string[] {
  return files.map((file) => path.relative(cwd, file));
}

function getSinglePprRegionId(
  regions: Record<string, unknown> | undefined,
): string {
  const ids = Object.keys(regions ?? {});
  expect(ids).toHaveLength(1);
  const [id] = ids;
  expect(id).toMatch(/^region_[0-9a-f]{12}$/);
  return id as string;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("createAppGraph and createBuildPlan", () => {
  it("creates one app client entry for a top-level entry config", async () => {
    const cwd = await createFixture({
      "src/main.tsx": "console.log('app');",
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig();
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });

    expect(analysis.graph.apps).toEqual({
      default: {
        id: "default",
        entry: "./src/main.tsx",
        html: "./index.html",
      },
    });
    expect(analysis.graph.pages).toEqual({});
    expect(plan.entries).toContainEqual({
      name: "main",
      import: "./src/main.tsx",
      environment: "client",
      runtime: "browser",
      kind: "app-client",
      owner: { appId: "default" },
    });
    expect(plan.html).toEqual([
      {
        id: "index",
        template: "./index.html",
        fileName: "index.html",
        owner: { appId: "default" },
      },
    ]);
  });

  it("creates a framework-managed SPA entry from page routes", async () => {
    const cwd = await createFixture({
      "src/layout/index.tsx": "export default function Root() { return null; }",
      "src/pages/index.tsx": "export default function Home() { return null; }",
      "src/pages/users/$userId.tsx": `
        export function validateSearch(search: Record<string, unknown>) {
          return { tab: String(search.tab ?? "all") };
        }
        export default function User() { return null; }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      entry: "./src/pages/index.tsx",
      routing: {
        mode: "spa",
        dir: "./src/pages",
        entry: "./src/pages/index.tsx",
        html: "./index.html",
        mount: "#app",
        rootModule: "./src/layout/index.tsx",
        routes: [
          {
            id: "index",
            path: "/",
            module: "./src/pages/index.tsx",
          },
          {
            id: "users_userId",
            path: "/users/$userId",
            module: "./src/pages/users/$userId.tsx",
          },
        ],
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });

    expect(analysis.graph.apps.default).toEqual({
      id: "default",
      entry: "./src/pages/index.tsx",
      html: "./index.html",
      mount: "#app",
    });
    expect(analysis.graph.routes).toEqual([
      {
        id: "index",
        path: "/",
        appId: "default",
        module: "./src/pages/index.tsx",
      },
      {
        id: "users_userId",
        path: "/users/$userId",
        appId: "default",
        module: "./src/pages/users/$userId.tsx",
      },
    ]);
    expect(plan.entries).toContainEqual({
      name: "main",
      import: "evjs:pages-app",
      environment: "client",
      runtime: "browser",
      kind: "app-client",
      owner: { appId: "default" },
      metadata: {
        type: "pages-app",
        mount: "#app",
        rootModule: "./src/layout/index.tsx",
        routes: [
          {
            id: "index",
            path: "/",
            module: "./src/pages/index.tsx",
          },
          {
            id: "users_userId",
            path: "/users/$userId",
            module: "./src/pages/users/$userId.tsx",
          },
        ],
      },
    });
    expect(relativeFileDependencies(cwd, analysis.fileDependencies)).toEqual([
      "src/layout/index.tsx",
      "src/pages",
      "src/pages/index.tsx",
      "src/pages/users",
      "src/pages/users/$userId.tsx",
    ]);
  });

  it("normalizes SPA page route order from direct config input", async () => {
    const cwd = await createFixture({
      "src/pages/index.tsx": "export default function Home() { return null; }",
      "src/pages/users/index.tsx":
        "export default function Users() { return null; }",
      "src/pages/users/settings.tsx":
        "export default function Settings() { return null; }",
      "src/pages/users/$id.tsx":
        "export default function User() { return null; }",
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      entry: "./src/pages/index.tsx",
      routing: {
        mode: "spa",
        dir: "./src/pages",
        entry: "./src/pages/index.tsx",
        html: "./index.html",
        mount: "#app",
        routes: [
          {
            id: "users_id",
            path: "/users/$id",
            module: "./src/pages/users/$id.tsx",
          },
          {
            id: "users_settings",
            path: "/users/settings",
            module: "./src/pages/users/settings.tsx",
          },
          {
            id: "index",
            path: "/",
            module: "./src/pages/index.tsx",
          },
          {
            id: "users",
            path: "/users",
            module: "./src/pages/users/index.tsx",
          },
        ],
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });

    expect(analysis.graph.routes.map((route) => route.path)).toEqual([
      "/",
      "/users",
      "/users/settings",
      "/users/$id",
    ]);
    expect(
      plan.entries.find((entry) => entry.kind === "app-client")?.metadata,
    ).toMatchObject({
      type: "pages-app",
      routes: [
        {
          id: "index",
          path: "/",
          module: "./src/pages/index.tsx",
        },
        {
          id: "users",
          path: "/users",
          module: "./src/pages/users/index.tsx",
        },
        {
          id: "users_settings",
          path: "/users/settings",
          module: "./src/pages/users/settings.tsx",
        },
        {
          id: "users_id",
          path: "/users/$id",
          module: "./src/pages/users/$id.tsx",
        },
      ],
    });
  });

  it("orders configured colon and wildcard page routes by specificity", async () => {
    const cwd = await createFixture({
      "src/pages/index.tsx": "export default function Home() { return null; }",
      "src/pages/users/index.tsx":
        "export default function Users() { return null; }",
      "src/pages/users/settings.tsx":
        "export default function Settings() { return null; }",
      "src/pages/users/detail.tsx":
        "export default function UserDetail() { return null; }",
      "src/pages/users/catchall.tsx":
        "export default function UserCatchAll() { return null; }",
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      entry: "./src/pages/index.tsx",
      routing: {
        mode: "spa",
        dir: "./src/pages",
        entry: "./src/pages/index.tsx",
        html: "./index.html",
        mount: "#app",
        routes: [
          {
            id: "users_catchall",
            path: "/users/*",
            module: "./src/pages/users/catchall.tsx",
          },
          {
            id: "users_userId",
            path: "/users/:userId",
            module: "./src/pages/users/detail.tsx",
          },
          {
            id: "users_settings",
            path: "/users/settings",
            module: "./src/pages/users/settings.tsx",
          },
          {
            id: "index",
            path: "/",
            module: "./src/pages/index.tsx",
          },
          {
            id: "users",
            path: "/users",
            module: "./src/pages/users/index.tsx",
          },
        ],
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });
    const metadata = plan.entries.find(
      (entry) => entry.kind === "app-client",
    )?.metadata;

    expect(analysis.graph.routes.map((route) => route.path)).toEqual([
      "/",
      "/users",
      "/users/settings",
      "/users/:userId",
      "/users/*",
    ]);
    expect(metadata).toMatchObject({
      type: "pages-app",
      routes: [
        { id: "index", path: "/" },
        { id: "users", path: "/users" },
        { id: "users_settings", path: "/users/settings" },
        { id: "users_userId", path: "/users/:userId" },
        { id: "users_catchall", path: "/users/*" },
      ],
    });
  });

  it("watches existing nested route directories even before they contain routes", async () => {
    const cwd = await createFixture({
      "src/pages/index.tsx": "export default function Home() { return null; }",
      "src/pages/admin/.keep": "",
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      entry: "./src/pages/index.tsx",
      routing: {
        mode: "spa",
        dir: "./src/pages",
        entry: "./src/pages/index.tsx",
        html: "./index.html",
        mount: "#app",
        routes: [
          {
            id: "index",
            path: "/",
            module: "./src/pages/index.tsx",
          },
        ],
      },
    });
    const analysis = await createAppGraph(config, cwd);

    expect(relativeFileDependencies(cwd, analysis.fileDependencies)).toEqual([
      "src/pages",
      "src/pages/admin",
      "src/pages/index.tsx",
    ]);
  });

  it("creates router-free MPA page entries from page routes", async () => {
    const cwd = await createFixture({
      "src/pages/index.tsx": "export default function Home() { return null; }",
      "src/pages/about.tsx": "export default function About() { return null; }",
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      routing: {
        mode: "mpa",
        dir: "./src/pages",
        html: "./index.html",
        mount: "#app",
        routes: [
          {
            id: "index",
            path: "/",
            module: "./src/pages/index.tsx",
          },
          {
            id: "about",
            path: "/about",
            module: "./src/pages/about.tsx",
          },
        ],
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });

    expect(analysis.graph.apps).toEqual({});
    expect(analysis.graph.pages).toMatchObject({
      index: {
        id: "index",
        path: "/",
        component: "./src/pages/index.tsx",
        html: "./index.html",
        render: "csr",
        mount: "#app",
      },
      about: {
        id: "about",
        path: "/about",
        component: "./src/pages/about.tsx",
        html: "./index.html",
        render: "csr",
        mount: "#app",
      },
    });
    expect(plan.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "index",
          import: "./src/pages/index.tsx",
          kind: "page-client",
          owner: { pageId: "index" },
          metadata: expect.objectContaining({
            type: "react-component-page",
            component: "./src/pages/index.tsx",
            route: { id: "index", path: "/" },
          }),
        }),
        expect.objectContaining({
          name: "about",
          import: "./src/pages/about.tsx",
          kind: "page-client",
          owner: { pageId: "about" },
          metadata: expect.objectContaining({
            type: "react-component-page",
            component: "./src/pages/about.tsx",
            route: { id: "about", path: "/about" },
          }),
        }),
      ]),
    );
    expect(plan.entries.some((entry) => entry.kind === "app-client")).toBe(
      false,
    );
    expect(plan.html).toEqual([
      {
        id: "index",
        template: "./index.html",
        fileName: "index.html",
        owner: { pageId: "index" },
      },
      {
        id: "about",
        template: "./index.html",
        fileName: "about.html",
        owner: { pageId: "about" },
      },
    ]);
  });

  it("normalizes MPA page route order from direct config input", async () => {
    const cwd = await createFixture({
      "src/pages/index.tsx": "export default function Home() { return null; }",
      "src/pages/users/index.tsx":
        "export default function Users() { return null; }",
      "src/pages/users/settings.tsx":
        "export default function Settings() { return null; }",
      "src/pages/users/$id.tsx":
        "export default function User() { return null; }",
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      routing: {
        mode: "mpa",
        dir: "./src/pages",
        html: "./index.html",
        mount: "#app",
        routes: [
          {
            id: "users_id",
            path: "/users/$id",
            module: "./src/pages/users/$id.tsx",
          },
          {
            id: "users_settings",
            path: "/users/settings",
            module: "./src/pages/users/settings.tsx",
          },
          {
            id: "index",
            path: "/",
            module: "./src/pages/index.tsx",
          },
          {
            id: "users",
            path: "/users",
            module: "./src/pages/users/index.tsx",
          },
        ],
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });

    expect(Object.keys(analysis.graph.pages)).toEqual([
      "index",
      "users",
      "users_settings",
      "users_id",
    ]);
    expect(
      plan.entries
        .filter((entry) => entry.kind === "page-client")
        .map((entry) => entry.name),
    ).toEqual(["index", "users", "users_settings", "users_id"]);
    expect(plan.html.map((document) => document.fileName)).toEqual([
      "index.html",
      "users.html",
      "users_settings.html",
      "users_id.html",
    ]);
  });

  it("reports malformed configured page route paths before page generation", async () => {
    const cwd = await createFixture({
      "src/pages/dashboard.tsx":
        "export default function Dashboard() { return null; }",
      "src/pages/empty.tsx": "export default function Empty() { return null; }",
      "src/pages/bad-path.tsx":
        "export default function BadPath() { return null; }",
      "src/pages/search.tsx":
        "export default function Search() { return null; }",
      "src/pages/section.tsx":
        "export default function Section() { return null; }",
      "src/pages/session.tsx":
        "export default function Session() { return null; }",
      "src/pages/empty-param.tsx":
        "export default function EmptyParam() { return null; }",
      "src/pages/wildcard-reserved-param.tsx":
        "export default function WildcardReservedParam() { return null; }",
      "src/pages/duplicate-wildcard.tsx":
        "export default function DuplicateWildcard() { return null; }",
      "src/pages/duplicate-param.tsx":
        "export default function DuplicateParam() { return null; }",
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      routing: {
        mode: "mpa",
        dir: "./src/pages",
        html: "./index.html",
        mount: "#app",
        routes: [
          {
            id: "dashboard",
            path: "dashboard",
            module: "./src/pages/dashboard.tsx",
          },
          {
            id: "empty",
            path: "",
            module: "./src/pages/empty.tsx",
          },
          {
            id: "bad_path",
            path: "/bad path",
            module: "./src/pages/bad-path.tsx",
          },
          {
            id: "search",
            path: "search?tab=latest",
            module: "./src/pages/search.tsx",
          },
          {
            id: "section",
            path: "/section#main",
            module: "./src/pages/section.tsx",
          },
          {
            id: "session",
            path: "/session/:__proto__",
            module: "./src/pages/session.tsx",
          },
          {
            id: "wildcard_reserved_param",
            path: "/docs/:_splat",
            module: "./src/pages/wildcard-reserved-param.tsx",
          },
          {
            id: "duplicate_wildcard",
            path: "/docs/*/edit/*",
            module: "./src/pages/duplicate-wildcard.tsx",
          },
          {
            id: "empty_param",
            path: "/empty/:",
            module: "./src/pages/empty-param.tsx",
          },
          {
            id: "duplicate_param",
            path: "/teams/:teamId/users/:teamId",
            module: "./src/pages/duplicate-param.tsx",
          },
        ],
      },
    });

    const analysis = await createAppGraph(config, cwd);

    expect(Object.keys(analysis.graph.pages)).toEqual(["dashboard"]);
    expect(analysis.graph.routes).toEqual([
      {
        id: "dashboard",
        path: "/dashboard",
        pageId: "dashboard",
        module: "./src/pages/dashboard.tsx",
        render: "csr",
      },
    ]);
    expect(analysis.diagnostics).toEqual([
      {
        level: "error",
        file: "src/pages/empty.tsx",
        message: 'Configured page route path "" must be a non-empty string.',
      },
      {
        level: "error",
        file: "src/pages/bad-path.tsx",
        message:
          'Configured page route path "/bad path" must not contain whitespace.',
      },
      {
        level: "error",
        file: "src/pages/search.tsx",
        message:
          'Configured page route path "search?tab=latest" must not include a query string or hash.',
      },
      {
        level: "error",
        file: "src/pages/section.tsx",
        message:
          'Configured page route path "/section#main" must not include a query string or hash.',
      },
      {
        level: "error",
        file: "src/pages/session.tsx",
        message:
          'Configured page route path "/session/:__proto__" uses reserved dynamic param name "__proto__" in segment ":__proto__". Use a safe application-specific name.',
      },
      {
        level: "error",
        file: "src/pages/wildcard-reserved-param.tsx",
        message:
          'Configured page route path "/docs/:_splat" uses reserved dynamic param name "_splat" in segment ":_splat". Use a safe application-specific name.',
      },
      {
        level: "error",
        file: "src/pages/duplicate-wildcard.tsx",
        message:
          'Configured page route path "/docs/*/edit/*" contains more than one wildcard segment "*". Use at most one wildcard segment in a route path.',
      },
      {
        level: "error",
        file: "src/pages/empty-param.tsx",
        message:
          'Configured page route path "/empty/:" contains dynamic segment ":" without a param name.',
      },
      {
        level: "error",
        file: "src/pages/duplicate-param.tsx",
        message:
          'Configured page route path "/teams/:teamId/users/:teamId" uses duplicate dynamic param name "teamId" in segment ":teamId". Use unique param names within one route path.',
      },
    ]);
  });

  it("reports duplicate configured page route identities", async () => {
    const cwd = await createFixture({
      "src/pages/users/id.tsx":
        "export default function User() { return null; }",
      "src/pages/users/user.tsx":
        "export default function UserAlias() { return null; }",
      "src/pages/settings.tsx":
        "export default function Settings() { return null; }",
      "src/pages/settings-copy.tsx":
        "export default function SettingsCopy() { return null; }",
      "src/pages/account-settings.tsx":
        "export default function AccountSettings() { return null; }",
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      routing: {
        mode: "mpa",
        dir: "./src/pages",
        html: "./index.html",
        mount: "#app",
        routes: [
          {
            id: "users_id",
            path: "/users/:id",
            module: "./src/pages/users/id.tsx",
          },
          {
            id: "users_userId",
            path: "/users/:userId",
            module: "./src/pages/users/user.tsx",
          },
          {
            id: "settings",
            path: "/settings",
            module: "./src/pages/settings.tsx",
          },
          {
            id: "settings_copy",
            path: "/settings",
            module: "./src/pages/settings-copy.tsx",
          },
          {
            id: "settings",
            path: "/account-settings",
            module: "./src/pages/account-settings.tsx",
          },
        ],
      },
    });

    const analysis = await createAppGraph(config, cwd);

    expect(Object.keys(analysis.graph.pages)).toEqual(["settings", "users_id"]);
    expect(analysis.graph.routes).toEqual([
      {
        id: "settings",
        path: "/settings",
        pageId: "settings",
        module: "./src/pages/settings.tsx",
        render: "csr",
      },
      {
        id: "users_id",
        path: "/users/:id",
        pageId: "users_id",
        module: "./src/pages/users/id.tsx",
        render: "csr",
      },
    ]);
    expect(analysis.diagnostics).toEqual([
      {
        level: "error",
        file: "src/pages/users/user.tsx",
        message:
          'Configured page route path "/users/:userId" has the same route shape as ./src/pages/users/id.tsx (/users/:id). Use one dynamic param name for each URL shape.',
      },
      {
        level: "error",
        file: "src/pages/settings-copy.tsx",
        message:
          'Configured page route path "/settings" is already declared by ./src/pages/settings.tsx. Keep one page route per URL path.',
      },
      {
        level: "error",
        file: "src/pages/account-settings.tsx",
        message:
          'Configured page route id "settings" for path "/account-settings" is already used by ./src/pages/settings.tsx (/settings). Route ids must be unique because they drive page ids and build entries.',
      },
    ]);
  });

  it("uses validated configured SPA routes for pages app metadata", async () => {
    const cwd = await createFixture({
      "src/pages/index.tsx": "export default function Home() { return null; }",
      "src/pages/users/id.tsx":
        "export default function User() { return null; }",
      "src/pages/users/user.tsx":
        "export default function UserAlias() { return null; }",
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      entry: "./src/pages/index.tsx",
      routing: {
        mode: "spa",
        dir: "./src/pages",
        entry: "./src/pages/index.tsx",
        html: "./index.html",
        mount: "#app",
        routes: [
          {
            id: "index",
            path: "/",
            module: "./src/pages/index.tsx",
          },
          {
            id: "users_id",
            path: "/users/:id",
            module: "./src/pages/users/id.tsx",
          },
          {
            id: "users_userId",
            path: "/users/:userId",
            module: "./src/pages/users/user.tsx",
          },
        ],
      },
    });

    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });

    expect(analysis.diagnostics).toEqual([
      {
        level: "error",
        file: "src/pages/users/user.tsx",
        message:
          'Configured page route path "/users/:userId" has the same route shape as ./src/pages/users/id.tsx (/users/:id). Use one dynamic param name for each URL shape.',
      },
    ]);
    expect(
      plan.entries.find((entry) => entry.kind === "app-client")?.metadata,
    ).toMatchObject({
      type: "pages-app",
      routes: [
        {
          id: "index",
          path: "/",
          module: "./src/pages/index.tsx",
        },
        {
          id: "users_id",
          path: "/users/:id",
          module: "./src/pages/users/id.tsx",
        },
      ],
    });
  });

  it("emits MPA SSG file routes as independent static documents", async () => {
    const cwd = await createFixture({
      "src/pages/index.tsx": "export default function Home() { return null; }",
      "src/pages/pricing.tsx": `
        export const render = "ssg";
        export default function Pricing() { return null; }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      routing: {
        mode: "mpa",
        dir: "./src/pages",
        html: "./index.html",
        mount: "#app",
        routes: [
          {
            id: "index",
            path: "/",
            module: "./src/pages/index.tsx",
          },
          {
            id: "pricing",
            path: "/pricing",
            module: "./src/pages/pricing.tsx",
          },
        ],
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "production",
    });

    expect(analysis.graph.pages.pricing).toMatchObject({
      id: "pricing",
      path: "/pricing",
      routeId: "pricing",
      component: "./src/pages/pricing.tsx",
      render: "ssg",
    });
    expect(plan.entries).toContainEqual({
      name: "pricing-server",
      import: "./src/pages/pricing.tsx",
      environment: "server",
      runtime: "node",
      kind: "page-server",
      owner: { pageId: "pricing", routeId: "pricing" },
    });
    expect(
      plan.entries.filter(
        (entry) =>
          entry.kind === "page-client" && entry.owner?.pageId === "pricing",
      ),
    ).toEqual([]);
    expect(plan.html).toEqual([
      {
        id: "index",
        template: "./index.html",
        fileName: "index.html",
        owner: { pageId: "index" },
      },
      {
        id: "pricing",
        template: "./index.html",
        fileName: "pricing.html",
        owner: { pageId: "pricing" },
      },
    ]);
  });

  it("emits MPA SSR file routes as route-owned server documents", async () => {
    const cwd = await createFixture({
      "src/pages/index.tsx": "export default function Home() { return null; }",
      "src/pages/dashboard.tsx": `
        export const render = "ssr";
        export default function Dashboard() { return null; }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      routing: {
        mode: "mpa",
        dir: "./src/pages",
        html: "./index.html",
        mount: "#app",
        routes: [
          {
            id: "index",
            path: "/",
            module: "./src/pages/index.tsx",
          },
          {
            id: "dashboard",
            path: "/dashboard",
            module: "./src/pages/dashboard.tsx",
          },
        ],
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "production",
    });

    expect(analysis.graph.apps).toEqual({});
    expect(analysis.graph.pages.dashboard).toMatchObject({
      id: "dashboard",
      path: "/dashboard",
      routeId: "dashboard",
      component: "./src/pages/dashboard.tsx",
      render: "ssr",
    });
    expect(plan.entries).toContainEqual({
      name: "dashboard",
      import: "./src/pages/dashboard.tsx",
      environment: "client",
      runtime: "browser",
      kind: "page-client",
      owner: { pageId: "dashboard" },
      metadata: {
        type: "react-component-page",
        component: "./src/pages/dashboard.tsx",
        mount: "#app",
        hydrate: "load",
        render: "ssr",
        route: { id: "dashboard", path: "/dashboard" },
      },
    });
    expect(plan.entries).toContainEqual({
      name: "dashboard-server",
      import: "./src/pages/dashboard.tsx",
      environment: "server",
      runtime: "node",
      kind: "page-server",
      owner: { pageId: "dashboard", routeId: "dashboard" },
    });
    expect(plan.html).toEqual([
      {
        id: "index",
        template: "./index.html",
        fileName: "index.html",
        owner: { pageId: "index" },
      },
    ]);
  });

  it("creates one page client entry per configured page", async () => {
    const cwd = await createFixture({
      "src/pages/home/main.tsx": "console.log('home');",
      "src/pages/about/main.tsx": "console.log('about');",
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      pages: {
        home: {
          entry: "./src/pages/home/main.tsx",
          html: "./index.html",
        },
        about: {
          entry: "./src/pages/about/main.tsx",
          html: "./index.html",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });

    expect(analysis.graph.apps).toEqual({});
    expect(Object.keys(analysis.graph.pages)).toEqual(["home", "about"]);
    expect(
      plan.entries.filter((entry) => entry.kind === "page-client"),
    ).toEqual([
      {
        name: "home",
        import: "./src/pages/home/main.tsx",
        environment: "client",
        runtime: "browser",
        kind: "page-client",
        owner: { pageId: "home" },
      },
      {
        name: "about",
        import: "./src/pages/about/main.tsx",
        environment: "client",
        runtime: "browser",
        kind: "page-client",
        owner: { pageId: "about" },
      },
    ]);
    expect(plan.html).toEqual([
      {
        id: "home",
        template: "./index.html",
        fileName: "home.html",
        owner: { pageId: "home" },
      },
      {
        id: "about",
        template: "./index.html",
        fileName: "about.html",
        owner: { pageId: "about" },
      },
    ]);
  });

  it("rejects duplicate build entry names before bundling", async () => {
    const cwd = await createFixture({
      "src/main.tsx": "console.log('app');",
      "src/pages/main.tsx": "console.log('page');",
      "index.html": '<div id="app"></div>',
      "page.html": '<div id="page"></div>',
    });
    const config = createConfig({
      apps: {
        default: {
          entry: "./src/main.tsx",
          html: "./index.html",
        },
      },
      pages: {
        main: {
          entry: "./src/pages/main.tsx",
          html: "./page.html",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);

    expect(() =>
      createBuildPlan(config, analysis.graph, {
        mode: "development",
      }),
    ).toThrow(
      '[evjs] Duplicate build entry name "main" from app "default" and page "main". Build entry names are manifest asset keys and must be globally unique.',
    );
  });

  it("rejects build entry names that collide across client and server outputs", async () => {
    const cwd = await createFixture({
      "src/main.tsx": "console.log('app');",
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      apps: {
        server: {
          entry: "./src/main.tsx",
          html: "./index.html",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);

    expect(() =>
      createBuildPlan(config, analysis.graph, {
        mode: "production",
      }),
    ).toThrow(
      '[evjs] Duplicate build entry name "server" from app "server" and server-runtime entry. Build entry names are manifest asset keys and must be globally unique.',
    );
  });

  it("reports missing custom top-level app entries during graph analysis", async () => {
    const cwd = await createFixture({
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      entry: "./src/missing-main.tsx",
      serverEnabled: false,
    });

    const analysis = await createAppGraph(config, cwd);

    expect(analysis.graph.apps.default).toEqual({
      id: "default",
      entry: "./src/missing-main.tsx",
      html: "./index.html",
    });
    expect(analysis.diagnostics).toContainEqual({
      level: "error",
      file: "src/missing-main.tsx",
      message: 'App "default" entry source file not found.',
    });
  });

  it("rejects duplicate HTML output filenames before bundling", async () => {
    const cwd = await createFixture({
      "src/main.tsx": "console.log('app');",
      "src/pages/index.tsx": "console.log('page');",
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      apps: {
        default: {
          entry: "./src/main.tsx",
          html: "./index.html",
        },
      },
      pages: {
        index: {
          entry: "./src/pages/index.tsx",
          html: "./index.html",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);

    expect(() =>
      createBuildPlan(config, analysis.graph, {
        mode: "development",
      }),
    ).toThrow(
      '[evjs] Duplicate HTML output file "index.html" from app "default" and page "index". HTML output filenames must be unique.',
    );
  });

  it("adds the server runtime entry when server is enabled", async () => {
    const cwd = await createFixture({
      "src/main.tsx": "console.log('app');",
    });
    const config = createConfig({
      server: {
        entry: "./src/server.ts",
        basePath: "/__evjs",
        functionRuntime: {
          endpoint: "/__evjs/fn",
          clientProxy: "client-proxy",
          serverRegister: "server-register",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "production",
    });

    expect(plan.server).toEqual({
      enabled: true,
      entry: "./src/server.ts",
      functionRuntime: {
        endpoint: "/__evjs/fn",
        clientProxy: "client-proxy",
        serverRegister: "server-register",
      },
    });
    expect(plan.entries).toContainEqual({
      name: "server",
      import: "./src/server.ts",
      environment: "server",
      runtime: "node",
      kind: "server-runtime",
    });
  });

  it("carries the RSC endpoint into the runtime plan", async () => {
    const cwd = await createFixture({
      "src/main.tsx": "console.log('app');",
    });
    const config = createConfig({
      server: {
        entry: undefined,
        basePath: "/__evjs",
        runtime: {
          rsc: "/__evjs/rsc",
        },
        functionRuntime: {
          endpoint: "/__evjs/fn",
          clientProxy: "@evjs/client/internal",
          serverRegister: "@evjs/server/register",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph);

    expect(plan.runtime.server).toEqual({
      basePath: "/__evjs",
      fn: "/__evjs/fn",
      rsc: "/__evjs/rsc",
    });
  });

  it("uses the real component file with runtime entry metadata", async () => {
    const cwd = await createFixture({
      "src/pages/home.tsx": "export default function Home() { return null; }",
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      serverEnabled: false,
      pages: {
        home: {
          component: "./src/pages/home.tsx",
          html: "./index.html",
          mount: "#root",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });
    const entry = plan.entries.find((entry) => entry.name === "home");
    if (!entry) throw new Error("Expected home entry");

    expect(entry.import).toBe("./src/pages/home.tsx");
    expect(plan.entries).toContainEqual({
      name: "home",
      import: "./src/pages/home.tsx",
      environment: "client",
      runtime: "browser",
      kind: "page-client",
      owner: { pageId: "home" },
      metadata: {
        type: "react-component-page",
        component: "./src/pages/home.tsx",
        mount: "#root",
        hydrate: "load",
        render: "csr",
      },
    });
    await expect(fs.access(path.join(cwd, ".evjs"))).rejects.toThrow();
  });

  it("reads render metadata from configured component page modules", async () => {
    const cwd = await createFixture({
      "src/pages/dashboard.tsx": `
        const documentRender = "ssr";
        const hydration = "load";
        export { documentRender as render, hydration as hydrate };
        const ignoredRender = "csr";
        const ignoredHydration = "soon";
        export type { ignoredRender as render };
        export { type ignoredHydration as hydrate };
        export declare const render: "csr";
        declare const ambientHydration: "idle";
        export { ambientHydration as hydrate };
        export default function Dashboard() { return null; }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      pages: {
        dashboard: {
          path: "/dashboard",
          component: "./src/pages/dashboard.tsx",
          html: "./index.html",
        },
      },
    });

    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });

    expect(analysis.graph.pages.dashboard).toMatchObject({
      render: "ssr",
      hydrate: "load",
    });
    expect(plan.server.renderers).toContainEqual({
      name: "dashboard-server",
      import: "./src/pages/dashboard.tsx",
      kind: "page-server",
      owner: { pageId: "dashboard", routeId: "dashboard" },
    });
  });

  it("reports duplicate page metadata exports before applying module fallback", async () => {
    const cwd = await createFixture({
      "src/pages/dashboard.tsx": `
        const documentRender = "ssr";
        const staticRender = "ssg";
        const loadHydrate = "load";
        export { documentRender as render };
        export { staticRender as render };
        export { loadHydrate as hydrate };
        export const hydrate = "none";
        export default function Dashboard() { return null; }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      pages: {
        dashboard: {
          path: "/dashboard",
          component: "./src/pages/dashboard.tsx",
          html: "./index.html",
        },
      },
    });

    const analysis = await createAppGraph(config, cwd);

    expect(analysis.graph.pages.dashboard).toMatchObject({
      render: "csr",
    });
    expect(analysis.graph.pages.dashboard.hydrate).toBeUndefined();
    expect(analysis.diagnostics).toEqual([
      {
        level: "error",
        file: "src/pages/dashboard.tsx",
        message:
          'Page metadata export "render" is declared more than once. Keep one static export for each metadata field.',
      },
      {
        level: "error",
        file: "src/pages/dashboard.tsx",
        message:
          'Page metadata export "hydrate" is declared more than once. Keep one static export for each metadata field.',
      },
    ]);
  });

  it("reports malformed configured page modules during graph analysis", async () => {
    const cwd = await createFixture({
      "src/pages/dashboard.tsx": `
        export const render = "ssr";
        export default function Dashboard( {
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      pages: {
        dashboard: {
          path: "/dashboard",
          component: "./src/pages/dashboard.tsx",
          html: "./index.html",
        },
      },
    });

    const analysis = await createAppGraph(config, cwd);

    expect(analysis.graph.pages.dashboard).toMatchObject({
      render: "csr",
    });
    expect(analysis.diagnostics).toContainEqual({
      level: "error",
      file: "src/pages/dashboard.tsx",
      message: expect.stringContaining(
        "Page module metadata could not be parsed:",
      ),
    });
  });

  it("uses explicit page config rendering metadata before module fallback", async () => {
    const cwd = await createFixture({
      "src/pages/dashboard.tsx": `
        export const render = "ssg";
        export const hydrate = "none";
        export default function Dashboard() { return null; }
      `,
      "src/pages/pricing.tsx": `
        export default function Pricing() { return null; }
      `,
      "src/pages/campaign.tsx": `
        import * as React from "react";
        const OfferRegion = React.lazy(() => import("./offer-region"));
        export default function Campaign() {
          return (
            <React.Suspense fallback={null}>
              <OfferRegion />
            </React.Suspense>
          );
        }
      `,
      "src/pages/offer-region.tsx": `
        export default function OfferRegion() { return null; }
      `,
      "src/pages/insights.tsx": `
        export default function Insights() { return null; }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      pages: {
        dashboard: {
          path: "/dashboard",
          component: "./src/pages/dashboard.tsx",
          html: "./index.html",
          render: "ssr",
          hydrate: "visible",
        },
        pricing: {
          component: "./src/pages/pricing.tsx",
          html: "./index.html",
          render: "ssg",
        },
        campaign: {
          component: "./src/pages/campaign.tsx",
          html: "./index.html",
          render: "ssr",
          hydrate: "none",
          prerender: { partial: true, delivery: "stream" },
          ppr: { delivery: "stream" },
        },
        insights: {
          component: "./src/pages/insights.tsx",
          html: "./index.html",
          render: "ssr",
          hydrate: "none",
          componentModel: "rsc",
        },
      },
    });

    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "production",
    });

    expect(analysis.graph.pages.dashboard).toMatchObject({
      path: "/dashboard",
      component: "./src/pages/dashboard.tsx",
      render: "ssr",
      hydrate: "visible",
    });
    expect(analysis.graph.pages.pricing).toMatchObject({
      component: "./src/pages/pricing.tsx",
      render: "ssg",
    });
    const campaignRegionId = getSinglePprRegionId(
      analysis.graph.pages.campaign.ppr?.regions,
    );
    expect(analysis.graph.pages.campaign.ppr).toMatchObject({
      delivery: "stream",
      regions: {
        [campaignRegionId]: {
          component: "./src/pages/offer-region.tsx",
        },
      },
    });
    expect(analysis.graph.pages.insights).toMatchObject({
      component: "./src/pages/insights.tsx",
      render: "ssr",
      hydrate: "none",
      componentModel: "rsc",
    });
    expect(plan.runtime.server?.ppr).toBe("/__evjs/ppr");
    expect(plan.runtime.server?.rsc).toBe("/__evjs/rsc");
    expect(plan.entries).toEqual(
      expect.arrayContaining([
        {
          name: "dashboard",
          import: "./src/pages/dashboard.tsx",
          environment: "client",
          runtime: "browser",
          kind: "page-client",
          owner: { pageId: "dashboard" },
          metadata: {
            type: "react-component-page",
            component: "./src/pages/dashboard.tsx",
            mount: "#app",
            hydrate: "visible",
            render: "ssr",
            route: { id: "dashboard", path: "/dashboard" },
          },
        },
        {
          name: "pricing-server",
          import: "./src/pages/pricing.tsx",
          environment: "server",
          runtime: "node",
          kind: "page-server",
          owner: { pageId: "pricing" },
        },
        {
          name: "campaign-ppr-shell",
          import: "./src/pages/campaign.tsx",
          environment: "server",
          runtime: "node",
          kind: "ppr-shell",
          owner: { pageId: "campaign" },
        },
        {
          name: `campaign-${campaignRegionId}-ppr-region`,
          import: "./src/pages/offer-region.tsx",
          environment: "server",
          runtime: "node",
          kind: "ppr-region",
          owner: { pageId: "campaign", regionId: campaignRegionId },
        },
        {
          name: "insights-rsc",
          import: "./src/pages/insights.tsx",
          environment: "server",
          runtime: "node",
          kind: "rsc-page",
          owner: { pageId: "insights" },
        },
      ]),
    );
    expect(
      plan.entries.filter(
        (entry) =>
          entry.kind === "page-client" &&
          ["pricing", "campaign", "insights"].includes(
            entry.owner?.pageId ?? "",
          ),
      ),
    ).toEqual([]);
  });

  it("reports unsupported page render metadata", async () => {
    const cwd = await createFixture({
      "src/pages/campaign.tsx": `
        export const render = "ppr";
        export const prerender = { partial: true } as const;
        export default function Campaign() { return null; }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      pages: {
        campaign: {
          path: "/campaign",
          component: "./src/pages/campaign.tsx",
          html: "./index.html",
        },
      },
    });

    const analysis = await createAppGraph(config, cwd);

    expect(analysis.diagnostics).toEqual([
      {
        level: "error",
        file: "src/pages/campaign.tsx",
        message:
          'Page render mode "ppr" is not supported. PPR is declared with render = "ssr" and prerender = { partial: true }.',
      },
    ]);
  });

  it("reports unsupported page rsc metadata", async () => {
    const cwd = await createFixture({
      "src/pages/campaign.tsx": `
        export const render = "ssr";
        export const rsc = "yes";
        export default function Campaign() { return null; }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      pages: {
        campaign: {
          path: "/campaign",
          component: "./src/pages/campaign.tsx",
          html: "./index.html",
        },
      },
    });

    const analysis = await createAppGraph(config, cwd);

    expect(analysis.diagnostics).toEqual([
      {
        level: "error",
        file: "src/pages/campaign.tsx",
        message: "Page rsc must be a boolean literal.",
      },
    ]);
  });

  it("warns when page rsc metadata is explicitly disabled", async () => {
    const cwd = await createFixture({
      "src/pages/campaign.tsx": `
        export const render = "ssr";
        export const rsc = false;
        export default function Campaign() { return null; }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      pages: {
        campaign: {
          path: "/campaign",
          component: "./src/pages/campaign.tsx",
          html: "./index.html",
        },
      },
    });

    const analysis = await createAppGraph(config, cwd);

    expect(analysis.graph.pages.campaign.componentModel).toBeUndefined();
    expect(analysis.diagnostics).toEqual([
      {
        level: "warning",
        file: "src/pages/campaign.tsx",
        message:
          'Page rsc = false has no effect. Remove it, or use rsc = true with render = "ssr" to enable RSC.',
      },
    ]);
  });

  it("reports page metadata exports without static values", async () => {
    const cwd = await createFixture({
      "src/pages/campaign.tsx": `
        export let render;
        let hydration;
        export { hydration as hydrate };
        export let rsc;
        export let prerender;
        export default function Campaign() { return null; }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      pages: {
        campaign: {
          path: "/campaign",
          component: "./src/pages/campaign.tsx",
          html: "./index.html",
        },
      },
    });

    const analysis = await createAppGraph(config, cwd);

    expect(analysis.diagnostics).toEqual([
      {
        level: "error",
        file: "src/pages/campaign.tsx",
        message:
          'Page render must be a string literal: "csr", "ssr", or "ssg".',
      },
      {
        level: "error",
        file: "src/pages/campaign.tsx",
        message: "Page rsc must be a boolean literal.",
      },
      {
        level: "error",
        file: "src/pages/campaign.tsx",
        message:
          'Page hydrate must be one of "none", "load", "visible", or "idle".',
      },
      {
        level: "error",
        file: "src/pages/campaign.tsx",
        message: "Page prerender must be true or an object literal.",
      },
    ]);
  });

  it("reports page metadata exports declared with unsupported runtime forms", async () => {
    const cwd = await createFixture({
      "src/pages/function-render.tsx": `
        export function render() {
          return "ssr";
        }
        export default function FunctionRender() { return null; }
      `,
      "src/pages/reexport-hydrate.tsx": `
        export { mode as hydrate } from "./metadata";
        export default function ReexportHydrate() { return null; }
      `,
      "src/pages/metadata.ts": `
        export const mode = "load";
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      pages: {
        functionRender: {
          path: "/function-render",
          component: "./src/pages/function-render.tsx",
          html: "./index.html",
        },
        reexportHydrate: {
          path: "/reexport-hydrate",
          component: "./src/pages/reexport-hydrate.tsx",
          html: "./index.html",
        },
      },
    });

    const analysis = await createAppGraph(config, cwd);

    expect(analysis.diagnostics).toEqual([
      {
        level: "error",
        file: "src/pages/function-render.tsx",
        message:
          'Page metadata export "render" must be declared as a local variable with a static initializer. Re-exported, function, and class exports are not supported for page metadata.',
      },
      {
        level: "error",
        file: "src/pages/reexport-hydrate.tsx",
        message:
          'Page metadata export "hydrate" must be declared as a local variable with a static initializer. Re-exported, function, and class exports are not supported for page metadata.',
      },
    ]);
  });

  it("reports unsupported page hydration and prerender metadata", async () => {
    const cwd = await createFixture({
      "src/pages/campaign.tsx": `
        export const render = "ssr";
        export const hydrate = "hover";
        export const prerender = {
          partial: "yes",
          delivery: "flush",
          revalidate: "60",
        } as const;
        export default function Campaign() { return null; }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      pages: {
        campaign: {
          path: "/campaign",
          component: "./src/pages/campaign.tsx",
          html: "./index.html",
        },
      },
    });

    const analysis = await createAppGraph(config, cwd);

    expect(analysis.diagnostics).toEqual([
      {
        level: "error",
        file: "src/pages/campaign.tsx",
        message:
          'Page hydrate must be one of "none", "load", "visible", or "idle".',
      },
      {
        level: "error",
        file: "src/pages/campaign.tsx",
        message: "Page prerender.partial must be a boolean literal.",
      },
      {
        level: "error",
        file: "src/pages/campaign.tsx",
        message: 'Page prerender.delivery must be "merge" or "stream".',
      },
      {
        level: "error",
        file: "src/pages/campaign.tsx",
        message:
          "Page prerender.revalidate must be a positive integer number of seconds or false.",
      },
    ]);
  });

  it("reports unsupported page prerender shapes", async () => {
    const cwd = await createFixture({
      "src/pages/disabled.tsx": `
        export const render = "ssr";
        export const prerender = false;
        export default function Disabled() { return null; }
      `,
      "src/pages/empty.tsx": `
        export const render = "ssr";
        export const prerender = {};
        export default function Empty() { return null; }
      `,
      "src/pages/fractional.tsx": `
        export const render = "ssr";
        export const prerender = { revalidate: 1.5 };
        export default function Fractional() { return null; }
      `,
      "src/pages/duplicate.tsx": `
        export const render = "ssr";
        export const prerender = { partial: true, partial: false };
        export default function Duplicate() { return null; }
      `,
      "src/pages/typo.tsx": `
        export const render = "ssr";
        export const prerender = { revaidate: 60 };
        export default function Typo() { return null; }
      `,
      "src/pages/zero.tsx": `
        export const render = "ssr";
        export const prerender = { revalidate: 0 };
        export default function Zero() { return null; }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      pages: {
        disabled: {
          path: "/disabled",
          component: "./src/pages/disabled.tsx",
          html: "./index.html",
        },
        empty: {
          path: "/empty",
          component: "./src/pages/empty.tsx",
          html: "./index.html",
        },
        fractional: {
          path: "/fractional",
          component: "./src/pages/fractional.tsx",
          html: "./index.html",
        },
        duplicate: {
          path: "/duplicate",
          component: "./src/pages/duplicate.tsx",
          html: "./index.html",
        },
        typo: {
          path: "/typo",
          component: "./src/pages/typo.tsx",
          html: "./index.html",
        },
        zero: {
          path: "/zero",
          component: "./src/pages/zero.tsx",
          html: "./index.html",
        },
      },
    });

    const analysis = await createAppGraph(config, cwd);

    expect(analysis.diagnostics).toEqual([
      {
        level: "error",
        file: "src/pages/disabled.tsx",
        message: "Page prerender must be true or an object literal.",
      },
      {
        level: "error",
        file: "src/pages/empty.tsx",
        message:
          "Page prerender object must declare partial, delivery, or revalidate.",
      },
      {
        level: "error",
        file: "src/pages/fractional.tsx",
        message:
          "Page prerender.revalidate must be a positive integer number of seconds or false.",
      },
      {
        level: "error",
        file: "src/pages/duplicate.tsx",
        message:
          'Page prerender property "partial" is declared more than once.',
      },
      {
        level: "error",
        file: "src/pages/typo.tsx",
        message:
          'Page prerender property "revaidate" is not supported. Expected partial, delivery, or revalidate.',
      },
      {
        level: "error",
        file: "src/pages/zero.tsx",
        message:
          "Page prerender.revalidate must be a positive integer number of seconds or false.",
      },
    ]);
  });

  it("does not create a client runtime entry for static non-hydrated component pages", async () => {
    const cwd = await createFixture({
      "src/pages/pricing.tsx": `
        export const render = "ssg";
        export default function Pricing() { return null; }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      pages: {
        pricing: {
          component: "./src/pages/pricing.tsx",
          html: "./index.html",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "production",
    });
    expect(plan.server.entry).toBe("@evjs/server/fetch");
    expect(plan.server.renderers).toEqual([
      {
        name: "pricing-server",
        import: "./src/pages/pricing.tsx",
        kind: "page-server",
        owner: { pageId: "pricing" },
      },
    ]);
    expect(
      plan.entries.filter((entry) => entry.kind === "page-client"),
    ).toEqual([]);
    expect(plan.entries).toContainEqual({
      name: "pricing-server",
      import: "./src/pages/pricing.tsx",
      environment: "server",
      runtime: "node",
      kind: "page-server",
      owner: { pageId: "pricing" },
    });
    await expect(fs.access(path.join(cwd, ".evjs"))).rejects.toThrow();
  });

  it("plans PPR shell and region entries from Suspense page regions", async () => {
    const cwd = await createFixture({
      "src/campaign/Page.tsx": `
        import * as React from "react";
        const OfferRegion = React.lazy(() => import("./Offer.region"));
        export const render = "ssr";
        export const hydrate = "none";
        export const prerender = { partial: true } as const;
        export default function Page() {
          return (
            <React.Suspense fallback={<p>Loading offer</p>}>
              <OfferRegion />
            </React.Suspense>
          );
        }
      `,
      "src/campaign/Offer.region.tsx": `
        const cachePolicy = "no-store";
        const hydration = "visible";
        export { cachePolicy as cache, hydration as hydrate };
        const ignoredCache = { revalidate: "60" } as const;
        const ignoredHydration = "soon";
        export type { ignoredCache as cache };
        export { type ignoredHydration as hydrate };
        export declare const cache: { revalidate: 60 };
        declare const ambientHydration: "idle";
        export { ambientHydration as hydrate };
        export default function Offer() { return null; }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      pages: {
        campaign: {
          component: "./src/campaign/Page.tsx",
          html: "./index.html",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "production",
    });
    const campaignRegionId = getSinglePprRegionId(
      analysis.graph.pages.campaign.ppr?.regions,
    );

    expect(analysis.graph.pages.campaign.ppr).toEqual({
      delivery: "merge",
      regions: {
        [campaignRegionId]: {
          component: "./src/campaign/Offer.region.tsx",
          cache: "no-store",
          hydrate: "visible",
        },
      },
    });
    expect(plan.entries).toContainEqual({
      name: "server",
      import: "@evjs/server/fetch",
      environment: "server",
      runtime: "node",
      kind: "server-runtime",
    });
    expect(plan.runtime.server?.ppr).toBe("/__evjs/ppr");
    expect(plan.entries).not.toContainEqual(
      expect.objectContaining({
        name: "campaign",
        kind: "page-client",
      }),
    );
    expect(plan.entries).toEqual(
      expect.arrayContaining([
        {
          name: "campaign-ppr-shell",
          import: "./src/campaign/Page.tsx",
          environment: "server",
          runtime: "node",
          kind: "ppr-shell",
          owner: { pageId: "campaign" },
        },
        {
          name: `campaign-${campaignRegionId}-ppr-region`,
          import: "./src/campaign/Offer.region.tsx",
          environment: "server",
          runtime: "node",
          kind: "ppr-region",
          owner: { pageId: "campaign", regionId: campaignRegionId },
        },
      ]),
    );
    expect(plan.server.renderers).toEqual([
      {
        name: "campaign-ppr-shell",
        import: "./src/campaign/Page.tsx",
        kind: "ppr-shell",
        owner: { pageId: "campaign" },
      },
      {
        name: `campaign-${campaignRegionId}-ppr-region`,
        import: "./src/campaign/Offer.region.tsx",
        kind: "ppr-region",
        owner: { pageId: "campaign", regionId: campaignRegionId },
      },
    ]);
    expect(relativeFileDependencies(cwd, analysis.fileDependencies)).toEqual([
      "src/campaign/Offer.region.tsx",
      "src/campaign/Page.tsx",
    ]);
  });

  it("plans PPR regions from Suspense lazy boundaries in the page component tree", async () => {
    const cwd = await createFixture({
      "src/campaign/Page.tsx": `
        import CampaignSections from "./CampaignSections";

        export const render = "ssr";
        export const hydrate = "none";
        export const prerender = { partial: true } as const;
        export default function Page() {
          return <CampaignSections />;
        }
      `,
      "src/campaign/CampaignSections.tsx": `
        import * as React from "react";

        const OfferRegion = React.lazy(() => import("./Offer.region"));

        export default function CampaignSections() {
          return (
            <React.Suspense fallback={<p>Loading offer</p>}>
              <OfferRegion />
            </React.Suspense>
          );
        }
      `,
      "src/campaign/Offer.region.tsx": `
        export const cache = { revalidate: 30 as const } as const;
        export const hydrate = "none";
        export default function Offer() { return null; }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      pages: {
        campaign: {
          component: "./src/campaign/Page.tsx",
          html: "./index.html",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "production",
    });
    const campaignRegionId = getSinglePprRegionId(
      analysis.graph.pages.campaign.ppr?.regions,
    );

    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.graph.pages.campaign.ppr).toEqual({
      delivery: "merge",
      regions: {
        [campaignRegionId]: {
          component: "./src/campaign/Offer.region.tsx",
          cache: { revalidate: 30 },
          hydrate: "none",
        },
      },
    });
    expect(plan.entries).toEqual(
      expect.arrayContaining([
        {
          name: "campaign-ppr-shell",
          import: "./src/campaign/Page.tsx",
          environment: "server",
          runtime: "node",
          kind: "ppr-shell",
          owner: { pageId: "campaign" },
        },
        {
          name: `campaign-${campaignRegionId}-ppr-region`,
          import: "./src/campaign/Offer.region.tsx",
          environment: "server",
          runtime: "node",
          kind: "ppr-region",
          owner: { pageId: "campaign", regionId: campaignRegionId },
        },
      ]),
    );
  });

  it("keeps ordinary Suspense PPR boundaries as shell-only until runtime resume support lands", async () => {
    const cwd = await createFixture({
      "src/campaign/Page.tsx": `
        import { Suspense } from "react";
        import Offer from "./Offer";

        export const render = "ssr";
        export const hydrate = "none";
        export const prerender = { partial: true } as const;
        export default function Page() {
          return (
            <Suspense fallback={<p>Loading offer</p>}>
              <Offer />
            </Suspense>
          );
        }
      `,
      "src/campaign/Offer.tsx": `
        export default function Offer() { return null; }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      pages: {
        campaign: {
          component: "./src/campaign/Page.tsx",
          html: "./index.html",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "production",
    });

    expect(analysis.diagnostics).toEqual([
      {
        level: "warning",
        file: "src/campaign/Page.tsx",
        message:
          'PPR Suspense boundary was not split into an internal region renderer. Partial prerendering is experimental; evjs currently recognizes only a direct React.lazy(() => import("./...")) component child for compatibility, and other Suspense boundaries render as part of the shell until runtime postponed/resume support lands.',
      },
    ]);
    expect(analysis.graph.pages.campaign.ppr).toEqual({
      delivery: "merge",
    });
    expect(plan.entries).toContainEqual({
      name: "campaign-ppr-shell",
      import: "./src/campaign/Page.tsx",
      environment: "server",
      runtime: "node",
      kind: "ppr-shell",
      owner: { pageId: "campaign" },
    });
    expect(plan.entries.filter((entry) => entry.kind === "ppr-region")).toEqual(
      [],
    );
  });

  it("reports invalid PPR region static exports before bundling", async () => {
    const cwd = await createFixture({
      "src/campaign/Page.tsx": `
        import * as React from "react";
        const OfferRegion = React.lazy(() => import("./Offer.region"));
        export const render = "ssr";
        export const hydrate = "none";
        export const prerender = { partial: true } as const;
        export default function Page() {
          return (
            <React.Suspense fallback={null}>
              <OfferRegion />
            </React.Suspense>
          );
        }
      `,
      "src/campaign/Offer.region.tsx": `
        export const cache = { revalidate: 30, revalidate: 60 } as const;
        export const hydrate = "soon";
        export default function Offer() { return null; }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      pages: {
        campaign: {
          component: "./src/campaign/Page.tsx",
          html: "./index.html",
        },
      },
    });

    const analysis = await createAppGraph(config, cwd);
    const campaignRegionId = getSinglePprRegionId(
      analysis.graph.pages.campaign.ppr?.regions,
    );

    expect(analysis.diagnostics).toEqual([
      {
        level: "error",
        file: "src/campaign/Offer.region.tsx",
        message:
          'PPR region cache property "revalidate" is declared more than once.',
      },
      {
        level: "error",
        file: "src/campaign/Offer.region.tsx",
        message:
          'PPR region hydrate must be one of "none", "load", "visible", or "idle".',
      },
    ]);
    expect(
      analysis.graph.pages.campaign.ppr?.regions?.[campaignRegionId],
    ).toEqual({
      component: "./src/campaign/Offer.region.tsx",
    });
  });

  it("reports malformed PPR region modules before bundling", async () => {
    const cwd = await createFixture({
      "src/campaign/Page.tsx": `
        import * as React from "react";
        const OfferRegion = React.lazy(() => import("./Offer.region"));
        export const render = "ssr";
        export const hydrate = "none";
        export const prerender = { partial: true } as const;
        export default function Page() {
          return (
            <React.Suspense fallback={null}>
              <OfferRegion />
            </React.Suspense>
          );
        }
      `,
      "src/campaign/Offer.region.tsx": `
        export const cache = { revalidate: 30 };
        export default function Offer( {
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      pages: {
        campaign: {
          component: "./src/campaign/Page.tsx",
          html: "./index.html",
        },
      },
    });

    const analysis = await createAppGraph(config, cwd);
    const campaignRegionId = getSinglePprRegionId(
      analysis.graph.pages.campaign.ppr?.regions,
    );

    expect(analysis.diagnostics).toContainEqual({
      level: "error",
      file: "src/campaign/Offer.region.tsx",
      message: expect.stringContaining(
        "PPR region metadata could not be parsed:",
      ),
    });
    expect(
      analysis.graph.pages.campaign.ppr?.regions?.[campaignRegionId],
    ).toEqual({
      component: "./src/campaign/Offer.region.tsx",
    });
  });

  it("reports duplicate PPR region metadata exports before applying region config", async () => {
    const cwd = await createFixture({
      "src/campaign/Page.tsx": `
        import * as React from "react";
        const OfferRegion = React.lazy(() => import("./Offer.region"));
        export const render = "ssr";
        export const hydrate = "none";
        export const prerender = { partial: true } as const;
        export default function Page() {
          return (
            <React.Suspense fallback={null}>
              <OfferRegion />
            </React.Suspense>
          );
        }
      `,
      "src/campaign/Offer.region.tsx": `
        const noStore = "no-store";
        const cached = { revalidate: 30 } as const;
        const loadHydrate = "load";
        export { noStore as cache };
        export { cached as cache };
        export { loadHydrate as hydrate };
        export const hydrate = "none";
        export default function Offer() { return null; }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      pages: {
        campaign: {
          component: "./src/campaign/Page.tsx",
          html: "./index.html",
        },
      },
    });

    const analysis = await createAppGraph(config, cwd);
    const campaignRegionId = getSinglePprRegionId(
      analysis.graph.pages.campaign.ppr?.regions,
    );

    expect(analysis.diagnostics).toEqual([
      {
        level: "error",
        file: "src/campaign/Offer.region.tsx",
        message:
          'PPR region metadata export "cache" is declared more than once. Keep one static export for each region metadata field.',
      },
      {
        level: "error",
        file: "src/campaign/Offer.region.tsx",
        message:
          'PPR region metadata export "hydrate" is declared more than once. Keep one static export for each region metadata field.',
      },
    ]);
    expect(
      analysis.graph.pages.campaign.ppr?.regions?.[campaignRegionId],
    ).toEqual({
      component: "./src/campaign/Offer.region.tsx",
    });
  });

  it("reports PPR region metadata exports without static values", async () => {
    const cwd = await createFixture({
      "src/campaign/Page.tsx": `
        import * as React from "react";
        const OfferRegion = React.lazy(() => import("./Offer.region"));
        export const render = "ssr";
        export const hydrate = "none";
        export const prerender = { partial: true } as const;
        export default function Page() {
          return (
            <React.Suspense fallback={null}>
              <OfferRegion />
            </React.Suspense>
          );
        }
      `,
      "src/campaign/Offer.region.tsx": `
        export let cache;
        let hydration;
        export { hydration as hydrate };
        export default function Offer() { return null; }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      pages: {
        campaign: {
          component: "./src/campaign/Page.tsx",
          html: "./index.html",
        },
      },
    });

    const analysis = await createAppGraph(config, cwd);
    const campaignRegionId = getSinglePprRegionId(
      analysis.graph.pages.campaign.ppr?.regions,
    );

    expect(analysis.diagnostics).toEqual([
      {
        level: "error",
        file: "src/campaign/Offer.region.tsx",
        message:
          'PPR region cache must be "no-store" or an object literal with a positive integer revalidate.',
      },
      {
        level: "error",
        file: "src/campaign/Offer.region.tsx",
        message:
          'PPR region hydrate must be one of "none", "load", "visible", or "idle".',
      },
    ]);
    expect(
      analysis.graph.pages.campaign.ppr?.regions?.[campaignRegionId],
    ).toEqual({
      component: "./src/campaign/Offer.region.tsx",
    });
  });

  it("reports PPR region metadata exports declared with unsupported runtime forms", async () => {
    const cwd = await createFixture({
      "src/campaign/Page.tsx": `
        import * as React from "react";
        const OfferRegion = React.lazy(() => import("./Offer.region"));
        export const render = "ssr";
        export const hydrate = "none";
        export const prerender = { partial: true } as const;
        export default function Page() {
          return (
            <React.Suspense fallback={null}>
              <OfferRegion />
            </React.Suspense>
          );
        }
      `,
      "src/campaign/Offer.region.tsx": `
        export { policy as cache } from "./region-cache";
        export function hydrate() {
          return "none";
        }
        export default function Offer() { return null; }
      `,
      "src/campaign/region-cache.ts": `
        export const policy = "no-store";
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      pages: {
        campaign: {
          component: "./src/campaign/Page.tsx",
          html: "./index.html",
        },
      },
    });

    const analysis = await createAppGraph(config, cwd);
    const campaignRegionId = getSinglePprRegionId(
      analysis.graph.pages.campaign.ppr?.regions,
    );

    expect(analysis.diagnostics).toEqual([
      {
        level: "error",
        file: "src/campaign/Offer.region.tsx",
        message:
          'PPR region metadata export "cache" must be declared as a local variable with a static initializer. Re-exported, function, and class exports are not supported for PPR region metadata.',
      },
      {
        level: "error",
        file: "src/campaign/Offer.region.tsx",
        message:
          'PPR region metadata export "hydrate" must be declared as a local variable with a static initializer. Re-exported, function, and class exports are not supported for PPR region metadata.',
      },
    ]);
    expect(
      analysis.graph.pages.campaign.ppr?.regions?.[campaignRegionId],
    ).toEqual({
      component: "./src/campaign/Offer.region.tsx",
    });
  });

  it("derives framework routes from configured page paths", async () => {
    const cwd = await createFixture({
      "src/main.tsx": "console.log('app');",
      "src/pages/Dashboard.tsx": `
        export const render = "ssr";
        export const hydrate = "load";
        export default function Dashboard() { return null; }
      `,
      "src/pages/Campaign.tsx": `
        import * as React from "react";
        const OfferRegion = React.lazy(() => import("./OfferRegion"));
        export const render = "ssr";
        export const hydrate = "none";
        export const prerender = { partial: true } as const;
        export default function Campaign() {
          return (
            <React.Suspense fallback={null}>
              <OfferRegion />
            </React.Suspense>
          );
        }
      `,
      "src/pages/OfferRegion.tsx":
        "export default function OfferRegion() { return null; }",
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      apps: {
        default: {
          entry: "./src/main.tsx",
          html: "./index.html",
        },
      },
      pages: {
        dashboard: {
          path: "/dashboard",
          component: "./src/pages/Dashboard.tsx",
          html: "./index.html",
        },
        campaign: {
          path: "/campaign",
          component: "./src/pages/Campaign.tsx",
          html: "./index.html",
        },
      },
    });

    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "production",
    });

    expect(analysis.graph.routes).toEqual([
      {
        id: "dashboard",
        path: "/dashboard",
        appId: "default",
        pageId: "dashboard",
        module: "./src/pages/Dashboard.tsx",
        render: "ssr",
        hydrate: "load",
      },
      {
        id: "campaign",
        path: "/campaign",
        appId: "default",
        pageId: "campaign",
        module: "./src/pages/Campaign.tsx",
        render: "ssr",
        hydrate: "none",
      },
    ]);
    expect(analysis.graph.pages.dashboard).toEqual(
      expect.objectContaining({
        id: "dashboard",
        path: "/dashboard",
        routeId: "dashboard",
        component: "./src/pages/Dashboard.tsx",
        render: "ssr",
      }),
    );
    expect(plan.html).toEqual([
      {
        id: "index",
        template: "./index.html",
        fileName: "index.html",
        owner: { appId: "default" },
      },
    ]);
    expect(plan.server.renderers).toEqual(
      expect.arrayContaining([
        {
          name: "dashboard-server",
          import: "./src/pages/Dashboard.tsx",
          kind: "page-server",
          owner: { pageId: "dashboard", routeId: "dashboard" },
        },
        {
          name: "campaign-ppr-shell",
          import: "./src/pages/Campaign.tsx",
          kind: "ppr-shell",
          owner: { pageId: "campaign", routeId: "campaign" },
        },
      ]),
    );
  });

  it("reports invalid explicit page paths at the graph boundary", async () => {
    const cwd = await createFixture({
      "src/main.tsx": "console.log('app');",
      "src/pages/Dashboard.tsx":
        "export default function Dashboard() { return null; }",
      "src/pages/MissingSlash.tsx":
        "export default function MissingSlash() { return null; }",
      "src/pages/BadPath.tsx":
        "export default function BadPath() { return null; }",
      "src/pages/UserById.tsx":
        "export default function UserById() { return null; }",
      "src/pages/UserByUserId.tsx":
        "export default function UserByUserId() { return null; }",
      "src/pages/UnsafeParam.tsx":
        "export default function UnsafeParam() { return null; }",
      "src/pages/DashboardCopy.tsx":
        "export default function DashboardCopy() { return null; }",
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      apps: {
        default: {
          entry: "./src/main.tsx",
          html: "./index.html",
        },
      },
      pages: {
        dashboard: {
          path: "/dashboard",
          component: "./src/pages/Dashboard.tsx",
          html: "./index.html",
        },
        missingSlash: {
          path: "missing-slash",
          component: "./src/pages/MissingSlash.tsx",
          html: "./index.html",
        },
        badPath: {
          path: "/bad path",
          component: "./src/pages/BadPath.tsx",
          html: "./index.html",
        },
        userById: {
          path: "/users/:id",
          component: "./src/pages/UserById.tsx",
          html: "./index.html",
        },
        userByUserId: {
          path: "/users/:userId",
          component: "./src/pages/UserByUserId.tsx",
          html: "./index.html",
        },
        unsafeParam: {
          path: "/session/:__proto__",
          component: "./src/pages/UnsafeParam.tsx",
          html: "./index.html",
        },
        dashboardCopy: {
          path: "/dashboard",
          component: "./src/pages/DashboardCopy.tsx",
          html: "./index.html",
        },
      },
    });

    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });

    expect(analysis.diagnostics).toEqual([
      {
        level: "error",
        file: "src/pages/MissingSlash.tsx",
        message:
          'Configured page "missingSlash" path "missing-slash" must start with "/".',
      },
      {
        level: "error",
        file: "src/pages/BadPath.tsx",
        message:
          'Configured page "badPath" path "/bad path" must not contain whitespace.',
      },
      {
        level: "error",
        file: "src/pages/UserByUserId.tsx",
        message:
          'Configured page "userByUserId" path "/users/:userId" has the same route shape as page "userById" (/users/:id). Use one dynamic param name for each URL shape.',
      },
      {
        level: "error",
        file: "src/pages/UnsafeParam.tsx",
        message:
          'Configured page "unsafeParam" path "/session/:__proto__" uses reserved dynamic param name "__proto__" in segment ":__proto__". Use a safe application-specific name.',
      },
      {
        level: "error",
        file: "src/pages/DashboardCopy.tsx",
        message:
          'Configured page "dashboardCopy" path "/dashboard" is already declared by page "dashboard". Keep one page route per URL path.',
      },
    ]);
    expect(analysis.graph.routes).toEqual([
      {
        id: "dashboard",
        path: "/dashboard",
        appId: "default",
        pageId: "dashboard",
        module: "./src/pages/Dashboard.tsx",
        render: "csr",
      },
      {
        id: "userById",
        path: "/users/:id",
        appId: "default",
        pageId: "userById",
        module: "./src/pages/UserById.tsx",
        render: "csr",
      },
    ]);
    expect(analysis.graph.pages.missingSlash.path).toBeUndefined();
    expect(analysis.graph.pages.badPath.path).toBeUndefined();
    expect(analysis.graph.pages.userByUserId.path).toBeUndefined();
    expect(analysis.graph.pages.unsafeParam.path).toBeUndefined();
    expect(analysis.graph.pages.dashboardCopy.path).toBeUndefined();
    expect(
      plan.entries.find((entry) => entry.owner?.pageId === "missingSlash")
        ?.metadata,
    ).toEqual({
      type: "react-component-page",
      component: "./src/pages/MissingSlash.tsx",
      mount: "#app",
      hydrate: "load",
      render: "csr",
    });
  });

  it("rejects PPR pages when server output is disabled", async () => {
    const cwd = await createFixture({
      "src/campaign/Page.tsx": `
        export const render = "ssr";
        export const prerender = { partial: true } as const;
        export default function Page() { return null; }
      `,
    });
    const config = createConfig({
      serverEnabled: false,
      pages: {
        campaign: {
          component: "./src/campaign/Page.tsx",
          html: "./index.html",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);

    expect(analysis.diagnostics).toEqual([
      {
        level: "error",
        file: "src/campaign/Page.tsx",
        message:
          'Page "campaign" uses partial prerendering but server is disabled.',
      },
    ]);
  });

  it("rejects PPR pages without a component page module", async () => {
    const cwd = await createFixture({
      "src/campaign/main.tsx": "console.log('campaign');",
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      pages: {
        campaign: {
          entry: "./src/campaign/main.tsx",
          html: "./index.html",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    analysis.graph.pages.campaign.prerender = { partial: true };
    analysis.graph.pages.campaign.ppr = { regions: {} };

    expect(() =>
      createBuildPlan(config, analysis.graph, { mode: "production" }),
    ).toThrow(
      'Page "campaign" uses partial prerendering but does not declare a component page module',
    );
  });

  it("rejects PPR pages without SSR document rendering", async () => {
    const cwd = await createFixture({
      "src/campaign/Page.tsx": `
        export const prerender = { partial: true } as const;
        export default function Page() { return null; }
      `,
    });
    const config = createConfig({
      pages: {
        campaign: {
          component: "./src/campaign/Page.tsx",
          html: "./index.html",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);

    expect(analysis.diagnostics).toEqual([
      {
        level: "error",
        file: "src/campaign/Page.tsx",
        message:
          'Page "campaign" uses partial prerendering and must declare render: "ssr".',
      },
    ]);
  });

  it("plans RSC pages as server renderers without a client page entry", async () => {
    const cwd = await createFixture({
      "src/pages/rsc.tsx": `
        export const render = "ssr";
        export const rsc = true;
        export default function RscPage() { return null; }
      `,
    });
    const config = createConfig({
      pages: {
        rsc: {
          component: "./src/pages/rsc.tsx",
          html: "./index.html",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "production",
    });

    expect(plan.runtime.server?.rsc).toBe("/__evjs/rsc");
    expect(plan.entries).toEqual(
      expect.arrayContaining([
        {
          name: "rsc-server",
          import: "./src/pages/rsc.tsx",
          environment: "server",
          runtime: "node",
          kind: "page-server",
          owner: { pageId: "rsc" },
        },
        {
          name: "rsc-rsc",
          import: "./src/pages/rsc.tsx",
          environment: "server",
          runtime: "node",
          kind: "rsc-page",
          owner: { pageId: "rsc" },
        },
      ]),
    );
    expect(
      plan.entries.filter(
        (entry) =>
          entry.kind === "page-client" && entry.owner?.pageId === "rsc",
      ),
    ).toEqual([]);
    expect(plan.server.renderers).toEqual([
      {
        name: "rsc-server",
        import: "./src/pages/rsc.tsx",
        kind: "page-server",
        owner: { pageId: "rsc" },
      },
      {
        name: "rsc-rsc",
        import: "./src/pages/rsc.tsx",
        kind: "rsc-page",
        owner: { pageId: "rsc" },
      },
    ]);
  });

  it("rejects full prerendering on CSR pages", async () => {
    const cwd = await createFixture({
      "src/pages/home.tsx": `
        export const prerender = true;
        export default function Home() { return null; }
      `,
    });
    const config = createConfig({
      pages: {
        home: {
          component: "./src/pages/home.tsx",
          html: "./index.html",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);

    expect(analysis.diagnostics).toEqual([
      {
        level: "error",
        file: "src/pages/home.tsx",
        message:
          'Page "home" uses full prerendering and must declare render: "ssg" or "ssr".',
      },
    ]);
  });

  it("rejects RSC pages when server output is disabled", async () => {
    const cwd = await createFixture({
      "src/pages/rsc.tsx": `
        export const render = "ssr";
        export const rsc = true;
        export default function RscPage() { return null; }
      `,
    });
    const config = createConfig({
      serverEnabled: false,
      pages: {
        rsc: {
          component: "./src/pages/rsc.tsx",
          html: "./index.html",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);

    expect(analysis.diagnostics).toEqual([
      {
        level: "error",
        file: "src/pages/rsc.tsx",
        message: 'Page "rsc" uses RSC but server is disabled.',
      },
    ]);
  });

  it("rejects RSC pages without SSR document rendering", async () => {
    const cwd = await createFixture({
      "src/pages/rsc.tsx": `
        export const rsc = true;
        export default function RscPage() { return null; }
      `,
    });
    const config = createConfig({
      pages: {
        rsc: {
          component: "./src/pages/rsc.tsx",
          html: "./index.html",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);

    expect(analysis.diagnostics).toEqual([
      {
        level: "error",
        file: "src/pages/rsc.tsx",
        message: 'Page "rsc" uses RSC and must declare render: "ssr".',
      },
    ]);
  });

  it("rejects RSC pages with explicit browser hydration", async () => {
    const cwd = await createFixture({
      "src/pages/rsc.tsx": `
        export const render = "ssr";
        export const rsc = true;
        export const hydrate = "load";
        export default function RscPage() { return null; }
      `,
    });
    const config = createConfig({
      pages: {
        rsc: {
          component: "./src/pages/rsc.tsx",
          html: "./index.html",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);

    expect(analysis.diagnostics).toEqual([
      {
        level: "error",
        file: "src/pages/rsc.tsx",
        message:
          'Page "rsc" uses RSC and must omit hydrate or declare hydrate: "none".',
      },
    ]);
  });

  it("rejects pages that combine RSC and partial prerendering", async () => {
    const cwd = await createFixture({
      "src/pages/campaign.tsx": `
        export const render = "ssr";
        export const rsc = true;
        export const prerender = { partial: true } as const;
        export default function CampaignPage() { return null; }
      `,
    });
    const config = createConfig({
      pages: {
        campaign: {
          component: "./src/pages/campaign.tsx",
          html: "./index.html",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);

    expect(analysis.diagnostics).toEqual([
      {
        level: "error",
        file: "src/pages/campaign.tsx",
        message:
          'Page "campaign" combines RSC and partial prerendering, which is not supported yet. Choose either rsc: true or prerender: { partial: true }, or split them into separate page routes.',
      },
    ]);
  });

  it("reports unsupported RSC client export-star re-exports during graph analysis", async () => {
    const cwd = await createFixture({
      "src/pages/rsc.tsx": `
        import * as ClientWidgets from "./ClientIndex";

        export const render = "ssr";
        export const rsc = true;
        export default function RscPage() {
          void ClientWidgets;
          return null;
        }
      `,
      "src/pages/ClientIndex.tsx": `
        "use client";

        export function StableWidget() {
          return null;
        }

        export type * from "./types";
        export * from "./ClientWidget";
      `,
      "src/pages/ClientWidget.tsx": `
        export function ClientWidget() {
          return null;
        }
      `,
      "src/pages/types.ts": `
        export interface ClientWidgetProps {
          id: string;
        }
      `,
    });
    const config = createConfig({
      pages: {
        rsc: {
          component: "./src/pages/rsc.tsx",
          html: "./index.html",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);

    expect(analysis.graph.clientReferences).toEqual([]);
    expect(analysis.diagnostics).toContainEqual({
      level: "error",
      file: "src/pages/ClientIndex.tsx",
      message:
        '"use client" modules cannot use bare export * from "./ClientWidget" because client reference names must be statically known. Use explicit named exports or a namespace re-export such as export * as Widgets from "./widgets".',
    });
  });

  it("reports use-client modules without runtime exports during graph analysis", async () => {
    const cwd = await createFixture({
      "src/pages/rsc.tsx": `
        import * as ClientTypes from "./ClientTypes";

        export const render = "ssr";
        export const rsc = true;
        export default function RscPage() {
          void ClientTypes;
          return null;
        }
      `,
      "src/pages/ClientTypes.tsx": `
        "use client";

        export type { WidgetProps } from "./types";

        function LocalWidget() {
          return null;
        }
      `,
      "src/pages/types.ts": `
        export interface WidgetProps {
          id: string;
        }
      `,
    });
    const config = createConfig({
      pages: {
        rsc: {
          component: "./src/pages/rsc.tsx",
          html: "./index.html",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);

    expect(analysis.graph.clientReferences).toEqual([]);
    expect(analysis.diagnostics).toContainEqual({
      level: "error",
      file: "src/pages/ClientTypes.tsx",
      message:
        '"use client" modules must export at least one runtime client reference. Add a default export, named export, or explicit re-export; otherwise remove the directive.',
    });
  });

  it("reports malformed use-client modules during graph analysis", async () => {
    const cwd = await createFixture({
      "src/pages/rsc.tsx": `
        import BrokenClient from "./BrokenClient.client";

        export const render = "ssr";
        export const rsc = true;
        export default function RscPage() {
          void BrokenClient;
          return null;
        }
      `,
      "src/pages/BrokenClient.client.tsx": `
        "use client";

        export default function BrokenClient( {
      `,
    });
    const config = createConfig({
      pages: {
        rsc: {
          component: "./src/pages/rsc.tsx",
          html: "./index.html",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);

    expect(analysis.graph.clientReferences).toEqual([]);
    expect(analysis.diagnostics).toContainEqual({
      level: "error",
      file: "src/pages/BrokenClient.client.tsx",
      message: expect.stringContaining(
        "RSC reference module could not be parsed:",
      ),
    });
  });

  it("reports modules that combine RSC client and server directives", async () => {
    const cwd = await createFixture({
      "src/pages/rsc.tsx": `
        import { ClientWidget } from "./ClientWidget";

        export const render = "ssr";
        export const rsc = true;
        export default function RscPage() {
          void ClientWidget;
          return null;
        }
      `,
      "src/pages/ClientWidget.tsx": `
        "use client";
        "use server";

        export function ClientWidget() {
          return null;
        }
      `,
    });
    const config = createConfig({
      pages: {
        rsc: {
          component: "./src/pages/rsc.tsx",
          html: "./index.html",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);

    expect(analysis.graph.clientReferences).toEqual([]);
    expect(analysis.graph.serverFunctions).toEqual([]);
    expect(analysis.graph.serverReferences).toEqual([]);
    expect(analysis.diagnostics).toContainEqual({
      level: "error",
      file: "src/pages/ClientWidget.tsx",
      message:
        '"use client" and "use server" directives cannot be used in the same module. Split client references and server functions into separate files.',
    });
  });

  it("collects RSC client and server references from imported modules", async () => {
    const cwd = await createFixture({
      "src/pages/rsc.tsx": `
        import ClientCard, { ClientWidget, "client-widget" as ClientWidgetAlias } from "./ClientCard";
        import { saveInsight } from "../actions";

        export const render = "ssr";
        export const rsc = true;
        export default function RscPage() {
          void ClientCard;
          void ClientWidget;
          void ClientWidgetAlias;
          void saveInsight;
          return null;
        }
      `,
      "src/pages/ClientCard.tsx": `
        "use client";

        export default function ClientCard() {
          return null;
        }

        export function ClientWidget() {
          return null;
        }

        export * as ClientNamespace from "./ClientNamespace";
        export { ClientWidget as "client-widget" };
        export type { ClientWidgetProps } from "./ClientNamespace";
        export declare function IgnoredDirect(): unknown;
        declare class AmbientWidget {}
        export { AmbientWidget as IgnoredAmbient };
      `,
      "src/pages/ClientNamespace.tsx": `
        export const ClientWidgetProps = null;
      `,
      "src/actions.ts": `
        "use server";

        export async function saveInsight() {
          return { ok: true };
        }
      `,
    });
    const config = createConfig({
      pages: {
        rsc: {
          component: "./src/pages/rsc.tsx",
          html: "./index.html",
        },
      },
    });

    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "production",
    });
    expect(plan.entries).toContainEqual(
      expect.objectContaining({
        name: "evjs-rsc-client",
        import: "@evjs/client/internal/rsc-runtime",
        environment: "client",
        kind: "runtime",
      }),
    );
    const output = linkBuildOutput({
      graph: analysis.graph,
      plan,
      clientEntryAssets: {
        "evjs-rsc-client": { js: ["evjs-rsc-client.js"], css: [] },
      },
      serverEntryAssets: {
        server: { js: ["server.js"], css: [] },
        "rsc-rsc": { js: ["rsc-rsc.js"], css: [] },
      },
    });

    expect(analysis.graph.clientReferences).toEqual([
      {
        id: "src/pages/ClientCard.tsx#default",
        module: "src/pages/ClientCard.tsx",
        exportName: "default",
      },
      {
        id: "src/pages/ClientCard.tsx#ClientWidget",
        module: "src/pages/ClientCard.tsx",
        exportName: "ClientWidget",
      },
      {
        id: "src/pages/ClientCard.tsx#ClientNamespace",
        module: "src/pages/ClientCard.tsx",
        exportName: "ClientNamespace",
      },
      {
        id: "src/pages/ClientCard.tsx#client-widget",
        module: "src/pages/ClientCard.tsx",
        exportName: "client-widget",
      },
    ]);
    expect(analysis.graph.serverReferences).toEqual([
      {
        id: hashServerFunction("src/actions.ts", "saveInsight"),
        module: "src/actions.ts",
        exportName: "saveInsight",
      },
    ]);
    expect(output.rsc?.clientReferences).toEqual({
      "src/pages/ClientCard.tsx#default": {
        module: "src/pages/ClientCard.tsx",
        exportName: "default",
      },
      "src/pages/ClientCard.tsx#ClientWidget": {
        module: "src/pages/ClientCard.tsx",
        exportName: "ClientWidget",
      },
      "src/pages/ClientCard.tsx#ClientNamespace": {
        module: "src/pages/ClientCard.tsx",
        exportName: "ClientNamespace",
      },
      "src/pages/ClientCard.tsx#client-widget": {
        module: "src/pages/ClientCard.tsx",
        exportName: "client-widget",
      },
    });
    expect(output.rsc?.serverReferences).toEqual({
      [hashServerFunction("src/actions.ts", "saveInsight")]: {
        module: "src/actions.ts",
        exportName: "saveInsight",
      },
    });
    expect(relativeFileDependencies(cwd, analysis.fileDependencies)).toEqual([
      "src/actions.ts",
      "src/pages/ClientCard.tsx",
      "src/pages/rsc.tsx",
    ]);
    expect(output.pages.rsc.assets).toEqual({
      js: ["evjs-rsc-client.js"],
      css: [],
    });
    expect(output.pages.rsc.rendering).toEqual({
      component: "rsc",
      html: "server",
      streaming: true,
      hydrate: "none",
    });
  });

  it("derives orthogonal page rendering metadata for manifest consumers", async () => {
    const cwd = await createFixture({
      "src/pages/csr.tsx": `
        export const render = "csr";
        export default function Csr() { return null; }
      `,
      "src/pages/ssr.tsx": `
        export const render = "ssr";
        export const hydrate = "visible";
        export default function Ssr() { return null; }
      `,
      "src/pages/full.tsx": `
        export const render = "ssr";
        export const prerender = true;
        export default function Full() { return null; }
      `,
      "src/pages/ssg.tsx": `
        export const render = "ssg";
        export default function Ssg() { return null; }
      `,
      "src/pages/ppr.tsx": `
        import * as React from "react";
        const OfferRegion = React.lazy(() => import("./region"));
        export const render = "ssr";
        export const hydrate = "none";
        export const prerender = { partial: true } as const;
        export default function Ppr() {
          return (
            <React.Suspense fallback={null}>
              <OfferRegion />
            </React.Suspense>
          );
        }
      `,
      "src/pages/region.tsx":
        "export default function Region() { return null; }",
      "src/pages/rsc.tsx": `
        export const render = "ssr";
        export const rsc = true;
        export default function Rsc() { return null; }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      pages: {
        csr: {
          component: "./src/pages/csr.tsx",
          html: "./index.html",
        },
        ssr: {
          component: "./src/pages/ssr.tsx",
          html: "./index.html",
        },
        full: {
          component: "./src/pages/full.tsx",
          html: "./index.html",
        },
        ssg: {
          component: "./src/pages/ssg.tsx",
          html: "./index.html",
        },
        ppr: {
          component: "./src/pages/ppr.tsx",
          html: "./index.html",
        },
        rsc: {
          component: "./src/pages/rsc.tsx",
          html: "./index.html",
        },
      },
    });

    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "production",
    });
    const output = linkBuildOutput({
      graph: analysis.graph,
      plan,
      clientEntryAssets: {
        csr: { js: ["csr.js"], css: [] },
        ssr: { js: ["ssr.js"], css: [] },
        full: { js: ["full.js"], css: [] },
        "evjs-rsc-client": { js: ["evjs-rsc-client.js"], css: [] },
      },
      serverEntryAssets: {
        server: { js: ["server.js"], css: [] },
      },
    });

    expect(output.pages.csr.rendering).toEqual({
      component: "client",
      html: "client",
      streaming: false,
      hydrate: "load",
    });
    expect(output.pages.ssr.rendering).toEqual({
      component: "server",
      html: "server",
      streaming: false,
      hydrate: "visible",
    });
    expect(output.pages.full.rendering).toEqual({
      component: "server",
      html: "server",
      prerender: "full",
      streaming: false,
      hydrate: "load",
    });
    expect(output.pages.ssg.rendering).toEqual({
      component: "server",
      html: "static",
      prerender: "full",
      streaming: false,
      hydrate: "none",
    });
    expect(output.pages.ppr.rendering).toEqual({
      component: "server",
      html: "partial",
      prerender: "partial",
      streaming: false,
      hydrate: "none",
    });
    expect(output.pages.ppr.render).toBe("ssr");
    expect(output.pages.ppr.ppr?.delivery).toBe("merge");
    expect(output.pages.ppr.assets).toEqual({ js: [], css: [] });
    expect(output.pages.rsc.rendering).toEqual({
      component: "rsc",
      html: "server",
      streaming: true,
      hydrate: "none",
    });
  });

  it("diffs page entry and HTML additions for dev plan updates", async () => {
    const cwd = await createFixture({
      "src/pages/home/main.tsx": "console.log('home');",
      "src/pages/orders/main.tsx": "console.log('orders');",
      "index.html": '<div id="app"></div>',
    });
    const previousConfig = createConfig({
      serverEnabled: false,
      pages: {
        home: {
          entry: "./src/pages/home/main.tsx",
          html: "./index.html",
        },
      },
    });
    const nextConfig = createConfig({
      serverEnabled: false,
      pages: {
        home: {
          entry: "./src/pages/home/main.tsx",
          html: "./index.html",
        },
        orders: {
          entry: "./src/pages/orders/main.tsx",
          html: "./index.html",
        },
      },
    });

    const previousGraph = await createAppGraph(previousConfig, cwd);
    const nextGraph = await createAppGraph(nextConfig, cwd);
    const previousPlan = createBuildPlan(previousConfig, previousGraph.graph, {
      mode: "development",
    });
    const nextPlan = createBuildPlan(nextConfig, nextGraph.graph, {
      mode: "development",
    });
    const update = diffBuildPlan(previousPlan, nextPlan, "config");

    expect(update.entries.added).toEqual([
      {
        name: "orders",
        import: "./src/pages/orders/main.tsx",
        environment: "client",
        runtime: "browser",
        kind: "page-client",
        owner: { pageId: "orders" },
      },
    ]);
    expect(update.entries.removed).toEqual([]);
    expect(update.entries.changed).toEqual([]);
    expect(update.html.added).toEqual([
      {
        id: "orders",
        template: "./index.html",
        fileName: "orders.html",
        owner: { pageId: "orders" },
      },
    ]);
    expect(update.serverChanged).toBe(false);
  });

  it("extracts server route and server function metadata", async () => {
    const cwd = await createFixture({
      "src/main.tsx": `
        export const clientEntry = true;
      `,
      "src/server.ts": `
        import "./api";
        import "./actions";
      `,
      "src/api.ts": `
        import { createRoute } from "@evjs/server";
        export const health = createRoute("/api/health", {
          GET: async () => Response.json({ ok: true }),
        });
      `,
      "src/actions.ts": `
        "use server";
        export async function saveOrder() {
          return { ok: true };
        }
      `,
    });
    const config = createConfig({
      server: {
        entry: "./src/server.ts",
        basePath: "/__evjs",
        functionRuntime: {
          endpoint: "/__evjs/fn",
          clientProxy: "@evjs/client/internal",
          serverRegister: "@evjs/server/register",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);

    expect(analysis.graph.routes).toEqual([]);
    expect(analysis.graph.serverRoutes).toEqual([
      {
        id: "src/api.ts:/api/health:GET",
        module: "src/api.ts",
        path: "/api/health",
        methods: ["GET"],
      },
    ]);
    expect(analysis.graph.serverFunctions).toEqual([
      {
        id: expect.any(String),
        module: "src/actions.ts",
        exportName: "saveOrder",
      },
    ]);
    expect(relativeFileDependencies(cwd, analysis.fileDependencies)).toEqual([
      "src/actions.ts",
      "src/api.ts",
      "src/server.ts",
    ]);
  });

  it("reports missing explicit server entries during graph analysis", async () => {
    const cwd = await createFixture({
      "src/main.tsx": `
        export const clientEntry = true;
      `,
    });
    const config = createConfig({
      server: {
        entry: "./src/missing-server.ts",
        basePath: "/__evjs",
        functionRuntime: {
          endpoint: "/__evjs/fn",
          clientProxy: "@evjs/client/internal",
          serverRegister: "@evjs/server/register",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);

    expect(analysis.graph.serverRoutes).toEqual([]);
    expect(analysis.graph.serverFunctions).toEqual([]);
    expect(analysis.diagnostics).toContainEqual({
      level: "error",
      file: "src/missing-server.ts",
      message: "Server entry source file not found.",
    });
  });

  it("reports malformed server route modules", async () => {
    const cwd = await createFixture({
      "src/main.tsx": `
        export const clientEntry = true;
      `,
      "src/server.ts": `
        import "./api";
      `,
      "src/api.ts": `
        import { createRoute } from "@evjs/server";
        export const users = createRoute("/api/users", {
          GET: async () => Response.json([])
      `,
    });
    const config = createConfig({
      server: {
        entry: "./src/server.ts",
        basePath: "/__evjs",
        functionRuntime: {
          endpoint: "/__evjs/fn",
          clientProxy: "@evjs/client/internal",
          serverRegister: "@evjs/server/register",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);

    expect(analysis.graph.serverRoutes).toEqual([]);
    expect(analysis.diagnostics).toContainEqual({
      level: "error",
      file: "src/api.ts",
      message: expect.stringContaining(
        "Server route module could not be parsed:",
      ),
    });
  });

  it("reports unsupported exported server route declarations", async () => {
    const cwd = await createFixture({
      "src/main.tsx": `
        export const clientEntry = true;
      `,
      "src/server.ts": `
        import "./api";
      `,
      "src/api.ts": `
        "use client";
        import { createRoute } from "@evjs/server";
        export function ClientWidget() {
          return null;
        }
        export const valid = createRoute("/api/valid", {
          GET: async () => Response.json({ ok: true }),
        });
        const routePath = "/api/dynamic";
        export const dynamic = createRoute(routePath, {
          GET: async () => Response.json({ ok: true }),
        });
        export const relative = createRoute("api/relative", {
          GET: async () => Response.json({ ok: true }),
        });
        export const whitespacePath = createRoute("/api/space ", {
          GET: async () => Response.json({ ok: true }),
        });
        export const queryPath = createRoute("/api/query?filter=all", {
          GET: async () => Response.json({ ok: true }),
        });
        export const emptyParam = createRoute("/api/empty-param/:", {
          GET: async () => Response.json({ ok: true }),
        });
        export const reservedParam = createRoute("/api/reserved-param/:constructor", {
          GET: async () => Response.json({ ok: true }),
        });
        export const duplicateParam = createRoute("/api/users/:userId/posts/:userId", {
          GET: async () => Response.json({ ok: true }),
        });
        export const empty = createRoute("/api/empty", {
          middlewares: [],
        });
        export const lowerCaseMethod = createRoute("/api/lowercase", {
          get: async () => Response.json({ ok: true }),
        });
        export const legacyMiddleware = createRoute("/api/legacy-middleware", {
          middleware: [],
          GET: async () => Response.json({ ok: true }),
        });
        export const literalMethod = createRoute("/api/literal-method", {
          GET: "not a function",
        });
        export const invalidMiddlewares = createRoute("/api/invalid-middlewares", {
          middlewares: [null],
          GET: async () => Response.json({ ok: true }),
        });
        let missingHandler;
        export const uninitializedHandler = createRoute("/api/uninitialized-handler", {
          GET: missingHandler,
        });
        let missingMiddlewares;
        export const uninitializedMiddlewares = createRoute("/api/uninitialized-middlewares", {
          middlewares: missingMiddlewares,
          GET: async () => Response.json({ ok: true }),
        });
      `,
    });
    const config = createConfig({
      server: {
        entry: "./src/server.ts",
        basePath: "/__evjs",
        functionRuntime: {
          endpoint: "/__evjs/fn",
          clientProxy: "@evjs/client/internal",
          serverRegister: "@evjs/server/register",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);

    expect(analysis.graph.clientReferences).toEqual([]);
    expect(analysis.graph.serverRoutes).toEqual([]);
    expect(analysis.diagnostics).toContainEqual({
      level: "error",
      file: "src/api.ts",
      message:
        'Server route "dynamic" must use a string-literal createRoute() path.',
    });
    expect(analysis.diagnostics).toContainEqual({
      level: "error",
      file: "src/api.ts",
      message:
        'Server route "relative" must use a createRoute() path that starts with "/".',
    });
    expect(analysis.diagnostics).toContainEqual({
      level: "error",
      file: "src/api.ts",
      message:
        'Server route "whitespacePath" must use a createRoute() path without whitespace.',
    });
    expect(analysis.diagnostics).toContainEqual({
      level: "error",
      file: "src/api.ts",
      message:
        'Server route "queryPath" must use a createRoute() path without query strings or hashes.',
    });
    expect(analysis.diagnostics).toContainEqual({
      level: "error",
      file: "src/api.ts",
      message:
        'Server route "emptyParam" path contains dynamic segment ":" without a param name.',
    });
    expect(analysis.diagnostics).toContainEqual({
      level: "error",
      file: "src/api.ts",
      message:
        'Server route "reservedParam" path uses reserved dynamic param name "constructor" in segment ":constructor". Use a safe application-specific name.',
    });
    expect(analysis.diagnostics).toContainEqual({
      level: "error",
      file: "src/api.ts",
      message:
        'Server route "duplicateParam" path uses duplicate dynamic param name "userId" in segment ":userId". Use unique param names within one route path.',
    });
    expect(analysis.diagnostics).toContainEqual({
      level: "error",
      file: "src/api.ts",
      message:
        'Server route "empty" must declare at least one HTTP method handler.',
    });
    expect(analysis.diagnostics).toContainEqual({
      level: "error",
      file: "src/api.ts",
      message:
        'Server route "lowerCaseMethod" definition key "get" is not supported. Use GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS or "middlewares".',
    });
    expect(analysis.diagnostics).toContainEqual({
      level: "error",
      file: "src/api.ts",
      message:
        'Server route "legacyMiddleware" uses "middleware"; use "middlewares" for per-route middleware.',
    });
    expect(analysis.diagnostics).toContainEqual({
      level: "error",
      file: "src/api.ts",
      message: 'Server route "literalMethod" GET handler must be a function.',
    });
    expect(analysis.diagnostics).toContainEqual({
      level: "error",
      file: "src/api.ts",
      message:
        'Server route "invalidMiddlewares" middlewares must be an array of functions.',
    });
    expect(analysis.diagnostics).toContainEqual({
      level: "error",
      file: "src/api.ts",
      message:
        'Server route "uninitializedHandler" GET handler must be a function.',
    });
    expect(analysis.diagnostics).toContainEqual({
      level: "error",
      file: "src/api.ts",
      message:
        'Server route "uninitializedMiddlewares" middlewares must be an array of functions.',
    });
  });

  it("reports duplicate exported server route paths", async () => {
    const cwd = await createFixture({
      "src/main.tsx": `
        export const clientEntry = true;
      `,
      "src/server.ts": `
        import "./api/a-customers";
        import "./api/b-customers";
      `,
      "src/api/a-customers.ts": `
        import { createRoute } from "@evjs/server";
        export const customersGet = createRoute("/api/customers", {
          GET: async () => Response.json([]),
        });
      `,
      "src/api/b-customers.ts": `
        import { createRoute } from "@evjs/server";
        export const customersPost = createRoute("/api/customers", {
          POST: async () => Response.json({ ok: true }),
        });
      `,
    });
    const config = createConfig({
      server: {
        entry: "./src/server.ts",
        basePath: "/__evjs",
        functionRuntime: {
          endpoint: "/__evjs/fn",
          clientProxy: "@evjs/client/internal",
          serverRegister: "@evjs/server/register",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);

    expect(analysis.graph.serverRoutes).toEqual([
      {
        id: "src/api/a-customers.ts:/api/customers:GET",
        module: "src/api/a-customers.ts",
        path: "/api/customers",
        methods: ["GET"],
      },
    ]);
    expect(analysis.diagnostics).toContainEqual({
      level: "error",
      file: "src/api/b-customers.ts",
      message:
        'Server route path "/api/customers" is already declared by src/api/a-customers.ts. Declare all HTTP methods for a path in one createRoute() call.',
    });
  });

  it("reports duplicate exported server route shapes", async () => {
    const cwd = await createFixture({
      "src/main.tsx": `
        export const clientEntry = true;
      `,
      "src/server.ts": `
        import "./api/a-customer";
        import "./api/b-customer";
      `,
      "src/api/a-customer.ts": `
        import { createRoute } from "@evjs/server";
        export const customerGet = createRoute("/api/customers/:id", {
          GET: async () => Response.json({ ok: true }),
        });
      `,
      "src/api/b-customer.ts": `
        import { createRoute } from "@evjs/server";
        export const customerPost = createRoute("/api/customers/:customerId", {
          POST: async () => Response.json({ ok: true }),
        });
      `,
    });
    const config = createConfig({
      server: {
        entry: "./src/server.ts",
        basePath: "/__evjs",
        functionRuntime: {
          endpoint: "/__evjs/fn",
          clientProxy: "@evjs/client/internal",
          serverRegister: "@evjs/server/register",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);

    expect(analysis.graph.serverRoutes).toEqual([
      {
        id: "src/api/a-customer.ts:/api/customers/:id:GET",
        module: "src/api/a-customer.ts",
        path: "/api/customers/:id",
        methods: ["GET"],
      },
    ]);
    expect(analysis.diagnostics).toContainEqual({
      level: "error",
      file: "src/api/b-customer.ts",
      message:
        'Server route path "/api/customers/:customerId" has the same route shape as src/api/a-customer.ts (/api/customers/:id). Use one route handler per URL shape.',
    });
  });

  it("extracts callable named server function exports only", async () => {
    const cwd = await createFixture({
      "src/main.tsx": "console.log('app');",
      "src/server.ts": `
        import "./actions";
      `,
      "src/actions.ts": `
        "use server";

        export async function saveOrder() {
          return { ok: true };
        }

        export const createOrder = async () => {
          return { ok: true };
        };

        const cancelOrder = async () => {
          return { ok: true };
        };

        type OrderInput = { id: string };
        export { cancelOrder as removeOrder };
        export { cancelOrder as "cancel-order" };
        export type { OrderInput };
        export type { OrderRecord } from "./types";
      `,
      "src/types.ts": `
        export interface OrderRecord {
          id: string;
        }
      `,
    });
    const config = createConfig({
      server: {
        entry: "./src/server.ts",
        basePath: "/__evjs",
        functionRuntime: {
          endpoint: "/__evjs/fn",
          clientProxy: "@evjs/client/internal",
          serverRegister: "@evjs/server/register",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);

    expect(analysis.diagnostics).toEqual([]);
    expect(
      analysis.graph.serverFunctions.map((fn) => ({
        module: fn.module,
        exportName: fn.exportName,
      })),
    ).toEqual([
      { module: "src/actions.ts", exportName: "saveOrder" },
      { module: "src/actions.ts", exportName: "createOrder" },
      { module: "src/actions.ts", exportName: "removeOrder" },
      { module: "src/actions.ts", exportName: "cancel-order" },
    ]);
    expect(relativeFileDependencies(cwd, analysis.fileDependencies)).toEqual([
      "src/actions.ts",
      "src/server.ts",
    ]);
  });

  it("reports unsupported use-server exports during graph analysis", async () => {
    const cwd = await createFixture({
      "src/main.tsx": `
        import "./actions";
      `,
      "src/actions.ts": `
        "use server";

        export async function validSaveOrder() {
          return { ok: true };
        }

        export default async function saveOrder() {
          return { ok: true };
        }

        export const VERSION = "1";
        export declare function ambientSaveOrder(): Promise<void>;
      `,
    });
    const config = createConfig();
    const analysis = await createAppGraph(config, cwd);

    expect(analysis.graph.serverFunctions).toEqual([]);
    expect(analysis.graph.serverReferences).toEqual([]);
    expect(analysis.diagnostics).toEqual([
      {
        level: "error",
        file: "src/actions.ts",
        message:
          '"use server" modules cannot default-export server functions. Export a named function instead.',
      },
      {
        level: "error",
        file: "src/actions.ts",
        message:
          '"use server" export "VERSION" must be a function declaration or a const initialized to a function.',
      },
      {
        level: "error",
        file: "src/actions.ts",
        message:
          '"use server" export "ambientSaveOrder" must include a runtime function implementation. Ambient declare exports are type-only.',
      },
    ]);
  });

  it("reports malformed use-server modules during graph analysis", async () => {
    const cwd = await createFixture({
      "src/main.tsx": `
        import { saveOrder } from "./actions";
        void saveOrder;
      `,
      "src/actions.ts": `
        "use server";

        export async function saveOrder( {
      `,
    });
    const config = createConfig();
    const analysis = await createAppGraph(config, cwd);

    expect(analysis.graph.serverFunctions).toEqual([]);
    expect(analysis.graph.serverReferences).toEqual([]);
    expect(analysis.diagnostics).toContainEqual({
      level: "error",
      file: "src/actions.ts",
      message: expect.stringContaining(
        "Server function module could not be parsed:",
      ),
    });
  });

  it("reports duplicate server function export names during graph analysis", async () => {
    const cwd = await createFixture({
      "src/main.tsx": `
        import "./actions";
      `,
      "src/actions.ts": `
        "use server";

        const saveOrder = async () => {
          return { ok: true };
        };

        export { saveOrder };
        export { saveOrder as saveOrder };
      `,
    });
    const config = createConfig();
    const analysis = await createAppGraph(config, cwd);

    expect(analysis.graph.serverFunctions).toEqual([]);
    expect(analysis.graph.serverReferences).toEqual([]);
    expect(analysis.diagnostics).toContainEqual({
      level: "error",
      file: "src/actions.ts",
      message:
        '"use server" export "saveOrder" is declared more than once. Server function export names must be unique.',
    });
    expect(
      analysis.diagnostics.filter(
        (diagnostic) =>
          diagnostic.file === "src/actions.ts" &&
          diagnostic.message ===
            '"use server" export "saveOrder" is declared more than once. Server function export names must be unique.',
      ),
    ).toHaveLength(1);
  });

  it("reports use-server modules without callable exports during graph analysis", async () => {
    const cwd = await createFixture({
      "src/main.tsx": `
        import "./actions";
      `,
      "src/actions.ts": `
        "use server";

        type SaveOrderInput = {
          id: string;
        };

        export type { SaveOrderInput };
      `,
    });
    const config = createConfig();
    const analysis = await createAppGraph(config, cwd);

    expect(analysis.graph.serverFunctions).toEqual([]);
    expect(analysis.diagnostics).toContainEqual({
      level: "error",
      file: "src/actions.ts",
      message:
        '"use server" modules must export at least one named server function. Add an exported function or remove the directive.',
    });
  });

  it("does not scan unrelated source files outside explicit roots and imports", async () => {
    const cwd = await createFixture({
      "src/main.tsx": "console.log('app');",
      "src/unused.ts": `
        "use server";
        export async function unused() {
          return null;
        }
      `,
    });
    const config = createConfig();
    const analysis = await createAppGraph(config, cwd);

    expect(analysis.graph.serverFunctions).toEqual([]);
    expect(relativeFileDependencies(cwd, analysis.fileDependencies)).toEqual(
      [],
    );
  });

  it("reports reachable use-server modules when server output is disabled", async () => {
    const cwd = await createFixture({
      "src/main.tsx": `
        import { saveOrder } from "./actions";
        void saveOrder;
      `,
      "src/actions.ts": `
        "use server";
        export async function saveOrder() {
          return { ok: true };
        }
      `,
    });
    const config = createConfig({
      serverEnabled: false,
    });
    const analysis = await createAppGraph(config, cwd);

    expect(analysis.graph.serverFunctions).toEqual([]);
    expect(analysis.diagnostics).toEqual([
      {
        level: "error",
        file: "src/actions.ts",
        message:
          'This "use server" module is reachable from the app graph, but server is disabled. Remove the import or enable server in ev.config.ts.',
      },
    ]);
    expect(relativeFileDependencies(cwd, analysis.fileDependencies)).toEqual([
      "src/actions.ts",
    ]);
  });

  it("collects page route declarations", async () => {
    const cwd = await createFixture({
      "src/main.tsx": "console.log('app');",
      "src/pages/Dashboard.tsx": `
        export const render = "ssr";
        export const hydrate = "load";
        export default function Dashboard() { return null; }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      entry: "./src/main.tsx",
      routing: {
        mode: "spa",
        dir: "./src/pages",
        entry: "./src/main.tsx",
        html: "./index.html",
        mount: "#app",
        routes: [
          {
            id: "dashboard",
            path: "/dashboard",
            module: "./src/pages/Dashboard.tsx",
          },
        ],
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });

    expect(analysis.graph.apps.default).toEqual({
      id: "default",
      entry: "./src/main.tsx",
      html: "./index.html",
      mount: "#app",
    });
    expect(analysis.graph.routes).toEqual([
      {
        id: "dashboard",
        path: "/dashboard",
        appId: "default",
        pageId: "dashboard",
        module: "./src/pages/Dashboard.tsx",
        render: "ssr",
        hydrate: "load",
      },
    ]);
    expect(analysis.graph.pages).toEqual({
      dashboard: {
        id: "dashboard",
        routeId: "dashboard",
        component: "./src/pages/Dashboard.tsx",
        html: "./index.html",
        render: "ssr",
        hydrate: "load",
      },
    });
    expect(plan.entries).toEqual(
      expect.arrayContaining([
        {
          name: "main",
          import: "evjs:pages-app",
          environment: "client",
          runtime: "browser",
          kind: "app-client",
          owner: { appId: "default" },
          metadata: {
            type: "pages-app",
            routes: [
              {
                id: "dashboard",
                path: "/dashboard",
                module: "./src/pages/Dashboard.tsx",
              },
            ],
            mount: "#app",
          },
        },
        {
          name: "server",
          import: "@evjs/server/fetch",
          environment: "server",
          runtime: "node",
          kind: "server-runtime",
        },
        {
          name: "dashboard-server",
          import: "./src/pages/Dashboard.tsx",
          environment: "server",
          runtime: "node",
          kind: "page-server",
          owner: { pageId: "dashboard", routeId: "dashboard" },
        },
      ]),
    );
    expect(plan.server.renderers).toEqual([
      {
        name: "dashboard-server",
        import: "./src/pages/Dashboard.tsx",
        kind: "page-server",
        owner: { pageId: "dashboard", routeId: "dashboard" },
      },
    ]);
    expect(plan.html).toEqual([
      {
        id: "index",
        template: "./index.html",
        fileName: "index.html",
        owner: { appId: "default" },
      },
    ]);
    expect(relativeFileDependencies(cwd, analysis.fileDependencies)).toEqual([
      "src/pages",
      "src/pages/Dashboard.tsx",
    ]);
  });

  it("allows explicit apps and configured pages to coexist", async () => {
    const cwd = await createFixture({
      "src/console/main.tsx": "console.log('console');",
      "src/pages/campaign.tsx":
        "export default function Campaign() { return null; }",
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      apps: {
        console: {
          entry: "./src/console/main.tsx",
          html: "./index.html",
        },
      },
      pages: {
        campaign: {
          component: "./src/pages/campaign.tsx",
          html: "./index.html",
        },
      },
    });

    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });

    expect(Object.keys(analysis.graph.apps)).toEqual(["console"]);
    expect(Object.keys(analysis.graph.pages)).toEqual(["campaign"]);
    expect(plan.entries).toEqual(
      expect.arrayContaining([
        {
          name: "console",
          import: "./src/console/main.tsx",
          environment: "client",
          runtime: "browser",
          kind: "app-client",
          owner: { appId: "console" },
        },
        {
          name: "campaign",
          import: "./src/pages/campaign.tsx",
          environment: "client",
          runtime: "browser",
          kind: "page-client",
          owner: { pageId: "campaign" },
          metadata: {
            type: "react-component-page",
            component: "./src/pages/campaign.tsx",
            mount: "#app",
            hydrate: "load",
            render: "csr",
          },
        },
      ]),
    );
    expect(plan.html).toEqual([
      {
        id: "console",
        template: "./index.html",
        fileName: "console.html",
        owner: { appId: "console" },
      },
      {
        id: "campaign",
        template: "./index.html",
        fileName: "campaign.html",
        owner: { pageId: "campaign" },
      },
    ]);
  });

  it("keeps CSR page route modules as route metadata without page build units", async () => {
    const cwd = await createFixture({
      "src/pages/About.tsx": "export default function About() { return null; }",
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      entry: "./src/pages/About.tsx",
      routing: {
        mode: "spa",
        dir: "./src/pages",
        entry: "./src/pages/About.tsx",
        html: "./index.html",
        mount: "#app",
        routes: [
          {
            id: "about",
            path: "/about",
            module: "./src/pages/About.tsx",
          },
        ],
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });

    expect(analysis.graph.pages).toEqual({});
    expect(analysis.graph.routes).toEqual([
      {
        id: "about",
        path: "/about",
        appId: "default",
        module: "./src/pages/About.tsx",
      },
    ]);
    expect(
      plan.entries.filter((entry) => entry.kind === "page-server"),
    ).toEqual([]);
    expect(plan.html).toEqual([
      {
        id: "index",
        template: "./index.html",
        fileName: "index.html",
        owner: { appId: "default" },
      },
    ]);
  });

  it("assigns page routes to the explicit SPA app entry", async () => {
    const cwd = await createFixture({
      "src/console/main.tsx": "console.log('console');",
      "src/admin/main.tsx": "console.log('admin');",
      "src/pages/orders.tsx": `
        export const render = "ssr";
        export default function Orders() { return null; }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      apps: {
        admin: {
          entry: "./src/admin/main.tsx",
          html: "./index.html",
        },
        console: {
          entry: "./src/console/main.tsx",
          html: "./index.html",
        },
      },
      routing: {
        mode: "spa",
        dir: "./src/pages",
        entry: "./src/console/main.tsx",
        html: "./index.html",
        mount: "#app",
        routes: [
          {
            id: "orders",
            path: "/orders",
            module: "./src/pages/orders.tsx",
          },
        ],
      },
    });

    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });

    expect(analysis.graph.apps).toEqual({
      admin: {
        id: "admin",
        entry: "./src/admin/main.tsx",
        html: "./index.html",
      },
      console: {
        id: "console",
        entry: "./src/console/main.tsx",
        html: "./index.html",
      },
    });
    expect(analysis.graph.routes).toEqual([
      {
        id: "orders",
        path: "/orders",
        appId: "console",
        pageId: "orders",
        module: "./src/pages/orders.tsx",
        render: "ssr",
      },
    ]);
    expect(plan.entries).toContainEqual({
      name: "console",
      import: "evjs:pages-app",
      environment: "client",
      runtime: "browser",
      kind: "app-client",
      owner: { appId: "console" },
      metadata: {
        type: "pages-app",
        routes: [
          {
            id: "orders",
            path: "/orders",
            module: "./src/pages/orders.tsx",
          },
        ],
        mount: "#app",
      },
    });
    expect(plan.entries).toContainEqual({
      name: "orders-server",
      import: "./src/pages/orders.tsx",
      environment: "server",
      runtime: "node",
      kind: "page-server",
      owner: { pageId: "orders", routeId: "orders" },
    });
  });

  it("assigns page routes to the top-level SPA entry when routing.entry is omitted", async () => {
    const cwd = await createFixture({
      "src/console/main.tsx": "console.log('console');",
      "src/admin/main.tsx": "console.log('admin');",
      "src/pages/orders.tsx":
        "export default function Orders() { return null; }",
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      entry: "./src/console/main.tsx",
      apps: {
        admin: {
          entry: "./src/admin/main.tsx",
          html: "./index.html",
        },
        console: {
          entry: "./src/console/main.tsx",
          html: "./index.html",
        },
      },
      routing: {
        mode: "spa",
        dir: "./src/pages",
        html: "./index.html",
        mount: "#app",
        routes: [
          {
            id: "orders",
            path: "/orders",
            module: "./src/pages/orders.tsx",
          },
        ],
      },
    });

    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });

    expect(analysis.graph.routes).toEqual([
      {
        id: "orders",
        path: "/orders",
        appId: "console",
        module: "./src/pages/orders.tsx",
      },
    ]);
    expect(plan.entries).toContainEqual({
      name: "console",
      import: "evjs:pages-app",
      environment: "client",
      runtime: "browser",
      kind: "app-client",
      owner: { appId: "console" },
      metadata: {
        type: "pages-app",
        routes: [
          {
            id: "orders",
            path: "/orders",
            module: "./src/pages/orders.tsx",
          },
        ],
        mount: "#app",
      },
    });
    expect(
      plan.entries.find((entry) => entry.owner?.appId === "admin")?.metadata,
    ).toBeUndefined();
  });

  it("treats app source files as plain app entries", async () => {
    const cwd = await createFixture({
      "src/apps/render-lab/app.tsx": `
        export default function RenderLabApp() {
          return null;
        }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      apps: {
        "render-lab": "./src/apps/render-lab/app.tsx",
      },
    });

    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });

    expect(analysis.graph.apps).toEqual({
      "render-lab": {
        id: "render-lab",
        entry: "./src/apps/render-lab/app.tsx",
        html: "./index.html",
      },
    });
    expect(analysis.graph.routes).toEqual([]);
    expect(plan.entries).toContainEqual({
      name: "render-lab",
      import: "./src/apps/render-lab/app.tsx",
      environment: "client",
      runtime: "browser",
      kind: "app-client",
      owner: { appId: "render-lab" },
    });
    expect(plan.html).toContainEqual({
      id: "render-lab",
      template: "./index.html",
      fileName: "render-lab.html",
      owner: { appId: "render-lab" },
    });
  });

  it("creates stable route-derived page ids from page route paths", async () => {
    const cwd = await createFixture({
      "src/pages/index.tsx": `
        export const render = "ssg";
        export default function Home() { return null; }
      `,
      "src/pages/orders/$orderId.tsx": `
        export const render = "ssr";
        export default function Order() { return null; }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      entry: "./src/pages/index.tsx",
      routing: {
        mode: "spa",
        dir: "./src/pages",
        entry: "./src/pages/index.tsx",
        html: "./index.html",
        mount: "#app",
        routes: [
          {
            id: "index",
            path: "/",
            module: "./src/pages/index.tsx",
          },
          {
            id: "orders_orderId",
            path: "/orders/$orderId",
            module: "./src/pages/orders/$orderId.tsx",
          },
        ],
      },
    });

    const analysis = await createAppGraph(config, cwd);

    expect(Object.keys(analysis.graph.pages)).toEqual([
      "index",
      "orders_orderId",
    ]);
    expect(analysis.graph.pages.index.routeId).toBe("index");
    expect(analysis.graph.pages.orders_orderId.routeId).toBe("orders_orderId");
    expect(analysis.graph.routes).toEqual([
      {
        id: "index",
        path: "/",
        appId: "default",
        pageId: "index",
        module: "./src/pages/index.tsx",
        render: "ssg",
      },
      {
        id: "orders_orderId",
        path: "/orders/$orderId",
        appId: "default",
        pageId: "orders_orderId",
        module: "./src/pages/orders/$orderId.tsx",
        render: "ssr",
      },
    ]);
  });

  it("derives page ids from path-shaped dynamic route ids", async () => {
    const cwd = await createFixture({
      "src/pages/orders/$orderId.tsx": `
        export const render = "ssr";
        export default function Order() { return null; }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      entry: "./src/pages/orders/$orderId.tsx",
      routing: {
        mode: "spa",
        dir: "./src/pages",
        entry: "./src/pages/orders/$orderId.tsx",
        html: "./index.html",
        mount: "#app",
        routes: [
          {
            id: "/orders/$orderId",
            path: "/orders/$orderId",
            module: "./src/pages/orders/$orderId.tsx",
          },
        ],
      },
    });

    const analysis = await createAppGraph(config, cwd);

    expect(Object.keys(analysis.graph.pages)).toEqual(["orders_orderId"]);
    expect(analysis.graph.pages.orders_orderId.routeId).toBe(
      "/orders/$orderId",
    );
    expect(analysis.graph.routes).toEqual([
      {
        id: "/orders/$orderId",
        path: "/orders/$orderId",
        appId: "default",
        pageId: "orders_orderId",
        module: "./src/pages/orders/$orderId.tsx",
        render: "ssr",
      },
    ]);
  });

  it("keeps route-derived SSG pages on the SPA framework route", async () => {
    const cwd = await createFixture({
      "src/pages/index.tsx": "export default function Home() { return null; }",
      "src/pages/pricing.tsx": `
        export const render = "ssg";
        export default function Pricing() { return null; }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      entry: "./src/pages/index.tsx",
      routing: {
        mode: "spa",
        dir: "./src/pages",
        entry: "./src/pages/index.tsx",
        html: "./index.html",
        mount: "#app",
        routes: [
          {
            id: "index",
            path: "/",
            module: "./src/pages/index.tsx",
          },
          {
            id: "pricing",
            path: "/pricing",
            module: "./src/pages/pricing.tsx",
          },
        ],
      },
    });

    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "production",
    });

    expect(analysis.graph.pages.pricing).toMatchObject({
      id: "pricing",
      routeId: "pricing",
      component: "./src/pages/pricing.tsx",
      render: "ssg",
    });
    expect(plan.entries).toContainEqual({
      name: "pricing-server",
      import: "./src/pages/pricing.tsx",
      environment: "server",
      runtime: "node",
      kind: "page-server",
      owner: { pageId: "pricing", routeId: "pricing" },
    });
    expect(
      plan.entries.filter(
        (entry) => entry.kind === "page-client" && entry.owner?.pageId,
      ),
    ).toEqual([]);
    expect(plan.html).toEqual([
      {
        id: "index",
        template: "./index.html",
        fileName: "index.html",
        owner: { appId: "default" },
      },
    ]);
  });

  it("reports route-derived page id collisions", async () => {
    const cwd = await createFixture({
      "src/pages/admin/panel.tsx": `
        export const render = "ssr";
        export default function AdminPanel() { return null; }
      `,
      "src/pages/admin_panel.tsx": `
        export const render = "ssr";
        export default function AdminPanelFlat() { return null; }
      `,
      "index.html": '<div id="app"></div>',
    });
    const config = createConfig({
      entry: "./src/pages/admin/panel.tsx",
      routing: {
        mode: "spa",
        dir: "./src/pages",
        entry: "./src/pages/admin/panel.tsx",
        html: "./index.html",
        mount: "#app",
        routes: [
          {
            id: "/admin/panel",
            path: "/admin/panel",
            module: "./src/pages/admin/panel.tsx",
          },
          {
            id: "/admin_panel",
            path: "/admin_panel",
            module: "./src/pages/admin_panel.tsx",
          },
        ],
      },
    });

    const analysis = await createAppGraph(config, cwd);

    expect(analysis.diagnostics).toEqual([
      {
        level: "error",
        message:
          'Route-derived page id "admin_panel" for route path "/admin_panel" conflicts with existing page "admin_panel". Add an explicit route id or rename one route so generated page ids are unique.',
      },
    ]);
    expect(Object.keys(analysis.graph.pages)).toEqual(["admin_panel"]);
    expect(analysis.graph.routes).toEqual([
      {
        id: "/admin/panel",
        path: "/admin/panel",
        appId: "default",
        pageId: "admin_panel",
        module: "./src/pages/admin/panel.tsx",
        render: "ssr",
      },
      {
        id: "/admin_panel",
        path: "/admin_panel",
        appId: "default",
        module: "./src/pages/admin_panel.tsx",
        render: "ssr",
      },
    ]);
  });
});

async function createFixture(files: Record<string, string>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "evjs-graph-plan-"));
  tempDirs.push(dir);

  for (const [file, content] of Object.entries(files)) {
    const absolute = path.join(dir, file);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content);
  }

  return dir;
}

type TestConfig = BuildPlanConfig & Pick<GraphConfig, "apps">;

function createConfig(overrides: Partial<TestConfig> = {}): TestConfig {
  return {
    entry: "./src/main.tsx",
    html: "./index.html",
    pages: undefined,
    serverEnabled: true,
    server: {
      entry: undefined,
      basePath: "/__evjs",
      functionRuntime: {
        endpoint: "/__evjs/fn",
        clientProxy: "@evjs/client/internal",
        serverRegister: "@evjs/server/register",
      },
    },
    ...overrides,
  };
}
