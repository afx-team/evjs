import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { transformServerFile } from "@evjs/build-tools";
import { afterEach, describe, expect, it } from "vitest";
import { UtoopackManifestGenerator } from "../src/manifest-generator.js";

const tempDirs: string[] = [];

async function makeProject() {
  const cwd = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "evjs-manifest-"),
  );
  tempDirs.push(cwd);
  await fs.promises.mkdir(path.join(cwd, "src/api"), { recursive: true });
  await fs.promises.mkdir(path.join(cwd, "src/pages"), { recursive: true });
  await fs.promises.mkdir(path.join(cwd, "dist/client"), { recursive: true });
  await fs.promises.mkdir(path.join(cwd, "dist/server"), { recursive: true });
  return cwd;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      fs.promises.rm(dir, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe("UtoopackManifestGenerator", () => {
  it("collects server functions and routes from source with Utoopack module IDs", async () => {
    const cwd = await makeProject();
    const usersModuleId = "app/src/api/users.server.ts";
    const routeModuleId = "app/src/api/health.routes.ts";

    await fs.promises.writeFile(
      path.join(cwd, "dist/client/stats.json"),
      JSON.stringify({
        entrypoints: {
          main: { assets: [{ name: "main.js" }] },
        },
      }),
    );
    await fs.promises.writeFile(
      path.join(cwd, "dist/server/stats.json"),
      JSON.stringify({
        entrypoints: {
          main: { assets: [{ name: "server.js" }, { name: "server.css" }] },
        },
        modules: [
          {
            name: usersModuleId,
            chunks: ["server.js"],
          },
          {
            name: routeModuleId,
            chunks: ["server.js"],
          },
        ],
      }),
    );

    const usersSource = `
        "use server";
        export async function getUsers() {
          return [];
        }
        export async function createUser() {
          return { id: "1" };
        }
      `;
    const usersPath = path.join(cwd, "src/api/users.server.ts");
    await fs.promises.writeFile(usersPath, usersSource);
    await fs.promises.writeFile(
      path.join(cwd, "src/api/health.routes.ts"),
      `
        import { createRoute } from "@evjs/server";
        export const healthHandler = createRoute("/api/health", {
          GET: async () => Response.json({ ok: true }),
          POST: async () => Response.json({ ok: true }),
        });
      `,
    );
    await fs.promises.writeFile(
      path.join(cwd, "src/pages/home.tsx"),
      `
        import { createRoute } from "@evjs/client";
        export const homeRoute = createRoute({
          getParentRoute: () => rootRoute,
          path: "/",
          component: () => null,
        });
      `,
    );

    const generator = new UtoopackManifestGenerator(cwd, true);
    await generator.build();
    const clientTransform = await transformServerFile(usersSource, {
      resourcePath: usersPath,
      rootContext: cwd,
      isServer: false,
    });
    const expectedFunctionIds = [
      ...clientTransform.code.matchAll(
        /createServerReference\("([a-f0-9]{16})"/g,
      ),
    ].map((match) => match[1]);
    expect(expectedFunctionIds).toHaveLength(2);

    const serverManifest = JSON.parse(
      await fs.promises.readFile(
        path.join(cwd, "dist/server/manifest.json"),
        "utf-8",
      ),
    );
    const clientManifest = JSON.parse(
      await fs.promises.readFile(
        path.join(cwd, "dist/client/manifest.json"),
        "utf-8",
      ),
    );

    expect(serverManifest.entry).toBe("server.js");
    expect(serverManifest.assets).toEqual({
      js: ["server.js"],
      css: ["server.css"],
    });
    expect(Object.keys(serverManifest.fns).sort()).toEqual(
      expectedFunctionIds.sort(),
    );
    for (const fnId of expectedFunctionIds) {
      expect(serverManifest.fns[fnId]).toEqual({
        assets: { js: ["server.js"], css: [] },
      });
    }
    expect(serverManifest.routes).toEqual([
      {
        path: "/api/health",
        methods: ["GET", "POST"],
        assets: { js: ["server.js"], css: [] },
      },
    ]);
    expect(clientManifest.routes).toEqual([{ path: "/" }]);
  });

  it("joins lazy route imports with client module chunk assets", async () => {
    const cwd = await makeProject();

    await fs.promises.writeFile(
      path.join(cwd, "dist/client/stats.json"),
      JSON.stringify({
        entrypoints: {
          main: { assets: [{ name: "main.js" }] },
        },
        modules: [
          {
            name: "src/pages/home.lazy.tsx",
            chunks: ["main.js"],
          },
          {
            name: "src/pages/home.lazy.tsx",
            chunks: ["home.lazy.js", "home.lazy.css"],
          },
        ],
      }),
    );
    await fs.promises.writeFile(
      path.join(cwd, "dist/server/stats.json"),
      JSON.stringify({
        entrypoints: {
          main: { assets: [{ name: "server.js" }] },
        },
      }),
    );
    await fs.promises.writeFile(
      path.join(cwd, "src/pages/home.tsx"),
      `
        import { createRoute } from "@evjs/client/route";
        export const homeRoute = createRoute({
          getParentRoute: () => rootRoute,
          path: "/",
        }).lazy(() => import("./home.lazy").then((d) => d.Route));
      `,
    );
    await fs.promises.writeFile(
      path.join(cwd, "src/pages/home.lazy.tsx"),
      `
        import { createLazyRoute } from "@evjs/client/route";
        export const Route = createLazyRoute("/")({
          component: () => null,
        });
      `,
    );

    const generator = new UtoopackManifestGenerator(cwd, true);
    await generator.build();

    const clientManifest = JSON.parse(
      await fs.promises.readFile(
        path.join(cwd, "dist/client/manifest.json"),
        "utf-8",
      ),
    );

    expect(clientManifest.assets).toEqual({ js: ["main.js"], css: [] });
    expect(clientManifest.routes).toEqual([
      {
        path: "/",
        assets: {
          js: ["home.lazy.js"],
          css: ["home.lazy.css"],
        },
      },
    ]);
  });

  it("includes shared chunks loaded with a lazy route chunk", async () => {
    const cwd = await makeProject();

    await fs.promises.writeFile(
      path.join(cwd, "dist/client/stats.json"),
      JSON.stringify({
        entrypoints: {
          main: { assets: [{ name: "main.js" }] },
        },
        assets: [
          { name: "main.js" },
          { name: "home.lazy.js" },
          { name: "shared.lazy.js" },
        ],
        modules: [
          {
            name: "src/pages/home.lazy.tsx",
            chunks: ["main.js"],
          },
          {
            name: "src/pages/home.lazy.tsx",
            chunks: ["home.lazy.js"],
          },
        ],
      }),
    );
    await fs.promises.writeFile(
      path.join(cwd, "dist/client/main.js"),
      `route.lazy(() => Promise.all(["shared.lazy.js", "home.lazy.js"].map((chunk) => runtime.l(chunk))).then(() => runtime.import(123)))`,
    );
    await fs.promises.writeFile(
      path.join(cwd, "dist/server/stats.json"),
      JSON.stringify({
        entrypoints: {
          main: { assets: [{ name: "server.js" }] },
        },
      }),
    );
    await fs.promises.writeFile(
      path.join(cwd, "src/pages/home.tsx"),
      `
        import { createRoute } from "@evjs/client/route";
        export const homeRoute = createRoute({
          getParentRoute: () => rootRoute,
          path: "/",
        }).lazy(() => import("./home.lazy").then((d) => d.Route));
      `,
    );
    await fs.promises.writeFile(
      path.join(cwd, "src/pages/home.lazy.tsx"),
      `
        import { createLazyRoute } from "@evjs/client/route";
        export const Route = createLazyRoute("/")({
          component: () => null,
        });
      `,
    );

    const generator = new UtoopackManifestGenerator(cwd, true);
    await generator.build();

    const clientManifest = JSON.parse(
      await fs.promises.readFile(
        path.join(cwd, "dist/client/manifest.json"),
        "utf-8",
      ),
    );

    expect(clientManifest.routes).toEqual([
      {
        path: "/",
        assets: {
          js: ["home.lazy.js", "shared.lazy.js"],
          css: [],
        },
      },
    ]);
  });
});
