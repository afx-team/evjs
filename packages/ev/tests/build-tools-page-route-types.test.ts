import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PAGE_ROUTE_CONVENTION_SUMMARY } from "../src/_internal/build/page-route-conventions.js";
import {
  collectGeneratedPageRouteTypeFiles,
  generatePageRouteTypes,
  getPageRouteTypesPath,
  isGeneratedPageRouteTypesFile,
  PAGE_ROUTE_TYPES_CONVENTION_HINT,
  PAGE_ROUTE_TYPES_FILE,
  PAGE_ROUTE_TYPES_HELPER_MODULE,
  PAGE_ROUTE_TYPES_MARKER,
  PAGE_ROUTE_TYPES_REGISTER_MODULE,
  PAGE_ROUTE_TYPES_USAGE_HINT,
  writePageRouteTypesIfChanged,
} from "../src/_internal/build/page-route-types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("generatePageRouteTypes", () => {
  it("generates a client Register augmentation from discovered page routes", () => {
    const source = generatePageRouteTypes({
      routes: [
        {
          id: "posts_postId",
          path: "/posts/$postId",
          module: "./src/pages/posts/$postId.tsx",
        },
        {
          id: "index",
          path: "/",
          module: "./src/pages/index.tsx",
        },
        {
          id: "search",
          path: "/search",
          module: "./src/pages/search.tsx",
        },
      ],
    });

    expect(source).toContain(
      'import type * as EvPage_index from "./src/pages/index";',
    );
    expect(source).toContain(
      'import type * as EvPage_posts_postId from "./src/pages/posts/$postId";',
    );
    expect(source).toContain(
      'EvRoute_posts_postId: { id: "posts_postId"; path: "/posts/$postId"; module: typeof EvPage_posts_postId };',
    );
    expect(source).toContain(
      `import type { CreatePageRouteRegister } from "${PAGE_ROUTE_TYPES_HELPER_MODULE}";`,
    );
    expect(source).toContain(PAGE_ROUTE_TYPES_MARKER);
    expect(source).toContain(PAGE_ROUTE_TYPES_USAGE_HINT);
    expect(source).toContain(PAGE_ROUTE_TYPES_CONVENTION_HINT);
    expect(PAGE_ROUTE_TYPES_CONVENTION_HINT).toContain(
      PAGE_ROUTE_CONVENTION_SUMMARY,
    );
    expect(source).not.toContain("@tanstack/react-router");
    expect(source).toContain(
      `declare module "${PAGE_ROUTE_TYPES_REGISTER_MODULE}"`,
    );
    expect(source).toContain(
      "interface Register extends CreatePageRouteRegister<EvPageRoutes> {}",
    );
  });

  it("keeps the generated helper import on the client runtime package", () => {
    const source = generatePageRouteTypes({
      routes: [
        {
          id: "index",
          path: "/",
          module: "./src/pages/index.tsx",
        },
      ],
    });

    expect(source).toContain(PAGE_ROUTE_TYPES_HELPER_MODULE);
    expect(source).toContain(PAGE_ROUTE_TYPES_REGISTER_MODULE);
    expect(source).toContain("@evjs/ev/_internal/client/route-types");
    expect(source).not.toContain("@evjs/client/internal/route-types");
  });

  it("rewrites page module imports relative to the generated declaration", () => {
    const source = generatePageRouteTypes({
      importBaseDir: "./src",
      routes: [
        {
          id: "posts_postId",
          path: "/posts/$postId",
          module: "./src/pages/posts/$postId.tsx",
        },
      ],
    });

    expect(source).toContain(
      'import type * as EvPage_posts_postId from "./pages/posts/$postId";',
    );
  });

  it("places generated route declarations beside the route directory parent", () => {
    const cwd = path.resolve("/workspace/app");

    expect(getPageRouteTypesPath(cwd, "./src/pages")).toEqual({
      dir: path.join(cwd, "src"),
      file: path.join(cwd, "src", PAGE_ROUTE_TYPES_FILE),
      importBaseDir: "./src",
    });
    expect(getPageRouteTypesPath(cwd, "./src/app/pages")).toEqual({
      dir: path.join(cwd, "src/app"),
      file: path.join(cwd, "src/app", PAGE_ROUTE_TYPES_FILE),
      importBaseDir: "./src/app",
    });
  });

  it("collects only generated route declaration files outside cleanup skip directories", async () => {
    const cwd = await createTempDir();
    const generatedSource = [
      "/* eslint-disable */",
      PAGE_ROUTE_TYPES_MARKER,
      "export {};",
    ].join("\n");

    await writeFixtureFiles(cwd, {
      "src/route-types.d.ts": generatedSource,
      "types/route-types.d.ts": "declare const userOwned: string;",
      "dist/route-types.d.ts": generatedSource,
      "node_modules/pkg/route-types.d.ts": generatedSource,
      ".turbo/route-types.d.ts": generatedSource,
    });

    await expect(
      isGeneratedPageRouteTypesFile(path.join(cwd, "src", "route-types.d.ts")),
    ).resolves.toBe(true);
    await expect(
      isGeneratedPageRouteTypesFile(
        path.join(cwd, "types", "route-types.d.ts"),
      ),
    ).resolves.toBe(false);
    await expect(
      isGeneratedPageRouteTypesFile(
        path.join(cwd, "missing", "route-types.d.ts"),
      ),
    ).resolves.toBe(false);
    await expect(collectGeneratedPageRouteTypeFiles(cwd)).resolves.toEqual([
      path.join(cwd, "src", "route-types.d.ts"),
    ]);
  });

  it("writes route declarations only when content changes", async () => {
    const cwd = await createTempDir();
    const file = path.join(cwd, "route-types.d.ts");
    const source = [PAGE_ROUTE_TYPES_MARKER, "export {};"].join("\n");

    await writePageRouteTypesIfChanged(file, source);
    const firstStat = await fs.stat(file, { bigint: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await writePageRouteTypesIfChanged(file, source);
    const secondStat = await fs.stat(file, { bigint: true });

    expect(secondStat.mtimeNs).toBe(firstStat.mtimeNs);
  });

  it("uses the same static-before-dynamic route order as discovery", () => {
    const source = generatePageRouteTypes({
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
          id: "users",
          path: "/users",
          module: "./src/pages/users/index.tsx",
        },
      ],
    });

    expect(source.indexOf("EvRoute_users:")).toBeLessThan(
      source.indexOf("EvRoute_users_settings:"),
    );
    expect(source.indexOf("EvRoute_users_settings:")).toBeLessThan(
      source.indexOf("EvRoute_users_id:"),
    );
  });

  it("escapes route ids that are not valid TypeScript identifiers", () => {
    const source = generatePageRouteTypes({
      routes: [
        {
          id: "123-admin.panel",
          path: "/admin.panel",
          module: "./src/pages/admin.panel.tsx",
        },
      ],
    });

    expect(source).toContain(
      'import type * as EvPage__123_admin_panel from "./src/pages/admin.panel";',
    );
    expect(source).toContain(
      'EvRoute__123_admin_panel: { id: "123-admin.panel"; path: "/admin.panel"; module: typeof EvPage__123_admin_panel };',
    );
  });

  it("keeps generated TypeScript identifiers unique when route ids sanitize to the same name", () => {
    const source = generatePageRouteTypes({
      routes: [
        {
          id: "admin-panel",
          path: "/admin-panel",
          module: "./src/pages/admin-panel.tsx",
        },
        {
          id: "admin_panel",
          path: "/admin_panel",
          module: "./src/pages/admin_panel.tsx",
        },
      ],
    });

    expect(source).toContain(
      'import type * as EvPage_admin_panel from "./src/pages/admin-panel";',
    );
    expect(source).toContain(
      'import type * as EvPage_admin_panel_2 from "./src/pages/admin_panel";',
    );
    expect(source).toContain(
      'EvRoute_admin_panel: { id: "admin-panel"; path: "/admin-panel"; module: typeof EvPage_admin_panel };',
    );
    expect(source).toContain(
      'EvRoute_admin_panel_2: { id: "admin_panel"; path: "/admin_panel"; module: typeof EvPage_admin_panel_2 };',
    );
  });
});

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "route-types-"));
  tempDirs.push(dir);
  return dir;
}

async function writeFixtureFiles(
  cwd: string,
  files: Record<string, string>,
): Promise<void> {
  await Promise.all(
    Object.entries(files).map(async ([file, source]) => {
      const absolute = path.join(cwd, file);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, source, "utf-8");
    }),
  );
}
