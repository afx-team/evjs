import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverPageRoutes } from "../src/_internal/build/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("discoverPageRoutes", () => {
  it("requires an explicit SPA or MPA materialization mode", async () => {
    await expect(
      discoverPageRoutes(process.cwd(), {
        dir: "./src/pages",
      } as never),
    ).rejects.toThrow(
      '[evjs] Internal Page route discovery requires mode "spa" or "mpa".',
    );
  });

  describe("page.* canonical convention", () => {
    it("discovers only positive page anchors across supported route segments", async () => {
      const cwd = await createFixture({
        "src/pages/page.tsx": "export default function Home() { return null; }",
        "src/pages/index.tsx":
          "export default function OrdinaryIndex() { return null; }",
        "src/pages/model.ts": "export const state = {};",
        "src/pages/components/AppNotice.tsx":
          "export default function AppNotice() { return null; }",
        "src/pages/about/page.tsx":
          "export default function About() { return null; }",
        "src/pages/about/index.tsx":
          "export default function OrdinaryAboutIndex() { return null; }",
        "src/pages/users/$userId/page.tsx":
          "export default function User() { return null; }",
        "src/pages/users/$userId/components/Card.tsx":
          "export default function Card() { return null; }",
        "src/pages/docs/$...splat/page.tsx":
          "export default function Docs() { return null; }",
        "src/pages/(admin)/settings/page.tsx":
          "export default function Settings() { return null; }",
      });

      const discovery = await discoverPageRoutes(cwd, {
        dir: "./src/pages",
        mode: "spa",
      });

      expect(discovery.routes).toEqual([
        {
          id: "index",
          path: "/",
          module: "./src/pages/page.tsx",
          scope: { kind: "directory", root: "./src/pages" },
        },
        {
          id: "about",
          path: "/about",
          module: "./src/pages/about/page.tsx",
          scope: { kind: "directory", root: "./src/pages/about" },
        },
        {
          id: "docs_splat",
          path: "/docs/$",
          module: "./src/pages/docs/$...splat/page.tsx",
          scope: {
            kind: "directory",
            root: "./src/pages/docs/$...splat",
          },
        },
        {
          id: "settings",
          path: "/settings",
          module: "./src/pages/(admin)/settings/page.tsx",
          scope: {
            kind: "directory",
            root: "./src/pages/(admin)/settings",
          },
        },
        {
          id: "users_userId",
          path: "/users/$userId",
          module: "./src/pages/users/$userId/page.tsx",
          scope: {
            kind: "directory",
            root: "./src/pages/users/$userId",
          },
        },
      ]);
      expect(discovery.rootModule).toBeUndefined();
      expect(discovery.diagnostics).toEqual([]);
    });

    it("keeps Page identity, layouts, and config metadata across SPA and MPA", async () => {
      const cwd = await createFixture({
        "src/pages/layout.tsx":
          "export default function RootLayout() { return null; }",
        "src/pages/about/layout.tsx":
          "export default function AboutLayout() { return null; }",
        "src/pages/about/page.tsx":
          "export default function About() { return null; }",
        "src/pages/about/index.tsx":
          "export default function OrdinaryIndex() { return null; }",
        "src/pages/about/index.html": '<div id="about"></div>',
        "src/pages/about/page.config.ts": `
          export default {
            extensions: {
              "@company/feature": { enabled: true },
            },
          };
        `,
        "src/pages/about/config.json": JSON.stringify({
          title: "Compatibility input must stay inert",
        }),
      });

      const spa = await discoverPageRoutes(cwd, {
        dir: "./src/pages",
        mode: "spa",
      });
      const mpa = await discoverPageRoutes(cwd, {
        dir: "./src/pages",
        mode: "mpa",
      });

      expect(spa.rootModule).toBe("./src/pages/layout.tsx");
      expect(mpa.rootModule).toBe(spa.rootModule);
      expect(spa.routes).toEqual([
        expect.objectContaining({
          id: "about_layout",
          path: "/about",
          module: "./src/pages/about/layout.tsx",
          kind: "layout",
        }),
        expect.objectContaining({
          id: "about",
          path: "/about",
          module: "./src/pages/about/page.tsx",
          scope: {
            kind: "directory",
            root: "./src/pages/about",
          },
          parentId: "about_layout",
        }),
      ]);
      expect(mpa.routes).toEqual([
        spa.routes[0],
        {
          ...spa.routes[1],
          html: "./src/pages/about/index.html",
        },
      ]);
      expect(spa.metadata).toEqual({
        pages: [
          {
            pageId: "about",
            directory: "./src/pages/about",
            entry: "./src/pages/about/page.tsx",
            exportName: "default",
            configModule: "./src/pages/about/page.config.ts",
          },
        ],
      });
      expect(mpa.metadata).toEqual(spa.metadata);
      expect(spa.dependencies).toEqual([
        path.join(cwd, "src/pages/about/page.config.ts"),
      ]);
      expect(mpa.dependencies).toEqual(spa.dependencies);
      expect(mpa.files).toEqual(
        expect.arrayContaining([
          path.join(cwd, "src/pages/about/page.config.ts"),
          path.join(cwd, "src/pages/about/index.html"),
        ]),
      );
      expect(spa.diagnostics).toEqual([]);
      expect(mpa.diagnostics).toEqual([]);
    });

    it("fails fast when MPA Pages declare SPA-only facets", async () => {
      const cwd = await createFixture({
        "src/pages/error.tsx":
          "export default function RootError() { return null; }",
        "src/pages/not-found.tsx":
          "export default function RootNotFound() { return null; }",
        "src/pages/page.tsx": `
          export const beforeLoad = () => {};
          export const loader = () => {};
          export const validateSearch = () => {};
          export const pendingComponent = () => null;
          export const errorComponent = () => null;
          export const notFoundComponent = () => null;
          export default function Home() { return null; }
        `,
      });

      const discovery = await discoverPageRoutes(cwd, {
        dir: "./src/pages",
        mode: "mpa",
      });

      expect(discovery.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            level: "error",
            message: expect.stringContaining(
              'error boundary conventions are SPA-only and cannot be used with routing.mode "mpa"',
            ),
          }),
          expect.objectContaining({
            level: "error",
            message: expect.stringContaining(
              'not-found boundary conventions are SPA-only and cannot be used with routing.mode "mpa"',
            ),
          }),
          expect.objectContaining({
            level: "error",
            message: expect.stringContaining(
              'exports "beforeLoad", "loader", "validateSearch", "pendingComponent", "errorComponent", "notFoundComponent" are SPA router facets',
            ),
          }),
        ]),
      );
      expect(discovery.routes).toEqual([]);
    });

    it("rejects orphan and multiple Page config modules without choosing one", async () => {
      const cwd = await createFixture({
        "src/pages/page.tsx": "export default function Home() { return null; }",
        "src/pages/page.config.ts": "export default {};",
        "src/pages/page.config.js": "export default {};",
        "src/pages/about/page.tsx":
          "export default function About() { return null; }",
        "src/pages/about/page.config.js": "export default {};",
        "src/pages/orphan/page.config.ts": "export default {};",
      });

      const discovery = await discoverPageRoutes(cwd, {
        dir: "./src/pages",
        mode: "spa",
      });

      expect(discovery.metadata).toEqual({
        pages: [
          {
            pageId: "about",
            directory: "./src/pages/about",
            entry: "./src/pages/about/page.tsx",
            exportName: "default",
            configModule: "./src/pages/about/page.config.js",
          },
          {
            pageId: "index",
            directory: "./src/pages",
            entry: "./src/pages/page.tsx",
            exportName: "default",
          },
        ],
      });
      expect(discovery.dependencies).toEqual([
        path.join(cwd, "src/pages/about/page.config.js"),
      ]);
      expect(discovery.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            level: "error",
            file: "src/pages/orphan/page.config.ts",
            message: expect.stringContaining(
              "must be colocated with a page.ts, page.tsx, page.js, or page.jsx anchor",
            ),
          }),
          expect.objectContaining({
            level: "error",
            file: "src/pages/page.config.js",
            message: expect.stringContaining(
              "more than one Page config module",
            ),
          }),
        ]),
      );
    });

    it("does not treat componentless layout or group Routes as Page config owners", async () => {
      const cwd = await createFixture({
        "src/pages/admin/layout.tsx":
          "export default function AdminLayout({ children }) { return children; }",
        "src/pages/admin/page.config.ts": `
          export default {
            route: {
              extensions: {
                "@company/access": { policy: "admin" },
              },
            },
          };
        `,
        "src/pages/admin/users/page.tsx":
          "export default function Users() { return null; }",
      });

      const discovery = await discoverPageRoutes(cwd, {
        dir: "./src/pages",
        mode: "spa",
      });

      expect(discovery.diagnostics).toContainEqual(
        expect.objectContaining({
          level: "error",
          file: "src/pages/admin/page.config.ts",
          message: expect.stringContaining(
            "A componentless layout or pathless group Route cannot own page.config.ts route extensions",
          ),
        }),
      );
    });

    it("discovers a root layout and nested layout and boundary facets", async () => {
      const cwd = await createFixture({
        "src/pages/layout.tsx":
          "export default function RootLayout() { return null; }",
        "src/pages/error.tsx":
          "export default function RootError() { return null; }",
        "src/pages/not-found.tsx":
          "export default function RootNotFound() { return null; }",
        "src/pages/about/page.tsx":
          "export default function About() { return null; }",
        "src/pages/dashboard/layout.tsx":
          "export default function DashboardLayout() { return null; }",
        "src/pages/dashboard/error.tsx":
          "export default function DashboardError() { return null; }",
        "src/pages/dashboard/not-found.tsx":
          "export default function DashboardNotFound() { return null; }",
        "src/pages/dashboard/settings/page.tsx":
          "export default function Settings() { return null; }",
      });

      const discovery = await discoverPageRoutes(cwd, {
        dir: "./src/pages",
        mode: "spa",
      });

      expect(discovery.rootModule).toBe("./src/pages/layout.tsx");
      expect(discovery.routes).toEqual([
        expect.objectContaining({
          id: "about",
          path: "/about",
          module: "./src/pages/about/page.tsx",
          errorModule: "./src/pages/error.tsx",
          notFoundModule: "./src/pages/not-found.tsx",
        }),
        expect.objectContaining({
          id: "dashboard_layout",
          path: "/dashboard",
          module: "./src/pages/dashboard/layout.tsx",
          kind: "layout",
        }),
        expect.objectContaining({
          id: "dashboard_settings",
          path: "/dashboard/settings",
          module: "./src/pages/dashboard/settings/page.tsx",
          scope: {
            kind: "directory",
            root: "./src/pages/dashboard/settings",
          },
          parentId: "dashboard_layout",
          errorModule: "./src/pages/dashboard/error.tsx",
          notFoundModule: "./src/pages/dashboard/not-found.tsx",
        }),
      ]);
      expect(discovery.diagnostics).toEqual([]);
    });

    it("reports duplicate page anchors in one directory", async () => {
      const cwd = await createFixture({
        "src/pages/page.ts":
          "export default function HomeTs() { return null; }",
        "src/pages/page.tsx":
          "export default function HomeTsx() { return null; }",
      });

      const discovery = await discoverPageRoutes(cwd, {
        dir: "./src/pages",
        mode: "spa",
      });

      expect(discovery.routes).toEqual([
        {
          id: "index",
          path: "/",
          module: "./src/pages/page.ts",
          scope: { kind: "directory", root: "./src/pages" },
        },
      ]);
      expect(discovery.diagnostics).toEqual([
        expect.objectContaining({
          level: "error",
          file: "src/pages/page.tsx",
          message: expect.stringContaining("Duplicate page.* anchor"),
        }),
      ]);
    });

    it("reports page anchors without a default export", async () => {
      const cwd = await createFixture({
        "src/pages/page.tsx": "export function Home() { return null; }",
      });

      const discovery = await discoverPageRoutes(cwd, {
        dir: "./src/pages",
        mode: "spa",
      });

      expect(discovery.routes).toEqual([]);
      expect(discovery.diagnostics).toEqual([
        expect.objectContaining({
          level: "error",
          file: "src/pages/page.tsx",
          message: expect.stringContaining(
            "page.* anchor modules must default-export",
          ),
        }),
      ]);
    });

    it("accepts runtime default re-exports for page anchors and route facets", async () => {
      const cwd = await createFixture({
        "src/screens/AppLayout.tsx":
          "export function AppLayout() { return null; }",
        "src/screens/Home.tsx":
          "export default function Home() { return null; }",
        "src/screens/RootError.tsx":
          "export default function RootError() { return null; }",
        "src/screens/RootNotFound.tsx":
          "export function RootNotFound() { return null; }",
        "src/screens/User.tsx": "export function UserPage() { return null; }",
        "src/screens/UsersLayout.tsx":
          "export function UsersLayout() { return null; }",
        "src/screens/UsersError.tsx":
          "export default function UsersError() { return null; }",
        "src/screens/UsersNotFound.tsx":
          "export function UsersNotFound() { return null; }",
        "src/pages/layout.tsx":
          'export { AppLayout as default } from "../screens/AppLayout";',
        "src/pages/error.tsx":
          'export { default } from "../screens/RootError";',
        "src/pages/not-found.tsx":
          'export { RootNotFound as default } from "../screens/RootNotFound";',
        "src/pages/page.tsx": 'export { default } from "../screens/Home";',
        "src/pages/users/layout.tsx":
          'export { UsersLayout as default } from "../../screens/UsersLayout";',
        "src/pages/users/error.tsx":
          'export { default } from "../../screens/UsersError";',
        "src/pages/users/not-found.tsx":
          'export { UsersNotFound as default } from "../../screens/UsersNotFound";',
        "src/pages/users/page.tsx":
          'export { UserPage as default } from "../../screens/User";',
      });

      const discovery = await discoverPageRoutes(cwd, {
        dir: "./src/pages",
        mode: "spa",
      });

      expect(discovery.rootModule).toBe("./src/pages/layout.tsx");
      expect(discovery.routes).toEqual([
        expect.objectContaining({
          id: "index",
          module: "./src/pages/page.tsx",
          errorModule: "./src/pages/error.tsx",
          notFoundModule: "./src/pages/not-found.tsx",
        }),
        expect.objectContaining({
          id: "users_layout",
          module: "./src/pages/users/layout.tsx",
        }),
        expect.objectContaining({
          id: "users",
          module: "./src/pages/users/page.tsx",
          parentId: "users_layout",
          errorModule: "./src/pages/users/error.tsx",
          notFoundModule: "./src/pages/users/not-found.tsx",
        }),
      ]);
      expect(discovery.diagnostics).toEqual([]);
    });

    it("rejects type-only and ambient-only default exports", async () => {
      const cwd = await createFixture({
        "src/pages/type-only/page.tsx":
          'export type { Screen as default } from "../../../types";',
        "src/pages/type-only/layout.tsx":
          'export { type Screen as default } from "../../../types";',
        "src/pages/specifier-type/page.tsx":
          'export { type Screen as default } from "../../../types";',
        "src/pages/interface/page.tsx": "export default interface Screen {}",
        "src/pages/interface/not-found.tsx":
          "export default interface NotFound {}",
        "src/pages/ambient/page.tsx":
          "declare const Screen: unknown; export { Screen as default };",
        "src/pages/ambient/error.tsx":
          "declare const Fallback: unknown; export { Fallback as default };",
        "src/pages/ambient-default/page.tsx":
          "declare const Screen: unknown; export default Screen;",
        "src/pages/ambient-function/page.tsx":
          "export default function Screen(): void;",
      });

      const discovery = await discoverPageRoutes(cwd, {
        dir: "./src/pages",
        mode: "spa",
      });

      expect(discovery.routes).toEqual([]);
      expect(discovery.diagnostics).toHaveLength(9);
      for (const file of [
        "src/pages/ambient-default/page.tsx",
        "src/pages/ambient-function/page.tsx",
        "src/pages/ambient/page.tsx",
        "src/pages/interface/page.tsx",
        "src/pages/specifier-type/page.tsx",
        "src/pages/type-only/page.tsx",
      ]) {
        expect(discovery.diagnostics).toContainEqual(
          expect.objectContaining({
            level: "error",
            file,
            message: expect.stringContaining(
              "page.* anchor modules must default-export",
            ),
          }),
        );
      }
      expect(discovery.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file: "src/pages/ambient/error.tsx",
            message:
              "SPA error boundary modules must default-export a React component.",
          }),
          expect.objectContaining({
            file: "src/pages/interface/not-found.tsx",
            message:
              "SPA not-found boundary modules must default-export a React component.",
          }),
          expect.objectContaining({
            file: "src/pages/type-only/layout.tsx",
            message:
              "Page-anchor layout modules must default-export a React component.",
          }),
        ]),
      );
    });

    it("keeps non-anchor source files private", async () => {
      const cwd = await createFixture({
        "src/pages/index.tsx":
          "export default function Home() { return null; }",
        "src/pages/about.tsx":
          "export default function About() { return null; }",
        "src/pages/_components/Card.tsx":
          "export default function Card() { return null; }",
        "src/pages/users/$userId.tsx":
          "export default function User() { return null; }",
      });

      const discovery = await discoverPageRoutes(cwd, {
        dir: "./src/pages",
        mode: "spa",
      });

      expect(discovery.routes).toEqual([]);
      expect(discovery.rootModule).toBeUndefined();
      expect(discovery.diagnostics).toEqual([]);
    });

    it("diagnoses an underscore-prefixed Page route instead of treating it as private", async () => {
      const cwd = await createFixture({
        "src/pages/_private/page.tsx":
          "export default function Private() { return null; }",
      });

      const discovery = await discoverPageRoutes(cwd, {
        dir: "./src/pages",
        mode: "spa",
      });

      expect(discovery.routes).toEqual([]);
      expect(discovery.diagnostics).toEqual([
        {
          level: "error",
          file: "src/pages/_private/page.tsx",
          message:
            'Static page route segment "_private" must start with a letter or number and then use only URL-safe characters: letters, numbers, ".", "_", "-", or "~". Rename the route directory to a URL-safe segment.',
        },
      ]);
    });
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
