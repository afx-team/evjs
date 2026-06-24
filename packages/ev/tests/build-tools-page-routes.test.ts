import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { discoverPageRoutes } from "../src/build-tools/index.js";
import {
  findInvalidRouteSegment,
  findPageRouteSegmentConventionViolation,
  formatPageRouteSegmentConventionViolation,
  isHiddenPageRouteSegment,
  isIgnoredPageRouteSegment,
  isPageRouteSourceModuleFile,
  normalizePageRouteConventionPath,
  PAGE_ROUTE_CONVENTION_DOCS_URL,
  PAGE_ROUTE_CONVENTION_RULES,
  PAGE_ROUTE_CONVENTION_SUMMARY,
  PAGE_ROUTE_SOURCE_EXTENSIONS,
  parsePageRouteFile,
  routePathFromSegments,
  routePathShapeFromPath,
  routeShapeFromSegments,
} from "../src/build-tools/page-route-conventions.js";

const tempDirs: string[] = [];
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("discoverPageRoutes", () => {
  it("centralizes the page route filename convention", () => {
    expect(PAGE_ROUTE_SOURCE_EXTENSIONS).toEqual([
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
    ]);
    expect(PAGE_ROUTE_CONVENTION_DOCS_URL).toBe(
      "https://evaijs.github.io/evjs/docs/project-structure#convention-matrix",
    );
    expect(PAGE_ROUTE_CONVENTION_RULES.map((rule) => rule.id)).toEqual([
      "directory-index",
      "dynamic-segment",
      "unique-path",
      "unique-dynamic-shape",
      "unique-route-id",
      "route-group",
      "static-segment",
      "private-module",
      "hidden-module",
      "declaration-module",
      "test-module",
      "story-module",
      "client-module",
      "server-module",
      "root-layout",
    ]);
    expect(PAGE_ROUTE_CONVENTION_RULES.map((rule) => rule.category)).toEqual([
      "route",
      "route",
      "route",
      "route",
      "route",
      "route",
      "route",
      "ignored",
      "ignored",
      "ignored",
      "ignored",
      "ignored",
      "ignored",
      "ignored",
      "layout",
    ]);
    expect(PAGE_ROUTE_CONVENTION_RULES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "dynamic-segment",
          category: "route",
          valid: expect.arrayContaining(["users/$userId.tsx"]),
          invalid: expect.arrayContaining([
            "users/[userId].tsx",
            "files/$...path.tsx",
            "users/$__proto__.tsx",
            "docs/$_splat.tsx",
          ]),
        }),
        expect.objectContaining({
          id: "unique-path",
          category: "route",
          invalid: expect.arrayContaining([
            "users.tsx plus users/index.tsx for /users",
          ]),
        }),
        expect.objectContaining({
          id: "unique-dynamic-shape",
          category: "route",
          invalid: expect.arrayContaining([
            "users/$id.tsx plus users/$userId.tsx",
          ]),
        }),
        expect.objectContaining({
          id: "unique-route-id",
          category: "route",
          invalid: expect.arrayContaining([
            "admin/panel.tsx plus admin_panel.tsx",
          ]),
        }),
        expect.objectContaining({
          id: "route-group",
          category: "route",
          valid: expect.arrayContaining(["(marketing)/about.tsx"]),
        }),
        expect.objectContaining({
          id: "client-module",
          category: "ignored",
          valid: expect.arrayContaining(["ClientCard.client.tsx"]),
        }),
        expect.objectContaining({
          id: "hidden-module",
          category: "ignored",
          valid: expect.arrayContaining([".hidden/secret.tsx"]),
        }),
        expect.objectContaining({
          id: "declaration-module",
          category: "ignored",
          valid: expect.arrayContaining(["route-types.d.ts"]),
        }),
        expect.objectContaining({
          id: "test-module",
          category: "ignored",
          valid: expect.arrayContaining(["about.test.tsx"]),
        }),
        expect.objectContaining({
          id: "story-module",
          category: "ignored",
          valid: expect.arrayContaining(["profile.stories.tsx"]),
        }),
        expect.objectContaining({
          id: "server-module",
          category: "ignored",
          valid: expect.arrayContaining(["users.server.ts"]),
        }),
        expect.objectContaining({
          id: "root-layout",
          category: "layout",
          valid: expect.arrayContaining([
            "src/layout.tsx",
            "src/layout/index.tsx",
            "src/pages/layout.tsx",
          ]),
        }),
      ]),
    );
    expect(PAGE_ROUTE_CONVENTION_SUMMARY).toBe(
      "Page route files use index files for directory roots, $param filenames for dynamic segments, one page file per URL path, one dynamic param name per URL shape, unique generated route ids, route groups for pathless organization, and lowercase URL-safe static segments; ignored colocated modules include _-prefixed private modules, dot-prefixed hidden modules, declaration files, test/spec modules, Storybook modules, client-only *.client.* modules, and server-only *.server.* modules; SPA layout auto-discovery supports layout source modules beside the route directory",
    );
    expect(isPageRouteSourceModuleFile("index.tsx")).toBe(true);
    expect(isPageRouteSourceModuleFile("index.d.ts")).toBe(false);
    expect(isPageRouteSourceModuleFile("ClientCard.client.tsx")).toBe(false);
    expect(isPageRouteSourceModuleFile("menu.client.js")).toBe(false);
    expect(isPageRouteSourceModuleFile("users.server.ts")).toBe(false);
    expect(isPageRouteSourceModuleFile("users.server.tsx")).toBe(false);
    expect(isPageRouteSourceModuleFile("about.test.tsx")).toBe(false);
    expect(isPageRouteSourceModuleFile("about.spec.tsx")).toBe(false);
    expect(isPageRouteSourceModuleFile("about.story.tsx")).toBe(false);
    expect(isPageRouteSourceModuleFile("about.stories.tsx")).toBe(false);

    expect(parsePageRouteFile("index.tsx")?.segments).toEqual([]);
    expect(parsePageRouteFile("users/$userId.tsx")?.segments).toEqual([
      "users",
      "$userId",
    ]);
    expect(normalizePageRouteConventionPath("users\\$userId.tsx")).toBe(
      "users/$userId.tsx",
    );
    expect(parsePageRouteFile("users\\$userId.tsx")?.segments).toEqual([
      "users",
      "$userId",
    ]);
    expect(parsePageRouteFile("index.d.ts")).toBeUndefined();
    expect(parsePageRouteFile("ClientCard.client.tsx")).toBeUndefined();
    expect(parsePageRouteFile("users.server.ts")).toBeUndefined();
    expect(parsePageRouteFile("about.test.tsx")).toBeUndefined();
    expect(parsePageRouteFile("about.spec.tsx")).toBeUndefined();
    expect(parsePageRouteFile("about.story.tsx")).toBeUndefined();
    expect(parsePageRouteFile("about.stories.tsx")).toBeUndefined();
    expect(parsePageRouteFile("_helpers/format.ts")).toBeUndefined();
    expect(parsePageRouteFile(".draft.tsx")).toBeUndefined();
    expect(parsePageRouteFile(".hidden/secret.tsx")).toBeUndefined();
    expect(isIgnoredPageRouteSegment("_helpers")).toBe(true);
    expect(isIgnoredPageRouteSegment(".draft")).toBe(true);
    expect(isIgnoredPageRouteSegment("users")).toBe(false);
    expect(isHiddenPageRouteSegment(".draft")).toBe(true);
    expect(isHiddenPageRouteSegment("_helpers")).toBe(false);

    expect(routePathFromSegments([])).toBe("/");
    expect(routePathFromSegments(["users", "$userId"])).toBe("/users/$userId");
    expect(routePathFromSegments(["(marketing)", "about"])).toBe("/about");
    expect(routeShapeFromSegments(["users", "$userId"])).toEqual({
      key: "/users/:param",
      label: "/users/:param",
    });
    expect(routePathShapeFromPath("/users/:userId")).toEqual({
      key: "/users/:param",
      label: "/users/:param",
    });
    expect(findInvalidRouteSegment(["Users"])).toEqual({
      kind: "static",
      segment: "Users",
    });
    expect(
      findPageRouteSegmentConventionViolation(["(marketing)", "about"]),
    ).toBeUndefined();
    expect(
      findPageRouteSegmentConventionViolation(["(marketing", "about"]),
    ).toEqual({
      kind: "route-group",
      segment: "(marketing",
    });
    expect(
      formatPageRouteSegmentConventionViolation({
        kind: "route-group",
        segment: "(marketing",
      }),
    ).toBe(
      'Page route group segment "(marketing" must wrap a non-empty group name in parentheses, such as "(marketing)".',
    );
    expect(findPageRouteSegmentConventionViolation(["users", "[id]"])).toEqual({
      kind: "bracket",
      segment: "[id]",
    });
    expect(findPageRouteSegmentConventionViolation(["users", "[id"])).toEqual({
      kind: "bracket",
      segment: "[id",
    });
    expect(
      formatPageRouteSegmentConventionViolation({
        kind: "bracket",
        segment: "[id]",
      }),
    ).toBe(
      'Dynamic page route segments must use $param filenames. Bracket segment "[id]" is not supported. Rename the file to "$id" for a dynamic segment, or use explicit pages config for a custom URL.',
    );
    expect(
      findPageRouteSegmentConventionViolation(["files", "$...path"]),
    ).toEqual({
      kind: "unsupported-dynamic",
      segment: "$...path",
    });
    expect(
      formatPageRouteSegmentConventionViolation({
        kind: "unsupported-dynamic",
        segment: "$...path",
      }),
    ).toBe(
      'Catch-all page route segments are not supported. Use explicit pages config for wildcard or custom URL shapes instead of "$...path".',
    );
    expect(findPageRouteSegmentConventionViolation(["Users"])).toEqual({
      kind: "static",
      segment: "Users",
    });
    expect(
      formatPageRouteSegmentConventionViolation({
        kind: "static",
        segment: "Users",
      }),
    ).toBe(
      'Static page route segment "Users" must use lowercase URL-safe characters: lowercase letters, numbers, ".", "_", "-", or "~". Rename the file to a lowercase URL-safe segment, or use explicit pages config for custom paths.',
    );
    expect(findInvalidRouteSegment(["$__proto__"])).toEqual({
      kind: "reserved-dynamic",
      segment: "$__proto__",
    });
    expect(findInvalidRouteSegment(["$_splat"])).toEqual({
      kind: "reserved-dynamic",
      segment: "$_splat",
    });
    expect(
      findInvalidRouteSegment(["teams", "$teamId", "users", "$teamId"]),
    ).toEqual({
      kind: "duplicate-dynamic",
      segment: "$teamId",
    });
  });

  it("discovers SPA page routes from src/pages", async () => {
    const cwd = await createFixture({
      "src/layout/index.tsx": "export default function Root() { return null; }",
      "src/pages/index.tsx": "export default function Home() { return null; }",
      "src/pages/about.tsx": "export default function About() { return null; }",
      "src/pages/users/$userId.tsx":
        "export default function User() { return null; }",
      "src/pages/posts/$postId.tsx":
        "export default function Post() { return null; }",
      "src/pages/_private.tsx":
        "export default function Private() { return null; }",
      "src/pages/_internal/index.tsx":
        "export default function Internal() { return null; }",
      "src/pages/posts/_draft.tsx":
        "export default function DraftPost() { return null; }",
      "src/pages/posts/_components/Card.tsx":
        "export default function PostCard() { return null; }",
      "src/pages/about.test.tsx":
        "export default function Test() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, { dir: "./src/pages" });

    expect(discovery.rootModule).toBe("./src/layout/index.tsx");
    expect(discovery.routes).toEqual([
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
      {
        id: "posts_postId",
        path: "/posts/$postId",
        module: "./src/pages/posts/$postId.tsx",
      },
      {
        id: "users_userId",
        path: "/users/$userId",
        module: "./src/pages/users/$userId.tsx",
      },
    ]);
    expect(discovery.diagnostics).toEqual([]);
  });

  it("discovers supported page route source extensions", async () => {
    const cwd = await createFixture({
      "src/pages/index.ts": "export default function Home() { return null; }",
      "src/pages/about.jsx": "export default function About() { return null; }",
      "src/pages/admin.tsx": "export default function Admin() { return null; }",
      "src/pages/legacy.js":
        "export default function Legacy() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, { dir: "./src/pages" });

    expect(discovery.routes).toEqual([
      {
        id: "index",
        path: "/",
        module: "./src/pages/index.ts",
      },
      {
        id: "about",
        path: "/about",
        module: "./src/pages/about.jsx",
      },
      {
        id: "admin",
        path: "/admin",
        module: "./src/pages/admin.tsx",
      },
      {
        id: "legacy",
        path: "/legacy",
        module: "./src/pages/legacy.js",
      },
    ]);
    expect(discovery.diagnostics).toEqual([]);
  });

  it("documents route filename convention examples", async () => {
    const englishDoc = await fs.readFile(
      path.join(repoRoot, "docs/docs/project-structure.md"),
      "utf-8",
    );
    const chineseDoc = await fs.readFile(
      path.join(
        repoRoot,
        "docs/i18n/zh-Hans/docusaurus-plugin-content-docs/current/project-structure.md",
      ),
      "utf-8",
    );
    const englishClientRoutesDoc = await fs.readFile(
      path.join(repoRoot, "docs/docs/client-routes.md"),
      "utf-8",
    );
    const chineseClientRoutesDoc = await fs.readFile(
      path.join(
        repoRoot,
        "docs/i18n/zh-Hans/docusaurus-plugin-content-docs/current/client-routes.md",
      ),
      "utf-8",
    );

    for (const doc of [englishDoc, chineseDoc]) {
      expect(doc).toContain("src/pages/users/$userId.tsx");
      expect(doc).toContain("src/pages/users/[id].tsx");
      expect(doc).toContain("src/pages/files/$...path.tsx");
      expect(doc).toContain("src/pages/users/$__proto__.tsx");
      expect(doc).toContain("src/pages/users.tsx");
      expect(doc).toContain("src/pages/users/index.tsx");
      expect(doc).toContain("src/pages/layout.tsx");
      expect(doc).toContain("src/pages/.draft.tsx");
      expect(doc).toContain("src/pages/ClientCard.client.tsx");
      expect(doc).toContain("src/pages/users.server.ts");
      expect(doc).toContain("src/pages/admin_panel.tsx");
      expect(doc).toContain("src/pages/admin/panel.tsx");
      expect(doc).toContain("src/pages/profile.stories.tsx");
      expect(doc).toContain("src/pages/**/_*");
      expect(doc).toContain("src/pages/**/.*");
      expect(doc).toContain("src/pages/**/*.{client,server}.*");
      expect(doc).toContain("admin_panel");
      expect(doc).toContain("<routing-dir-parent>/route-types.d.ts");
      expect(doc).toContain("src/app/route-types.d.ts");
      expect(doc).not.toContain("Direct `routing.routes`");
      expect(doc).not.toContain("直接传入的 `routing.routes`");
    }
    expect(englishDoc).toContain("one page module per URL path");
    expect(englishDoc).toContain(
      "one parameter naming choice per dynamic URL shape",
    );
    expect(englishDoc).toContain("unique generated route IDs");
    expect(chineseDoc).toContain("每个 URL path 只保留一个页面模块");
    expect(chineseDoc).toContain("每个 dynamic URL shape 只保留一种参数命名");
    expect(chineseDoc).toContain("生成的 route ID 必须唯一");
    expect(englishClientRoutesDoc).toContain(
      "`routing.routes` is not a public",
    );
    expect(englishClientRoutesDoc).toContain(
      "when `routing.layout` points at an explicit module",
    );
    expect(chineseClientRoutesDoc).toContain("`routing.routes` 不是公开的");
    expect(chineseClientRoutesDoc).toContain(
      "即使 `routing.layout` 显式指向其他模块",
    );
  });

  it("orders static route siblings before dynamic route siblings", async () => {
    const cwd = await createFixture({
      "src/pages/index.tsx": "export default function Home() { return null; }",
      "src/pages/users/$id.tsx":
        "export default function User() { return null; }",
      "src/pages/users/$id/details.tsx":
        "export default function UserDetails() { return null; }",
      "src/pages/users/index.tsx":
        "export default function Users() { return null; }",
      "src/pages/users/settings.tsx":
        "export default function UserSettings() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, { dir: "./src/pages" });

    expect(discovery.routes.map((route) => route.path)).toEqual([
      "/",
      "/users",
      "/users/settings",
      "/users/$id",
      "/users/$id/details",
    ]);
    expect(discovery.diagnostics).toEqual([]);
  });

  it("orders URL-safe static route siblings without locale-sensitive collation", async () => {
    const cwd = await createFixture({
      "src/pages/index.tsx": "export default function Home() { return null; }",
      "src/pages/a_c.tsx":
        "export default function AUnderscore() { return null; }",
      "src/pages/a-b.tsx": "export default function ADash() { return null; }",
      "src/pages/a.b.tsx": "export default function ADot() { return null; }",
      "src/pages/a0.tsx": "export default function AZero() { return null; }",
      "src/pages/aa.tsx": "export default function ALetter() { return null; }",
      "src/pages/a~d.tsx": "export default function ATilde() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, { dir: "./src/pages" });

    expect(discovery.routes.map((route) => route.path)).toEqual([
      "/",
      "/a-b",
      "/a.b",
      "/a0",
      "/a_c",
      "/aa",
      "/a~d",
    ]);
    expect(discovery.diagnostics).toEqual([]);
  });

  it("ignores declarations, tests, hidden files, client/server modules, and private route segments", async () => {
    const cwd = await createFixture({
      "src/pages/index.tsx": "export default function Home() { return null; }",
      "src/pages/route-types.d.ts": "export {};",
      "src/pages/about.test.tsx":
        "export default function AboutTest() { return null; }",
      "src/pages/about.spec.tsx":
        "export default function AboutSpec() { return null; }",
      "src/pages/profile.story.tsx":
        "export default function ProfileStory() { return null; }",
      "src/pages/profile.stories.tsx":
        "export default function ProfileStories() { return null; }",
      "src/pages/ClientCard.client.tsx":
        '"use client";\nexport default function ClientCard() { return null; }',
      "src/pages/menu.client.js":
        '"use client";\nexport function Menu() { return null; }',
      "src/pages/users.server.ts":
        '"use server";\nexport async function getUser() { return null; }',
      "src/pages/actions.server.tsx":
        '"use server";\nexport async function saveAction() { return null; }',
      "src/pages/.draft.tsx":
        "export default function DotDraft() { return null; }",
      "src/pages/.hidden/secret.tsx":
        "export default function DotSecret() { return null; }",
      "src/pages/_draft.tsx":
        "export default function PrivateDraft() { return null; }",
      "src/pages/_helpers/format.ts": "export const format = () => null;",
      "src/pages/notes.md": "# notes",
    });

    const discovery = await discoverPageRoutes(cwd, { dir: "./src/pages" });

    expect(discovery.routes).toEqual([
      {
        id: "index",
        path: "/",
        module: "./src/pages/index.tsx",
      },
    ]);
    expect(discovery.diagnostics).toEqual([]);
  });

  it("discovers the root layout beside a custom page route directory", async () => {
    const cwd = await createFixture({
      "src/layout/index.tsx": "export const NotTheAppLayout = true;",
      "src/app/layout/index.tsx":
        "export default function AppLayout() { return null; }",
      "src/app/pages/index.tsx":
        "export default function Home() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, {
      dir: "./src/app/pages",
    });

    expect(discovery.rootModule).toBe("./src/app/layout/index.tsx");
    expect(discovery.routes).toEqual([
      {
        id: "index",
        path: "/",
        module: "./src/app/pages/index.tsx",
      },
    ]);
    expect(discovery.diagnostics).toEqual([]);
  });

  it("uses an explicit root layout module without checking convention aliases", async () => {
    const cwd = await createFixture({
      "src/layout.tsx": "export function LayoutAlias() { return null; }",
      "src/shell/AppLayout.tsx":
        "export default function AppLayout() { return null; }",
      "src/pages/index.tsx": "export default function Home() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, {
      dir: "./src/pages",
      rootLayout: "./src/shell/AppLayout.tsx",
    });

    expect(discovery.rootModule).toBe("./src/shell/AppLayout.tsx");
    expect(discovery.routes).toEqual([
      {
        id: "index",
        path: "/",
        module: "./src/pages/index.tsx",
      },
    ]);
    expect(discovery.diagnostics).toEqual([]);
  });

  it("reports missing explicit root layout modules", async () => {
    const cwd = await createFixture({
      "src/pages/index.tsx": "export default function Home() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, {
      dir: "./src/pages",
      rootLayout: "./src/shell/AppLayout.tsx",
    });

    expect(discovery.rootModule).toBeUndefined();
    expect(discovery.routes).toEqual([
      {
        id: "index",
        path: "/",
        module: "./src/pages/index.tsx",
      },
    ]);
    expect(discovery.diagnostics).toEqual([
      {
        level: "error",
        file: "src/shell/AppLayout.tsx",
        message: "Root layout module not found: ./src/shell/AppLayout.tsx.",
      },
    ]);
  });

  it("reports explicit root layout directories", async () => {
    const cwd = await createFixture({
      "src/shell/index.tsx":
        "export default function ShellIndex() { return null; }",
      "src/pages/index.tsx": "export default function Home() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, {
      dir: "./src/pages",
      rootLayout: "./src/shell",
    });

    expect(discovery.rootModule).toBeUndefined();
    expect(discovery.routes).toEqual([
      {
        id: "index",
        path: "/",
        module: "./src/pages/index.tsx",
      },
    ]);
    expect(discovery.diagnostics).toEqual([
      {
        level: "error",
        file: "src/shell",
        message: "Root layout module must be a file: ./src/shell.",
      },
    ]);
  });

  it("reports explicit root layout files with unsupported extensions", async () => {
    const cwd = await createFixture({
      "src/shell/Layout.md": "# layout",
      "src/shell/AppLayout.client.tsx":
        "export default function ClientLayout() { return null; }",
      "src/shell/AppLayout.server.tsx":
        "export default function ServerLayout() { return null; }",
      "src/pages/index.tsx": "export default function Home() { return null; }",
    });

    for (const rootLayout of [
      "./src/shell/Layout.md",
      "./src/shell/AppLayout.client.tsx",
      "./src/shell/AppLayout.server.tsx",
    ]) {
      const discovery = await discoverPageRoutes(cwd, {
        dir: "./src/pages",
        rootLayout,
      });

      expect(discovery.rootModule).toBeUndefined();
      expect(discovery.routes).toEqual([
        {
          id: "index",
          path: "/",
          module: "./src/pages/index.tsx",
        },
      ]);
      expect(discovery.diagnostics).toEqual([
        {
          level: "error",
          file: rootLayout.replace(/^\.\//, ""),
          message: `Root layout module must be a source module using .ts, .tsx, .js, or .jsx; declaration, test, spec, story, client-only, and server-only files are not supported. ${rootLayout} is not supported.`,
        },
      ]);
    }
  });

  it("ignores missing optional page route directories", async () => {
    const cwd = await createFixture({});

    const discovery = await discoverPageRoutes(cwd, { dir: "./src/pages" });

    expect(discovery.rootModule).toBeUndefined();
    expect(discovery.files).toEqual([]);
    expect(discovery.routes).toEqual([]);
    expect(discovery.diagnostics).toEqual([]);
  });

  it("reports missing required page route directories", async () => {
    const cwd = await createFixture({});

    const discovery = await discoverPageRoutes(cwd, {
      dir: "./src/pages",
      required: true,
    });

    expect(discovery.rootModule).toBeUndefined();
    expect(discovery.files).toEqual([]);
    expect(discovery.routes).toEqual([]);
    expect(discovery.diagnostics).toEqual([
      {
        level: "error",
        file: "src/pages",
        message: "Page route directory not found: ./src/pages.",
      },
    ]);
  });

  it("reports required page route directories that are files", async () => {
    const cwd = await createFixture({
      "src/pages": "not a directory",
    });

    const discovery = await discoverPageRoutes(cwd, {
      dir: "./src/pages",
      required: true,
    });

    expect(discovery.rootModule).toBeUndefined();
    expect(discovery.files).toEqual([]);
    expect(discovery.routes).toEqual([]);
    expect(discovery.diagnostics).toEqual([
      {
        level: "error",
        file: "src/pages",
        message: "Page route directory must be a directory: ./src/pages.",
      },
    ]);
  });

  it("does not validate root layout aliases when there are no route candidates", async () => {
    const cwd = await createFixture({
      "src/layout.tsx": "export default function Layout() { return null; }",
      "src/pages/_helpers/format.ts": "export const format = () => null;",
    });

    const discovery = await discoverPageRoutes(cwd, { dir: "./src/pages" });

    expect(discovery.rootModule).toBeUndefined();
    expect(discovery.routes).toEqual([]);
    expect(discovery.diagnostics).toEqual([]);
  });

  it("rejects bracket dynamic route segments", async () => {
    const cwd = await createFixture({
      "src/pages/index.tsx": "export default function Home() { return null; }",
      "src/pages/posts/[postId].tsx":
        "export default function Post() { return null; }",
      "src/pages/files/[...path].tsx":
        "export default function FilePath() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, { dir: "./src/pages" });

    expect(discovery.routes).toEqual([
      {
        id: "index",
        path: "/",
        module: "./src/pages/index.tsx",
      },
    ]);
    expect(discovery.diagnostics).toEqual([
      {
        level: "error",
        file: "src/pages/files/[...path].tsx",
        message:
          'Dynamic page route segments must use $param filenames. Bracket segment "[...path]" is not supported. Use explicit pages config for catch-all or custom URL shapes.',
      },
      {
        level: "error",
        file: "src/pages/posts/[postId].tsx",
        message:
          'Dynamic page route segments must use $param filenames. Bracket segment "[postId]" is not supported. Rename the file to "$postId" for a dynamic segment, or use explicit pages config for a custom URL.',
      },
    ]);
  });

  it("discovers route group segments without adding URL segments", async () => {
    const cwd = await createFixture({
      "src/pages/index.tsx": "export default function Home() { return null; }",
      "src/pages/(marketing)/about.tsx":
        "export default function MarketingAbout() { return null; }",
      "src/pages/shop/(checkout)/cart.tsx":
        "export default function CheckoutCart() { return null; }",
      "src/pages/(broken/about.tsx":
        "export default function BrokenAbout() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, { dir: "./src/pages" });

    expect(discovery.routes).toEqual([
      {
        id: "index",
        path: "/",
        module: "./src/pages/index.tsx",
      },
      {
        id: "about",
        path: "/about",
        module: "./src/pages/(marketing)/about.tsx",
      },
      {
        id: "shop_cart",
        path: "/shop/cart",
        module: "./src/pages/shop/(checkout)/cart.tsx",
      },
    ]);
    expect(discovery.diagnostics).toEqual([
      {
        level: "error",
        file: "src/pages/(broken/about.tsx",
        message:
          'Page route group segment "(broken" must wrap a non-empty group name in parentheses, such as "(marketing)".',
      },
    ]);
  });

  it("rejects unsupported dynamic route segment syntax", async () => {
    const cwd = await createFixture({
      "src/pages/index.tsx": "export default function Home() { return null; }",
      "src/pages/files/$.tsx":
        "export default function EmptyDynamic() { return null; }",
      "src/pages/files/$...path.tsx":
        "export default function CatchAll() { return null; }",
      "src/pages/users/$id?.tsx":
        "export default function OptionalUser() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, { dir: "./src/pages" });

    expect(discovery.routes).toEqual([
      {
        id: "index",
        path: "/",
        module: "./src/pages/index.tsx",
      },
    ]);
    expect(discovery.diagnostics).toEqual([
      {
        level: "error",
        file: "src/pages/files/$...path.tsx",
        message:
          'Catch-all page route segments are not supported. Use explicit pages config for wildcard or custom URL shapes instead of "$...path".',
      },
      {
        level: "error",
        file: "src/pages/files/$.tsx",
        message:
          'Dynamic page route segments must include a name after "$". Segment "$" is not supported.',
      },
      {
        level: "error",
        file: "src/pages/users/$id?.tsx",
        message:
          'Optional page route segments are not supported. Split the route into explicit files or use explicit pages config instead of "$id?".',
      },
    ]);
  });

  it("rejects uppercase static route segments", async () => {
    const cwd = await createFixture({
      "src/pages/index.tsx": "export default function Home() { return null; }",
      "src/pages/About.tsx": "export default function About() { return null; }",
      "src/pages/docs/API.tsx":
        "export default function ApiDocs() { return null; }",
      "src/pages/users/$userId.tsx":
        "export default function User() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, { dir: "./src/pages" });

    expect(discovery.routes).toEqual([
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
    ]);
    expect(discovery.diagnostics).toEqual([
      {
        level: "error",
        file: "src/pages/About.tsx",
        message:
          'Static page route segment "About" must use lowercase URL-safe characters: lowercase letters, numbers, ".", "_", "-", or "~". Rename the file to a lowercase URL-safe segment, or use explicit pages config for custom paths.',
      },
      {
        level: "error",
        file: "src/pages/docs/API.tsx",
        message:
          'Static page route segment "API" must use lowercase URL-safe characters: lowercase letters, numbers, ".", "_", "-", or "~". Rename the file to a lowercase URL-safe segment, or use explicit pages config for custom paths.',
      },
    ]);
  });

  it("rejects unsafe route segments and invalid dynamic parameter names", async () => {
    const cwd = await createFixture({
      "src/pages/index.tsx": "export default function Home() { return null; }",
      "src/pages/contact us.tsx":
        "export default function ContactUs() { return null; }",
      "src/pages/orders/$order-id.tsx":
        "export default function Order() { return null; }",
      "src/pages/session/$__proto__.tsx":
        "export default function Session() { return null; }",
      "src/pages/settings?.tsx":
        "export default function Settings() { return null; }",
      "src/pages/docs/$_splat.tsx":
        "export default function DocsSplat() { return null; }",
      "src/pages/teams/$teamId/users/$teamId.tsx":
        "export default function DuplicateTeamParam() { return null; }",
      "src/pages/team/$constructor.tsx":
        "export default function Team() { return null; }",
      "src/pages/users/$123.tsx":
        "export default function User() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, { dir: "./src/pages" });

    expect(discovery.routes).toEqual([
      {
        id: "index",
        path: "/",
        module: "./src/pages/index.tsx",
      },
    ]);
    expect(discovery.diagnostics).toEqual([
      {
        level: "error",
        file: "src/pages/contact us.tsx",
        message:
          'Static page route segment "contact us" must use lowercase URL-safe characters: lowercase letters, numbers, ".", "_", "-", or "~". Rename the file to a lowercase URL-safe segment, or use explicit pages config for custom paths.',
      },
      {
        level: "error",
        file: "src/pages/docs/$_splat.tsx",
        message:
          'Dynamic page route segment "$_splat" uses a reserved param name. Use a safe application-specific name such as "$userId".',
      },
      {
        level: "error",
        file: "src/pages/orders/$order-id.tsx",
        message:
          'Dynamic page route segment "$order-id" must use a JavaScript identifier after "$", such as "$userId".',
      },
      {
        level: "error",
        file: "src/pages/session/$__proto__.tsx",
        message:
          'Dynamic page route segment "$__proto__" uses a reserved param name. Use a safe application-specific name such as "$userId".',
      },
      {
        level: "error",
        file: "src/pages/settings?.tsx",
        message:
          'Static page route segment "settings?" must use lowercase URL-safe characters: lowercase letters, numbers, ".", "_", "-", or "~". Rename the file to a lowercase URL-safe segment, or use explicit pages config for custom paths.',
      },
      {
        level: "error",
        file: "src/pages/team/$constructor.tsx",
        message:
          'Dynamic page route segment "$constructor" uses a reserved param name. Use a safe application-specific name such as "$userId".',
      },
      {
        level: "error",
        file: "src/pages/teams/$teamId/users/$teamId.tsx",
        message:
          'Dynamic page route segment "$teamId" repeats a param name. Use unique dynamic param filenames within one route path.',
      },
      {
        level: "error",
        file: "src/pages/users/$123.tsx",
        message:
          'Dynamic page route segment "$123" must use a JavaScript identifier after "$", such as "$userId".',
      },
    ]);
  });

  it("discovers layout files inside the page route directory", async () => {
    const cwd = await createFixture({
      "src/layout/index.tsx":
        "export default function Layout() { return null; }",
      "src/pages/posts/layout.tsx":
        "export default function PostsLayout() { return null; }",
      "src/pages/admin/layout.jsx":
        "export default function AdminLayout() { return null; }",
      "src/pages/admin/settings.tsx":
        "export default function AdminSettings() { return null; }",
      "src/pages/layout/index.tsx":
        "export default function LayoutIndex() { return null; }",
      "src/pages/index.tsx": "export default function Home() { return null; }",
      "src/pages/posts/$postId.tsx":
        "export default function Post() { return null; }",
      "src/pages/posts/layout/index.jsx":
        "export default function PostLayoutIndex() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, { dir: "./src/pages" });

    expect(discovery.rootModule).toBe("./src/layout/index.tsx");
    expect(discovery.routes).toEqual([
      {
        id: "index",
        path: "/",
        parentId: "layout",
        module: "./src/pages/index.tsx",
      },
      {
        id: "layout",
        path: "/",
        module: "./src/pages/layout/index.tsx",
        kind: "layout",
      },
      {
        id: "admin_layout",
        path: "/admin",
        module: "./src/pages/admin/layout.jsx",
        parentId: "layout",
        kind: "layout",
      },
      {
        id: "admin_settings",
        path: "/admin/settings",
        module: "./src/pages/admin/settings.tsx",
        parentId: "admin_layout",
      },
      {
        id: "posts_layout",
        path: "/posts",
        module: "./src/pages/posts/layout.tsx",
        parentId: "layout",
        kind: "layout",
      },
      {
        id: "posts_postId",
        path: "/posts/$postId",
        module: "./src/pages/posts/$postId.tsx",
        parentId: "posts_layout",
      },
    ]);
    expect(discovery.diagnostics).toEqual([
      {
        level: "error",
        file: "src/pages/posts/layout/index.jsx",
        message:
          'Duplicate page route id "posts_layout" for layout path "/posts" also generated by ./src/pages/posts/layout.tsx (/posts). Rename one route file so generated route ids are unique.',
      },
    ]);
  });

  it("discovers layout files inside a custom route directory", async () => {
    const cwd = await createFixture({
      "src/app/pages/layout.tsx":
        "export default function Layout() { return null; }",
      "src/app/pages/posts/layout/index.tsx":
        "export default function PostLayoutIndex() { return null; }",
      "src/app/pages/index.tsx":
        "export default function Home() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, {
      dir: "./src/app/pages",
    });

    expect(discovery.rootModule).toBeUndefined();
    expect(discovery.routes).toEqual([
      {
        id: "index",
        path: "/",
        parentId: "layout",
        module: "./src/app/pages/index.tsx",
      },
      {
        id: "layout",
        path: "/",
        module: "./src/app/pages/layout.tsx",
        kind: "layout",
      },
      {
        id: "posts_layout",
        path: "/posts",
        module: "./src/app/pages/posts/layout/index.tsx",
        parentId: "layout",
        kind: "layout",
      },
    ]);
    expect(discovery.diagnostics).toEqual([]);
  });

  it("uses configured root layout together with route-directory layouts", async () => {
    const cwd = await createFixture({
      "src/shell/AppLayout.tsx":
        "export default function AppLayout() { return null; }",
      "src/pages/layout.tsx":
        "export default function RouteLayout() { return null; }",
      "src/pages/index.tsx": "export default function Home() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, {
      dir: "./src/pages",
      rootLayout: "./src/shell/AppLayout.tsx",
    });

    expect(discovery.rootModule).toBe("./src/shell/AppLayout.tsx");
    expect(discovery.routes).toEqual([
      {
        id: "index",
        path: "/",
        parentId: "layout",
        module: "./src/pages/index.tsx",
      },
      {
        id: "layout",
        path: "/",
        module: "./src/pages/layout.tsx",
        kind: "layout",
      },
    ]);
    expect(discovery.diagnostics).toEqual([]);
  });

  it("keeps route-directory layouts when external root layout discovery is disabled", async () => {
    const cwd = await createFixture({
      "src/layout/index.tsx":
        "export default function Layout() { return null; }",
      "src/pages/layout.tsx":
        "export default function RouteLayout() { return null; }",
      "src/pages/index.tsx": "export default function Home() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, {
      dir: "./src/pages",
      rootLayout: false,
    });

    expect(discovery.rootModule).toBeUndefined();
    expect(discovery.routes).toEqual([
      {
        id: "index",
        path: "/",
        parentId: "layout",
        module: "./src/pages/index.tsx",
      },
      {
        id: "layout",
        path: "/",
        module: "./src/pages/layout.tsx",
        kind: "layout",
      },
    ]);
    expect(discovery.diagnostics).toEqual([]);
  });

  it("ignores layout directories without layout route modules", async () => {
    const cwd = await createFixture({
      "src/pages/layout/README.md": "# not a route",
      "src/pages/posts/layout/README.md": "# not a route",
      "src/pages/index.tsx": "export default function Home() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, { dir: "./src/pages" });

    expect(discovery.rootModule).toBeUndefined();
    expect(discovery.routes).toEqual([
      {
        id: "index",
        path: "/",
        module: "./src/pages/index.tsx",
      },
    ]);
    expect(discovery.diagnostics).toEqual([]);
  });

  it("discovers root layout files inside the page route directory", async () => {
    const cwd = await createFixture({
      "src/pages/layout.tsx":
        "export default function Layout() { return null; }",
      "src/pages/index.tsx": "export default function Home() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, { dir: "./src/pages" });

    expect(discovery.rootModule).toBeUndefined();
    expect(discovery.routes).toEqual([
      {
        id: "index",
        path: "/",
        parentId: "layout",
        module: "./src/pages/index.tsx",
      },
      {
        id: "layout",
        path: "/",
        module: "./src/pages/layout.tsx",
        kind: "layout",
      },
    ]);
    expect(discovery.diagnostics).toEqual([]);
  });

  it("reports ambiguous root layout auto-discovery modules", async () => {
    const cwd = await createFixture({
      "src/layout.jsx": "export default function LayoutJsx() { return null; }",
      "src/layout.tsx": "export default function LayoutTsx() { return null; }",
      "src/layout/index.js":
        "export default function LayoutIndexJs() { return null; }",
      "src/pages/index.tsx": "export default function Home() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, { dir: "./src/pages" });

    expect(discovery.rootModule).toBeUndefined();
    expect(discovery.routes).toEqual([
      {
        id: "index",
        path: "/",
        module: "./src/pages/index.tsx",
      },
    ]);
    expect(discovery.diagnostics).toEqual([
      {
        level: "error",
        file: "src/layout.tsx",
        message:
          "Multiple root layout modules found beside the page route directory: ./src/layout.tsx, ./src/layout.jsx, ./src/layout/index.js. Keep one layout module or configure routing.layout explicitly.",
      },
    ]);
  });

  it("discovers root layout directory aliases beside a custom page route directory", async () => {
    const cwd = await createFixture({
      "src/app/layout/index.jsx":
        "export default function Layout() { return null; }",
      "src/app/pages/index.tsx":
        "export default function Home() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, {
      dir: "./src/app/pages",
    });

    expect(discovery.rootModule).toBe("./src/app/layout/index.jsx");
    expect(discovery.routes).toEqual([
      {
        id: "index",
        path: "/",
        module: "./src/app/pages/index.tsx",
      },
    ]);
    expect(discovery.diagnostics).toEqual([]);
  });

  it("rejects route files without default exports", async () => {
    const cwd = await createFixture({
      "src/pages/index.tsx": "export default function Home() { return null; }",
      "src/pages/about.tsx":
        "export function About() { return null; }\nexport const loader = () => null;",
      "src/pages/posts.tsx": "export const title = 'Posts';",
      "src/pages/_helpers/format.ts": "export const format = () => null;",
    });

    const discovery = await discoverPageRoutes(cwd, { dir: "./src/pages" });

    expect(discovery.routes).toEqual([
      {
        id: "index",
        path: "/",
        module: "./src/pages/index.tsx",
      },
    ]);
    expect(discovery.diagnostics).toEqual([
      {
        level: "error",
        file: "src/pages/about.tsx",
        message:
          "Page route modules must default-export a React component. Move non-route helpers under an underscore-prefixed file or folder.",
      },
      {
        level: "error",
        file: "src/pages/posts.tsx",
        message:
          "Page route modules must default-export a React component. Move non-route helpers under an underscore-prefixed file or folder.",
      },
    ]);
  });

  it("rejects root layout files without default exports", async () => {
    const cwd = await createFixture({
      "src/layout/index.tsx": "export function Layout() { return null; }",
      "src/pages/index.tsx": "export default function Home() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, { dir: "./src/pages" });

    expect(discovery.rootModule).toBeUndefined();
    expect(discovery.routes).toEqual([
      {
        id: "index",
        path: "/",
        module: "./src/pages/index.tsx",
      },
    ]);
    expect(discovery.diagnostics).toEqual([
      {
        level: "error",
        file: "src/layout/index.tsx",
        message: "Root layout must default-export a React component.",
      },
    ]);
  });

  it("rejects root layout directories at the convention path", async () => {
    const cwd = await createFixture({
      "src/layout/index.tsx/README.md": "# not a module",
      "src/pages/index.tsx": "export default function Home() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, { dir: "./src/pages" });

    expect(discovery.rootModule).toBeUndefined();
    expect(discovery.routes).toEqual([
      {
        id: "index",
        path: "/",
        module: "./src/pages/index.tsx",
      },
    ]);
    expect(discovery.diagnostics).toEqual([
      {
        level: "error",
        file: "src/layout/index.tsx",
        message: "Root layout module must be a file: ./src/layout/index.tsx.",
      },
    ]);
  });

  it("rejects route files with syntax errors", async () => {
    const cwd = await createFixture({
      "src/pages/index.tsx": "export default function Home() { return null; }",
      "src/pages/broken.tsx": "export default function Broken( {",
    });

    const discovery = await discoverPageRoutes(cwd, { dir: "./src/pages" });

    expect(discovery.routes).toEqual([
      {
        id: "index",
        path: "/",
        module: "./src/pages/index.tsx",
      },
    ]);
    expect(discovery.diagnostics).toEqual([
      expect.objectContaining({
        level: "error",
        file: "src/pages/broken.tsx",
        message: expect.stringContaining(
          "Page route module could not be parsed:",
        ),
      }),
    ]);
  });

  it("rejects root layout files with syntax errors", async () => {
    const cwd = await createFixture({
      "src/layout/index.tsx": "export default function Layout( {",
      "src/pages/index.tsx": "export default function Home() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, { dir: "./src/pages" });

    expect(discovery.rootModule).toBeUndefined();
    expect(discovery.routes).toEqual([
      {
        id: "index",
        path: "/",
        module: "./src/pages/index.tsx",
      },
    ]);
    expect(discovery.diagnostics).toEqual([
      expect.objectContaining({
        level: "error",
        file: "src/layout/index.tsx",
        message: expect.stringContaining(
          "Root layout module could not be parsed:",
        ),
      }),
    ]);
  });

  it("does not consume root layout files when root layout discovery is disabled", async () => {
    const cwd = await createFixture({
      "src/layout.tsx": "export function Layout() { return null; }",
      "src/layout/index.tsx":
        "export default function Layout() { return null; }",
      "src/pages/index.tsx": "export default function Home() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, {
      dir: "./src/pages",
      rootLayout: false,
    });

    expect(discovery.rootModule).toBeUndefined();
    expect(discovery.routes).toEqual([
      {
        id: "index",
        path: "/",
        module: "./src/pages/index.tsx",
      },
    ]);
    expect(discovery.diagnostics).toEqual([]);
  });

  it("reports duplicate route paths", async () => {
    const cwd = await createFixture({
      "src/pages/users/$id.tsx": "export default function A() { return null; }",
      "src/pages/users/$id/index.tsx":
        "export default function B() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, { dir: "./src/pages" });

    expect(discovery.routes).toHaveLength(1);
    expect(discovery.diagnostics).toEqual([
      expect.objectContaining({
        level: "error",
        file: "src/pages/users/$id/index.tsx",
        message:
          'Duplicate page route path "/users/$id" also declared by ./src/pages/users/$id.tsx. Keep one page module per URL path; choose either a flat route file or a directory index route file.',
      }),
    ]);
  });

  it("reports ambiguous dynamic route shapes", async () => {
    const cwd = await createFixture({
      "src/pages/users/$id.tsx":
        "export default function UserById() { return null; }",
      "src/pages/users/$userId.tsx":
        "export default function UserByUserId() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, { dir: "./src/pages" });

    expect(discovery.routes).toEqual([
      {
        id: "users_id",
        path: "/users/$id",
        module: "./src/pages/users/$id.tsx",
      },
    ]);
    expect(discovery.diagnostics).toEqual([
      expect.objectContaining({
        level: "error",
        file: "src/pages/users/$userId.tsx",
        message:
          'Ambiguous page route shape "/users/:param" for path "/users/$userId" also matches ./src/pages/users/$id.tsx (/users/$id). Use one dynamic param name for each URL shape or explicit pages config.',
      }),
    ]);
  });

  it("reports duplicate generated route ids", async () => {
    const cwd = await createFixture({
      "src/pages/admin/panel.tsx":
        "export default function AdminPanel() { return null; }",
      "src/pages/admin_panel.tsx":
        "export default function AdminPanelFlat() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, { dir: "./src/pages" });

    expect(discovery.routes).toEqual([
      {
        id: "admin_panel",
        path: "/admin/panel",
        module: "./src/pages/admin/panel.tsx",
      },
    ]);
    expect(discovery.diagnostics).toEqual([
      expect.objectContaining({
        level: "error",
        file: "src/pages/admin_panel.tsx",
        message:
          'Duplicate page route id "admin_panel" for path "/admin_panel" also generated by ./src/pages/admin/panel.tsx (/admin/panel). Rename one route file so generated route ids are unique.',
      }),
    ]);
  });
});

async function createFixture(files: Record<string, string>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "evjs-page-routes-"));
  tempDirs.push(dir);

  for (const [file, content] of Object.entries(files)) {
    const absolute = path.join(dir, file);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content);
  }

  return dir;
}
