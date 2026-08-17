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
        id: "src/apis/api.ts:/:GET",
        module: "src/apis/api.ts",
        path: "/",
        methods: ["GET"],
        moduleSegments: [],
      },
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
    ]);
  });

  it("accepts local and composed callable handler forms", async () => {
    const cwd = await createFixture({
      "src/apis/declaration/api.ts": `
        export async function GET() {
          return Response.json({ ok: true });
        }
      `,
      "src/apis/function-expression/api.ts": `
        export const POST = async function post() {
          return Response.json({ ok: true });
        };
      `,
      "src/apis/local-function/api.ts": `
        function update() {
          return Response.json({ ok: true });
        }
        export { update as PUT };
      `,
      "src/apis/local-const/api.ts": `
        const update = async () => Response.json({ ok: true });
        export { update as PATCH };
      `,
      "src/apis/local-alias/api.ts": `
        const remove = async () => new Response(null, { status: 204 });
        const handler = remove;
        export const DELETE = handler;
      `,
      "src/apis/typed-alias/api.ts": `
        type Handler = () => Response;
        const inspect = () => new Response(null);
        const handler = (inspect satisfies Handler);
        export { handler as HEAD };
      `,
      "src/apis/arrow/api.ts": `
        export const OPTIONS = () => new Response(null);
      `,
      "src/apis/factory/api.ts": `
        function createHandler() {
          return () => Response.json({ ok: true });
        }
        export const GET = createHandler();
      `,
      "src/apis/handler.ts": `
        export const handler = () => Response.json({ ok: true });
      `,
      "src/apis/imported/api.ts": `
        import { handler } from "../handler";
        export { handler as POST };
      `,
      "src/apis/mutable/api.ts": `
        export let DELETE = () => new Response(null, { status: 204 });
      `,
      "src/apis/overload/api.ts": `
        export function GET(request: Request): Response;
        export function GET(_request: Request) {
          return Response.json({ ok: true });
        }
      `,
      "src/apis/reexport/api.ts": `
        export { handler as PUT } from "../handler";
      `,
    });

    const discovery = await discoverServerRoutes(cwd, {
      dir: "./src/apis",
    });

    expect(discovery.diagnostics).toEqual([]);
    expect(
      Object.fromEntries(
        discovery.routes.map((route) => [route.path, route.methods]),
      ),
    ).toEqual({
      "/arrow": ["OPTIONS"],
      "/declaration": ["GET"],
      "/factory": ["GET"],
      "/function-expression": ["POST"],
      "/imported": ["POST"],
      "/local-alias": ["DELETE"],
      "/local-const": ["PATCH"],
      "/local-function": ["PUT"],
      "/mutable": ["DELETE"],
      "/overload": ["GET"],
      "/reexport": ["PUT"],
      "/typed-alias": ["HEAD"],
    });
  });

  it("rejects method values that are statically known to be non-callable", async () => {
    const cwd = await createFixture({
      "src/apis/class/api.ts": `
        export class OPTIONS {}
      `,
      "src/apis/generator/api.ts": `
        export async function* HEAD() {
          yield new Response(null);
        }
      `,
      "src/apis/literal/api.ts": `
        export const PATCH = "not a handler";
      `,
    });

    const discovery = await discoverServerRoutes(cwd, {
      dir: "./src/apis",
    });

    expect(discovery.routes).toEqual([]);
    expect(discovery.diagnostics).toEqual([
      {
        level: "error",
        file: "src/apis/class/api.ts",
        message:
          'Server route method "OPTIONS" must resolve to a function. Non-callable values such as strings, objects, and classes are not valid HTTP handlers.',
      },
      {
        level: "error",
        file: "src/apis/generator/api.ts",
        message:
          'Server route method "HEAD" cannot be a generator function. HTTP method handlers must return a Response or Promise<Response>, not an iterator.',
      },
      {
        level: "error",
        file: "src/apis/literal/api.ts",
        message:
          'Server route method "PATCH" must resolve to a function. Non-callable values such as strings, objects, and classes are not valid HTTP handlers.',
      },
    ]);
  });

  it("uses server param policy and segment-wise route specificity", async () => {
    const cwd = await createFixture({
      "src/apis/files/$_splat/api.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/apis/users/$userId/profile/api.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/apis/users/settings/$section/api.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
    });

    const discovery = await discoverServerRoutes(cwd, {
      dir: "./src/apis",
    });

    expect(discovery.diagnostics).toEqual([]);
    expect(discovery.routes.map((route) => route.path)).toEqual([
      "/files/:_splat",
      "/users/settings/:section",
      "/users/:userId/profile",
    ]);
  });

  it("rejects server route roots that resolve outside the project", async () => {
    const cwd = await createFixture({});
    const externalRoutes = await createFixture({
      "api.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
    });
    await fs.mkdir(path.join(cwd, "src"), { recursive: true });
    await fs.symlink(
      externalRoutes,
      path.join(cwd, "src/apis"),
      process.platform === "win32" ? "junction" : "dir",
    );

    for (const required of [undefined, true]) {
      const discovery = await discoverServerRoutes(cwd, {
        dir: "./src/apis",
        ...(required ? { required } : {}),
      });

      expect(discovery).toEqual({
        routes: [],
        files: [],
        diagnostics: [
          {
            level: "error",
            file: "src/apis",
            message:
              "Server route directory must resolve inside the project root. src/apis points outside after resolving symlinks.",
          },
        ],
      });
    }
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

  it("claims normalized paths and shapes before validating anchor contents", async () => {
    const cwd = await createFixture({
      "src/apis/(one)/health/api.ts": `
        export const get = async () => Response.json({ ok: true });
      `,
      "src/apis/(two)/health/api.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/apis/orders/$id/api.ts": `
        export const GET = ;
      `,
      "src/apis/orders/$orderId/api.ts": `
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
        file: "src/apis/(one)/health/api.ts",
        message:
          "api.ts, api.tsx, api.js, or api.jsx anchor modules must export at least one uppercase HTTP method such as GET or POST.",
      },
      {
        level: "error",
        file: "src/apis/(one)/health/api.ts",
        message:
          'Server route module exports lowercase method "get". Use uppercase "GET".',
      },
      {
        level: "error",
        file: "src/apis/(two)/health/api.ts",
        message:
          'Duplicate api.* anchor for server route path "/health" also declared by src/apis/(one)/health/api.ts. Keep one api.* anchor per normalized URL path; pathless route groups must not collapse multiple directories onto the same path.',
      },
      {
        level: "error",
        file: "src/apis/orders/$id/api.ts",
        message: expect.stringMatching(
          /^Server route module could not be parsed:/,
        ),
      },
      {
        level: "error",
        file: "src/apis/orders/$orderId/api.ts",
        message:
          'Ambiguous server route shape "/orders/:param" for path "/orders/:orderId" also matches src/apis/orders/$id/api.ts (/orders/:id). Use one dynamic param name for each URL shape.',
      },
    ]);
  });

  it("validates path segments and exports only on api.* anchors", async () => {
    const cwd = await createFixture({
      "src/apis/$/api.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/apis/(broken/api.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/apis/Upper/api.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
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
      "src/apis/optional/$id?/api.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/apis/repeat/$id/$id/api.ts": `
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
        file: "src/apis/$/api.ts",
        message:
          'Dynamic server route segments must include a name after "$". Segment "$" is not supported.',
      },
      {
        level: "error",
        file: "src/apis/(broken/api.ts",
        message:
          'Server route group segment "(broken" must wrap a non-empty group name in parentheses, such as "(internal)".',
      },
      {
        level: "error",
        file: "src/apis/Upper/api.ts",
        message:
          'Static server route segment "Upper" must start with a lowercase letter or number and then use only lowercase URL-safe characters: lowercase letters, numbers, ".", "_", "-", or "~".',
      },
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
        file: "src/apis/optional/$id?/api.ts",
        message:
          'Optional server route segments are not supported. Split the route into explicit files instead of "$id?".',
      },
      {
        level: "error",
        file: "src/apis/repeat/$id/$id/api.ts",
        message:
          'Dynamic server route segment "$id" repeats a param name. Use unique dynamic param directories within one route path.',
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
  it("does not read global middleware through a source-root symlink", async () => {
    const outside = await createFixture({
      "middlewares/middleware.ts":
        "export default async function middleware(_ctx, next) { await next(); }",
    });
    const cwd = await createFixture({});
    await fs.symlink(
      outside,
      path.join(cwd, "src"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(
      discoverServerConventions(cwd, {
        globalFile: "./src/middlewares/middleware.ts",
      }),
    ).resolves.toEqual({
      globalMiddlewares: [],
      routeMiddlewares: [],
      files: [],
      diagnostics: [
        {
          level: "error",
          file: "src/middlewares/middleware.ts",
          message:
            "Server middleware file must resolve inside the project root.",
        },
      ],
    });
  });

  it("ignores unavailable or unsafe route-middleware roots", async () => {
    const missingRoot = await createFixture({});
    await expect(
      discoverServerConventions(missingRoot, {
        globalFile: "./src/middlewares/middleware.ts",
        routingDir: "./src/apis",
      }),
    ).resolves.toMatchObject({ routeMiddlewares: [], diagnostics: [] });

    const fileRoot = await createFixture({ "src/apis": "not a directory" });
    await expect(
      discoverServerConventions(fileRoot, {
        globalFile: "./src/middlewares/middleware.ts",
        routingDir: "./src/apis",
      }),
    ).resolves.toMatchObject({ routeMiddlewares: [], diagnostics: [] });

    const outside = await fs.mkdtemp(
      path.join(os.tmpdir(), "evjs-server-middleware-outside-"),
    );
    tempDirs.push(outside);
    await fs.mkdir(path.join(outside, "admin"), { recursive: true });
    await fs.writeFile(
      path.join(outside, "admin/middleware.ts"),
      "export default async function middleware(_ctx, next) { await next(); }",
    );
    const symlinkRoot = await createFixture({});
    await fs.mkdir(path.join(symlinkRoot, "src"), { recursive: true });
    await fs.symlink(
      outside,
      path.join(symlinkRoot, "src/apis"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(
      discoverServerConventions(symlinkRoot, {
        globalFile: "./src/middlewares/middleware.ts",
        routingDir: "./src/apis",
      }),
    ).resolves.toMatchObject({ routeMiddlewares: [], diagnostics: [] });
  });

  it("discovers ordered global composition and route-scoped middleware", async () => {
    const cwd = await createFixture({
      "src/middlewares/middleware.ts": `
        import type { MiddlewareChain, MiddlewareHandler } from "@evjs/ev/server-context";
        const first: MiddlewareHandler = async (_ctx, next) => next();
        const second: MiddlewareHandler = async (_ctx, next) => next();
        export default [first, second] satisfies MiddlewareChain;
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
      globalFile: "./src/middlewares/middleware.ts",
      routingDir: "./src/apis",
    });

    expect(conventionDiscovery.diagnostics).toEqual([]);
    expect(conventionDiscovery.globalMiddlewares).toEqual([
      {
        id: "src/middlewares/middleware.ts:global-middleware",
        module: "src/middlewares/middleware.ts",
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
      "src/middlewares/middleware.ts": `
        const middleware = async (_ctx, next) => next();
        export const helper = true;
        export default [middleware, false];
      `,
      "src/apis/api/middleware.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
    });

    const discovery = await discoverServerConventions(cwd, {
      globalFile: "./src/middlewares/middleware.ts",
      routingDir: "./src/apis",
    });

    expect(discovery.diagnostics).toEqual([
      {
        level: "error",
        file: "src/middlewares/middleware.ts",
        message:
          'Server middleware module export "helper" is not supported. Move helpers to a private module and default-export only the middleware.',
      },
      {
        level: "error",
        file: "src/middlewares/middleware.ts",
        message:
          "Global server middleware default export item 2 must resolve to a function.",
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

  it("accepts one global handler but rejects route-scoped middleware lists", async () => {
    const cwd = await createFixture({
      "src/middlewares/middleware.ts": `
        export default async function middleware(_ctx, next) {
          await next();
        }
      `,
      "src/apis/admin/middleware.ts": `
        const authentication = async (_ctx, next) => next();
        export default [authentication];
      `,
    });

    const discovery = await discoverServerConventions(cwd, {
      globalFile: "./src/middlewares/middleware.ts",
      routingDir: "./src/apis",
    });

    expect(discovery.globalMiddlewares).toHaveLength(1);
    expect(discovery.diagnostics).toEqual([
      {
        level: "error",
        file: "src/apis/admin/middleware.ts",
        message:
          "Route-scoped server middleware default export must resolve to a function.",
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
      globalFile: "./src/middlewares/middleware.ts",
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

  it("diagnoses duplicate global middleware composition anchors", async () => {
    const cwd = await createFixture({
      "src/middlewares/middleware.ts": `
        export default async function middleware(_ctx, next) {
          await next();
        }
      `,
      "src/middlewares/middleware.js": `
        export default async function middleware(_ctx, next) {
          await next();
        }
      `,
    });

    const discovery = await discoverServerConventions(cwd, {
      globalFile: "./src/middlewares/middleware.ts",
    });

    expect(discovery.globalMiddlewares).toEqual([]);
    expect(discovery.files).toEqual([
      path.join(cwd, "src/middlewares/middleware.js"),
      path.join(cwd, "src/middlewares/middleware.ts"),
    ]);
    expect(discovery.diagnostics).toEqual([
      {
        level: "error",
        file: "src/middlewares/middleware.js",
        message:
          "Duplicate global server middleware composition anchors found. Keep one src/middlewares/middleware.* source module.",
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
