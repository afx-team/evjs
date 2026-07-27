import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyRouteScopedMiddlewares,
  discoverServerConventions,
  discoverServerRoutes,
} from "../src/_internal/build/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("discoverServerRoutes", () => {
  it("maps strict api.* anchors from their containing directories", async () => {
    const cwd = await createFixture({
      "src/apis/api.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/apis/health/api.tsx": `
        export const HEAD = async () => new Response(null);
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/apis/users/$userId/api.js": `
        export const POST = async () => Response.json({ ok: true });
      `,
      "src/apis/(internal)/metrics/api.jsx": `
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/apis/api/users/api.ts": `
        export const DELETE = async () => new Response(null, { status: 204 });
        export const GET = async () => Response.json([]);
      `,
      "src/apis/schema.ts": `
        export const userSchema = {};
      `,
      "src/apis/_helpers/db.ts": `
        export const database = {};
      `,
      "src/apis/ordinary.ts": `
        export const GET = async () => Response.json({ ignored: true });
      `,
      "src/apis/users/index.ts": `
        export const POST = async () => Response.json({ ignored: true });
      `,
      "src/apis/users/route.ts": `
        export const PATCH = async () => Response.json({ ignored: true });
      `,
      "src/apis/users/handler.ts": `
        export const PUT = async () => Response.json({ ignored: true });
      `,
      "src/apis/users/endpoint.ts": `
        export const DELETE = async () => Response.json({ ignored: true });
      `,
      "src/apis/types.d.ts": `
        export interface User {}
      `,
      "src/apis/middleware.ts": `
        export default async function middleware(_ctx, next) {
          await next();
        }
      `,
    });

    const discovery = await discoverServerRoutes(cwd, {
      dir: "./src/apis",
    });

    expect(discovery.diagnostics).toEqual([]);
    expect(discovery.routes).toEqual([
      {
        id: "src/apis/api/users/api.ts:/api/users:GET,DELETE",
        module: "src/apis/api/users/api.ts",
        path: "/api/users",
        methods: ["GET", "DELETE"],
        moduleSegments: ["api", "users"],
      },
      {
        id: "src/apis/health/api.tsx:/health:GET,HEAD",
        module: "src/apis/health/api.tsx",
        path: "/health",
        methods: ["GET", "HEAD"],
        moduleSegments: ["health"],
      },
      {
        id: "src/apis/(internal)/metrics/api.jsx:/metrics:GET",
        module: "src/apis/(internal)/metrics/api.jsx",
        path: "/metrics",
        methods: ["GET"],
        moduleSegments: ["(internal)", "metrics"],
      },
      {
        id: "src/apis/users/$userId/api.js:/users/:userId:POST",
        module: "src/apis/users/$userId/api.js",
        path: "/users/:userId",
        methods: ["POST"],
        moduleSegments: ["users", "$userId"],
      },
      {
        id: "src/apis/api.ts:/:GET",
        module: "src/apis/api.ts",
        path: "/",
        methods: ["GET"],
        moduleSegments: [],
      },
    ]);
  });

  it("keeps non-anchor modules private while diagnosing anchored invalid segments", async () => {
    const cwd = await createFixture({
      "src/apis/_private/api.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/apis/_helpers/db.ts": `
        export const database = {};
      `,
      "src/apis/_helpers/route.ts": `
        export const GET = async () => Response.json({ ignored: true });
      `,
    });

    const discovery = await discoverServerRoutes(cwd, {
      dir: "./src/apis",
    });

    expect(discovery.routes).toEqual([]);
    expect(discovery.diagnostics).toEqual([
      {
        level: "error",
        file: "src/apis/_private/api.ts",
        message:
          'Static server route segment "_private" must start with a lowercase letter or number and then use only lowercase URL-safe characters: lowercase letters, numbers, ".", "_", "-", or "~".',
      },
    ]);
  });

  it("rejects duplicate api.* extensions, paths, and dynamic shapes", async () => {
    const cwd = await createFixture({
      "src/apis/(one)/health/api.ts": `
        export const GET = async () => Response.json([]);
      `,
      "src/apis/(two)/health/api.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/apis/orders/$id/api.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/apis/orders/$orderId/api.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/apis/users/api.js": `
        export const GET = async () => Response.json([]);
      `,
      "src/apis/users/api.ts": `
        export const POST = async () => Response.json({ ok: true });
      `,
    });

    const discovery = await discoverServerRoutes(cwd, {
      dir: "./src/apis",
    });

    expect(discovery.routes).toEqual([
      {
        id: "src/apis/(one)/health/api.ts:/health:GET",
        module: "src/apis/(one)/health/api.ts",
        path: "/health",
        methods: ["GET"],
        moduleSegments: ["(one)", "health"],
      },
      {
        id: "src/apis/orders/$id/api.ts:/orders/:id:GET",
        module: "src/apis/orders/$id/api.ts",
        path: "/orders/:id",
        methods: ["GET"],
        moduleSegments: ["orders", "$id"],
      },
      {
        id: "src/apis/users/api.js:/users:GET",
        module: "src/apis/users/api.js",
        path: "/users",
        methods: ["GET"],
        moduleSegments: ["users"],
      },
    ]);
    expect(discovery.diagnostics).toEqual([
      {
        level: "error",
        file: "src/apis/(two)/health/api.ts",
        message:
          'Duplicate api.* anchor for server route path "/health" also declared by src/apis/(one)/health/api.ts. Keep one api.* anchor per normalized URL path; pathless route groups must not collapse multiple directories onto the same path.',
      },
      {
        level: "error",
        file: "src/apis/orders/$orderId/api.ts",
        message:
          'Ambiguous server route shape "/orders/:param" for path "/orders/:orderId" also matches src/apis/orders/$id/api.ts (/orders/:id). Use one dynamic param name for each URL shape.',
      },
      {
        level: "error",
        file: "src/apis/users/api.ts",
        message:
          'Duplicate api.* anchor in server route directory "src/apis/users". src/apis/users/api.js already declares the anchor for this directory. Keep exactly one api.* source-extension variant (api.ts, api.tsx, api.js, or api.jsx) per server route directory.',
      },
    ]);
  });

  it("does not let invalid anchor contents hide duplicate api.* variants", async () => {
    const cwd = await createFixture({
      "src/apis/users/api.js": `
        export const get = async () => Response.json([]);
      `,
      "src/apis/users/api.ts": `
        export const GET = async () => Response.json([]);
      `,
    });

    const discovery = await discoverServerRoutes(cwd, {
      dir: "./src/apis",
    });

    expect(discovery.routes).toEqual([]);
    expect(discovery.diagnostics).toEqual([
      {
        level: "error",
        file: "src/apis/users/api.js",
        message:
          "api.ts, api.tsx, api.js, or api.jsx anchor modules must export at least one uppercase HTTP method such as GET or POST.",
      },
      {
        level: "error",
        file: "src/apis/users/api.js",
        message:
          'Server route module exports lowercase method "get". Use uppercase "GET".',
      },
      {
        level: "error",
        file: "src/apis/users/api.ts",
        message:
          'Duplicate api.* anchor in server route directory "src/apis/users". src/apis/users/api.js already declares the anchor for this directory. Keep exactly one api.* source-extension variant (api.ts, api.tsx, api.js, or api.jsx) per server route directory.',
      },
    ]);
  });

  it("validates path segments and exports only on api.* anchors", async () => {
    const cwd = await createFixture({
      "src/apis/foo.get.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/apis/route.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/apis/users/[id]/api.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/apis/files/$...path/api.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/apis/accounts/$constructor/api.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/apis/empty/api.ts": `
        const ordinary = true;
      `,
      "src/apis/lowercase/api.ts": `
        export const get = async () => Response.json({ ok: true });
      `,
      "src/apis/default/api.ts": `
        export const GET = async () => Response.json({ ok: true });
        export default {};
      `,
      "src/apis/schema/api.ts": `
        export const GET = async () => Response.json({ ok: true });
        export const schema = {};
      `,
      "src/apis/middleware-only/api.ts": `
        export const middlewares = [];
      `,
      "src/apis/middleware-singular/api.ts": `
        export const middleware = async (_ctx, next) => next();
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/apis/invalid-middlewares/api.ts": `
        export const middlewares = [null];
        export const GET = async () => Response.json({ ok: true });
      `,
    });

    const discovery = await discoverServerRoutes(cwd, {
      dir: "./src/apis",
    });

    expect(discovery.routes).toEqual([]);
    expect(discovery.diagnostics).toEqual([
      {
        level: "error",
        file: "src/apis/accounts/$constructor/api.ts",
        message:
          'Dynamic server route segment "$constructor" uses a reserved param name. Use a safe application-specific name such as "$userId".',
      },
      {
        level: "error",
        file: "src/apis/default/api.ts",
        message:
          "Server route modules must not use default exports. Export uppercase HTTP methods instead.",
      },
      {
        level: "error",
        file: "src/apis/empty/api.ts",
        message:
          "api.ts, api.tsx, api.js, or api.jsx anchor modules must export at least one uppercase HTTP method such as GET or POST.",
      },
      {
        level: "error",
        file: "src/apis/files/$...path/api.ts",
        message:
          'Catch-all server route segments are not supported. Split wildcard handling into explicit file routes instead of "$...path".',
      },
      {
        level: "error",
        file: "src/apis/invalid-middlewares/api.ts",
        message:
          'Server file routes must not export "middlewares". Move middleware logic to a middleware.ts file in the route tree.',
      },
      {
        level: "error",
        file: "src/apis/lowercase/api.ts",
        message:
          "api.ts, api.tsx, api.js, or api.jsx anchor modules must export at least one uppercase HTTP method such as GET or POST.",
      },
      {
        level: "error",
        file: "src/apis/lowercase/api.ts",
        message:
          'Server route module exports lowercase method "get". Use uppercase "GET".',
      },
      {
        level: "error",
        file: "src/apis/middleware-only/api.ts",
        message:
          "api.ts, api.tsx, api.js, or api.jsx anchor modules must export at least one uppercase HTTP method such as GET or POST.",
      },
      {
        level: "error",
        file: "src/apis/middleware-only/api.ts",
        message:
          'Server file routes must not export "middlewares". Move middleware logic to a middleware.ts file in the route tree.',
      },
      {
        level: "error",
        file: "src/apis/middleware-singular/api.ts",
        message:
          'Server file routes must not export "middleware". Move middleware logic to a middleware.ts file in the route tree.',
      },
      {
        level: "error",
        file: "src/apis/schema/api.ts",
        message:
          'Server route module export "schema" is not supported. Move helpers to an ordinary colocated module or export only uppercase HTTP methods from the api.* anchor.',
      },
      {
        level: "error",
        file: "src/apis/users/[id]/api.ts",
        message:
          'Dynamic server route segments must use $param directories. Bracket segment "[id]" is not supported. Rename the directory to "$id" and place an api.* anchor inside it.',
      },
    ]);
  });
});

describe("discoverServerConventions", () => {
  it("discovers global and route-scoped middleware in filesystem order", async () => {
    const cwd = await createFixture({
      "src/middleware.ts": `
        import type { MiddlewareHandler } from "@evjs/ev/server-context";
        const middleware: MiddlewareHandler = async (_ctx, next) => {
          await next();
        };
        export default middleware;
      `,
      "src/apis/middleware.ts": `
        export default async function middleware(_ctx, next) {
          await next();
        }
      `,
      "src/apis/api/middleware.ts": `
        export default async (_ctx, next) => next();
      `,
      "src/apis/api/admin/middleware.ts": `
        export default async (_ctx, next) => next();
      `,
      "src/apis/(admin)/middleware.ts": `
        export default async (_ctx, next) => next();
      `,
      "src/apis/api/api.ts": `
        export const GET = async () => Response.json({ api: true });
      `,
      "src/apis/api/users/api.ts": `
        export const GET = async () => Response.json([]);
      `,
      "src/apis/api/admin/api.ts": `
        export const GET = async () => Response.json([]);
      `,
      "src/apis/(admin)/health/api.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
    });

    const routeDiscovery = await discoverServerRoutes(cwd, {
      dir: "./src/apis",
    });
    const conventionDiscovery = await discoverServerConventions(cwd, {
      globalFile: "./src/middleware.ts",
      routingDir: "./src/apis",
    });

    expect(conventionDiscovery.diagnostics).toEqual([]);
    expect(conventionDiscovery.globalMiddlewares).toEqual([
      {
        id: "src/middleware.ts:global-middleware",
        module: "src/middleware.ts",
        scope: "global",
        scopeSegments: [],
      },
    ]);
    expect(conventionDiscovery.routeMiddlewares).toEqual([
      {
        id: "src/apis/middleware.ts:route-middleware",
        module: "src/apis/middleware.ts",
        scope: "route",
        scopeSegments: [],
      },
      {
        id: "src/apis/(admin)/middleware.ts:route-middleware",
        module: "src/apis/(admin)/middleware.ts",
        scope: "route",
        scopeSegments: ["(admin)"],
      },
      {
        id: "src/apis/api/middleware.ts:route-middleware",
        module: "src/apis/api/middleware.ts",
        scope: "route",
        scopeSegments: ["api"],
      },
      {
        id: "src/apis/api/admin/middleware.ts:route-middleware",
        module: "src/apis/api/admin/middleware.ts",
        scope: "route",
        scopeSegments: ["api", "admin"],
      },
    ]);
    const middlewareByModule = new Map(
      conventionDiscovery.routeMiddlewares.map((middleware) => [
        middleware.module,
        middleware,
      ]),
    );
    const rootMiddleware = middlewareByModule.get("src/apis/middleware.ts");
    const apiMiddleware = middlewareByModule.get("src/apis/api/middleware.ts");
    const apiAdminMiddleware = middlewareByModule.get(
      "src/apis/api/admin/middleware.ts",
    );
    const adminGroupMiddleware = middlewareByModule.get(
      "src/apis/(admin)/middleware.ts",
    );

    const routes = applyRouteScopedMiddlewares(
      routeDiscovery.routes,
      conventionDiscovery.routeMiddlewares,
    );
    expect(routes.find((route) => route.path === "/api")?.middlewares).toEqual([
      rootMiddleware,
      apiMiddleware,
    ]);
    expect(
      routes.find((route) => route.path === "/api/users")?.middlewares,
    ).toEqual([rootMiddleware, apiMiddleware]);
    expect(
      routes.find((route) => route.path === "/api/admin")?.middlewares,
    ).toEqual([rootMiddleware, apiMiddleware, apiAdminMiddleware]);
    expect(
      routes.find((route) => route.path === "/health")?.middlewares,
    ).toEqual([rootMiddleware, adminGroupMiddleware]);
  });

  it("reports invalid middleware convention modules", async () => {
    const cwd = await createFixture({
      "src/middleware.ts": `
        export const helper = true;
        export default {};
      `,
      "src/apis/api/middleware.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
    });

    const discovery = await discoverServerConventions(cwd, {
      globalFile: "./src/middleware.ts",
      routingDir: "./src/apis",
    });

    expect(discovery.diagnostics).toEqual([
      {
        level: "error",
        file: "src/middleware.ts",
        message:
          'Server middleware module export "helper" is not supported. Move helpers to a private module and default-export only the middleware.',
      },
      {
        level: "error",
        file: "src/middleware.ts",
        message: "Server middleware default export must be a function.",
      },
      {
        level: "error",
        file: "src/apis/api/middleware.ts",
        message:
          "Server middleware modules must default-export a Hono-compatible middleware function.",
      },
      {
        level: "error",
        file: "src/apis/api/middleware.ts",
        message:
          'Server middleware module export "GET" is not supported. Move helpers to a private module and default-export only the middleware.',
      },
    ]);
  });

  it("diagnoses underscore-prefixed middleware scopes instead of hiding them", async () => {
    const cwd = await createFixture({
      "src/apis/_private/middleware.ts": `
        export default async function middleware(_ctx, next) {
          await next();
        }
      `,
    });

    const discovery = await discoverServerConventions(cwd, {
      globalFile: "./src/middleware.ts",
      routingDir: "./src/apis",
    });

    expect(discovery.routeMiddlewares).toEqual([]);
    expect(discovery.diagnostics).toEqual([
      {
        level: "error",
        file: "src/apis/_private/middleware.ts",
        message:
          'Static server middleware scope segment "_private" must start with a lowercase letter or number and then use only lowercase URL-safe characters: lowercase letters, numbers, ".", "_", "-", or "~".',
      },
    ]);
  });
});

async function createFixture(files: Record<string, string>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "evjs-server-routes-"));
  tempDirs.push(dir);

  for (const [file, content] of Object.entries(files)) {
    const absolute = path.join(dir, file);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content);
  }

  return dir;
}
