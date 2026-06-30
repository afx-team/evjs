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
  it("maps server route files to root-mounted paths", async () => {
    const cwd = await createFixture({
      "src/apis/index.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/apis/health.ts": `
        export const HEAD = async () => new Response(null);
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/apis/users/$userId.ts": `
        export const POST = async () => Response.json({ ok: true });
      `,
      "src/apis/(internal)/metrics.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/apis/api/users.ts": `
        export const DELETE = async () => new Response(null, { status: 204 });
        export const GET = async () => Response.json([]);
      `,
      "src/apis/schema.ts": `
        export const userSchema = {};
      `,
      "src/apis/_helpers/db.ts": `
        export const GET = async () => Response.json({ ignored: true });
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
        id: "src/apis/api/users.ts:/api/users:GET,DELETE",
        module: "src/apis/api/users.ts",
        path: "/api/users",
        methods: ["GET", "DELETE"],
        moduleSegments: ["api"],
      },
      {
        id: "src/apis/health.ts:/health:GET,HEAD",
        module: "src/apis/health.ts",
        path: "/health",
        methods: ["GET", "HEAD"],
        moduleSegments: [],
      },
      {
        id: "src/apis/(internal)/metrics.ts:/metrics:GET",
        module: "src/apis/(internal)/metrics.ts",
        path: "/metrics",
        methods: ["GET"],
        moduleSegments: ["(internal)"],
      },
      {
        id: "src/apis/users/$userId.ts:/users/:userId:POST",
        module: "src/apis/users/$userId.ts",
        path: "/users/:userId",
        methods: ["POST"],
        moduleSegments: ["users"],
      },
      {
        id: "src/apis/index.ts:/:GET",
        module: "src/apis/index.ts",
        path: "/",
        methods: ["GET"],
        moduleSegments: [],
      },
    ]);
  });

  it("maps directory index routes", async () => {
    const cwd = await createFixture({
      "src/apis/users/index.ts": `
        export const GET = async () => Response.json([]);
      `,
    });

    const discovery = await discoverServerRoutes(cwd, {
      dir: "./src/apis",
    });

    expect(discovery.routes).toEqual([
      {
        id: "src/apis/users/index.ts:/users:GET",
        module: "src/apis/users/index.ts",
        path: "/users",
        methods: ["GET"],
        moduleSegments: ["users"],
      },
    ]);
  });

  it("rejects route module middleware exports", async () => {
    const cwd = await createFixture({
      "src/apis/guarded.ts": `
        export const middlewares = [];
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/apis/legacy.ts": `
        export const middleware = async (_ctx, next) => next();
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
        file: "src/apis/guarded.ts",
        message:
          'Server file routes must not export "middlewares". Move middleware logic to a middleware.ts file in the route tree.',
      },
      {
        level: "error",
        file: "src/apis/legacy.ts",
        message:
          'Server file routes must not export "middleware". Move middleware logic to a middleware.ts file in the route tree.',
      },
    ]);
  });

  it("rejects duplicate paths and duplicate dynamic shapes", async () => {
    const cwd = await createFixture({
      "src/apis/users.ts": `
        export const GET = async () => Response.json([]);
      `,
      "src/apis/users/index.ts": `
        export const POST = async () => Response.json({ ok: true });
      `,
      "src/apis/orders/$id.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/apis/orders/$orderId.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
    });

    const discovery = await discoverServerRoutes(cwd, {
      dir: "./src/apis",
    });

    expect(discovery.routes).toEqual([
      {
        id: "src/apis/orders/$id.ts:/orders/:id:GET",
        module: "src/apis/orders/$id.ts",
        path: "/orders/:id",
        methods: ["GET"],
        moduleSegments: ["orders"],
      },
      {
        id: "src/apis/users.ts:/users:GET",
        module: "src/apis/users.ts",
        path: "/users",
        methods: ["GET"],
        moduleSegments: [],
      },
    ]);
    expect(discovery.diagnostics).toEqual([
      {
        level: "error",
        file: "src/apis/orders/$orderId.ts",
        message:
          'Ambiguous server route shape "/orders/:param" for path "/orders/:orderId" also matches src/apis/orders/$id.ts (/orders/:id). Use one dynamic param name for each URL shape.',
      },
      {
        level: "error",
        file: "src/apis/users/index.ts",
        message:
          'Duplicate server route path "/users" also declared by src/apis/users.ts. Keep one server route module per URL path; choose either a flat route file or a directory index route file.',
      },
    ]);
  });

  it("reports invalid server route modules", async () => {
    const cwd = await createFixture({
      "src/apis/foo.get.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/apis/users/[id].ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/apis/files/$...path.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/apis/accounts/$constructor.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/apis/lowercase.ts": `
        export const get = async () => Response.json({ ok: true });
      `,
      "src/apis/default.ts": `
        export const GET = async () => Response.json({ ok: true });
        export default {};
      `,
      "src/apis/schema.ts": `
        export const GET = async () => Response.json({ ok: true });
        export const schema = {};
      `,
      "src/apis/middleware-only.ts": `
        export const middlewares = [];
      `,
      "src/apis/route.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/apis/invalid-middlewares.ts": `
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
        file: "src/apis/accounts/$constructor.ts",
        message:
          'Dynamic server route segment "$constructor" uses a reserved param name. Use a safe application-specific name such as "$userId".',
      },
      {
        level: "error",
        file: "src/apis/default.ts",
        message:
          "Server route modules must not use default exports. Export uppercase HTTP methods instead.",
      },
      {
        level: "error",
        file: "src/apis/files/$...path.ts",
        message:
          'Catch-all server route segments are not supported. Split wildcard handling into explicit file routes instead of "$...path".',
      },
      {
        level: "error",
        file: "src/apis/foo.get.ts",
        message:
          'Server route method suffix files are not supported. Rename "foo.get.ts" so the URL path comes from the file path and HTTP methods come from uppercase exports such as "GET".',
      },
      {
        level: "error",
        file: "src/apis/invalid-middlewares.ts",
        message:
          'Server file routes must not export "middlewares". Move middleware logic to a middleware.ts file in the route tree.',
      },
      {
        level: "error",
        file: "src/apis/lowercase.ts",
        message:
          "Server route modules must export at least one uppercase HTTP method such as GET or POST.",
      },
      {
        level: "error",
        file: "src/apis/lowercase.ts",
        message:
          'Server route module exports lowercase method "get". Use uppercase "GET".',
      },
      {
        level: "error",
        file: "src/apis/middleware-only.ts",
        message:
          'Server file routes must not export "middlewares". Move middleware logic to a middleware.ts file in the route tree.',
      },
      {
        level: "error",
        file: "src/apis/route.ts",
        message:
          'Server route sentinel files are not supported. Rename "route.ts" so the URL path comes from the file path; use "index.ts" for a directory root.',
      },
      {
        level: "error",
        file: "src/apis/schema.ts",
        message:
          'Server route module export "schema" is not supported. Move helpers to a non-route file or export only uppercase HTTP methods.',
      },
      {
        level: "error",
        file: "src/apis/users/[id].ts",
        message:
          'Dynamic server route segments must use $param filenames. Bracket segment "[id]" is not supported. Rename the file to "$id" for a dynamic segment.',
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
      "src/apis/api/users.ts": `
        export const GET = async () => Response.json([]);
      `,
      "src/apis/api/admin/index.ts": `
        export const GET = async () => Response.json([]);
      `,
      "src/apis/(admin)/health.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/apis/api.ts": `
        export const GET = async () => Response.json({ flat: true });
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
