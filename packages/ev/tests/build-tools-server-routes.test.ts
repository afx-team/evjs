import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverServerRoutes } from "../src/build-tools/index.js";

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
      "src/server/routes/index.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/server/routes/health.ts": `
        export const HEAD = async () => new Response(null);
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/server/routes/users/$userId.ts": `
        export const POST = async () => Response.json({ ok: true });
      `,
      "src/server/routes/(internal)/metrics.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/server/routes/api/users.ts": `
        export const DELETE = async () => new Response(null, { status: 204 });
        export const GET = async () => Response.json([]);
      `,
      "src/server/routes/schema.ts": `
        export const userSchema = {};
      `,
      "src/server/routes/_helpers/db.ts": `
        export const GET = async () => Response.json({ ignored: true });
      `,
      "src/server/routes/types.d.ts": `
        export interface User {}
      `,
    });

    const discovery = await discoverServerRoutes(cwd, {
      dir: "./src/server/routes",
    });

    expect(discovery.diagnostics).toEqual([]);
    expect(discovery.routes).toEqual([
      {
        id: "src/server/routes/api/users.ts:/api/users:GET,DELETE",
        module: "src/server/routes/api/users.ts",
        path: "/api/users",
        methods: ["GET", "DELETE"],
      },
      {
        id: "src/server/routes/health.ts:/health:GET,HEAD",
        module: "src/server/routes/health.ts",
        path: "/health",
        methods: ["GET", "HEAD"],
      },
      {
        id: "src/server/routes/(internal)/metrics.ts:/metrics:GET",
        module: "src/server/routes/(internal)/metrics.ts",
        path: "/metrics",
        methods: ["GET"],
      },
      {
        id: "src/server/routes/users/$userId.ts:/users/:userId:POST",
        module: "src/server/routes/users/$userId.ts",
        path: "/users/:userId",
        methods: ["POST"],
      },
      {
        id: "src/server/routes/index.ts:/:GET",
        module: "src/server/routes/index.ts",
        path: "/",
        methods: ["GET"],
      },
    ]);
  });

  it("maps directory index routes", async () => {
    const cwd = await createFixture({
      "src/server/routes/users/index.ts": `
        export const GET = async () => Response.json([]);
      `,
    });

    const discovery = await discoverServerRoutes(cwd, {
      dir: "./src/server/routes",
    });

    expect(discovery.routes).toEqual([
      {
        id: "src/server/routes/users/index.ts:/users:GET",
        module: "src/server/routes/users/index.ts",
        path: "/users",
        methods: ["GET"],
      },
    ]);
  });

  it("marks routes that export middlewares for generated entries", async () => {
    const cwd = await createFixture({
      "src/server/routes/guarded.ts": `
        export const middlewares = [];
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/server/routes/public.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
    });

    const discovery = await discoverServerRoutes(cwd, {
      dir: "./src/server/routes",
    });

    expect(discovery.routes).toEqual([
      {
        id: "src/server/routes/guarded.ts:/guarded:GET",
        module: "src/server/routes/guarded.ts",
        path: "/guarded",
        methods: ["GET"],
        hasMiddlewares: true,
      },
      {
        id: "src/server/routes/public.ts:/public:GET",
        module: "src/server/routes/public.ts",
        path: "/public",
        methods: ["GET"],
      },
    ]);
  });

  it("rejects duplicate paths and duplicate dynamic shapes", async () => {
    const cwd = await createFixture({
      "src/server/routes/users.ts": `
        export const GET = async () => Response.json([]);
      `,
      "src/server/routes/users/index.ts": `
        export const POST = async () => Response.json({ ok: true });
      `,
      "src/server/routes/orders/$id.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/server/routes/orders/$orderId.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
    });

    const discovery = await discoverServerRoutes(cwd, {
      dir: "./src/server/routes",
    });

    expect(discovery.routes).toEqual([
      {
        id: "src/server/routes/orders/$id.ts:/orders/:id:GET",
        module: "src/server/routes/orders/$id.ts",
        path: "/orders/:id",
        methods: ["GET"],
      },
      {
        id: "src/server/routes/users.ts:/users:GET",
        module: "src/server/routes/users.ts",
        path: "/users",
        methods: ["GET"],
      },
    ]);
    expect(discovery.diagnostics).toEqual([
      {
        level: "error",
        file: "src/server/routes/orders/$orderId.ts",
        message:
          'Ambiguous server route shape "/orders/:param" for path "/orders/:orderId" also matches src/server/routes/orders/$id.ts (/orders/:id). Use one dynamic param name for each URL shape or programmatic createRoute().',
      },
      {
        level: "error",
        file: "src/server/routes/users/index.ts",
        message:
          'Duplicate server route path "/users" also declared by src/server/routes/users.ts. Keep one server route module per URL path; choose either a flat route file or a directory index route file.',
      },
    ]);
  });

  it("reports invalid server route modules", async () => {
    const cwd = await createFixture({
      "src/server/routes/foo.get.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/server/routes/users/[id].ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/server/routes/files/$...path.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/server/routes/accounts/$constructor.ts": `
        export const GET = async () => Response.json({ ok: true });
      `,
      "src/server/routes/lowercase.ts": `
        export const get = async () => Response.json({ ok: true });
      `,
      "src/server/routes/default.ts": `
        export const GET = async () => Response.json({ ok: true });
        export default {};
      `,
      "src/server/routes/schema.ts": `
        export const GET = async () => Response.json({ ok: true });
        export const schema = {};
      `,
      "src/server/routes/middleware-only.ts": `
        export const middlewares = [];
      `,
      "src/server/routes/invalid-middlewares.ts": `
        export const middlewares = [null];
        export const GET = async () => Response.json({ ok: true });
      `,
    });

    const discovery = await discoverServerRoutes(cwd, {
      dir: "./src/server/routes",
    });

    expect(discovery.routes).toEqual([]);
    expect(discovery.diagnostics).toEqual([
      {
        level: "error",
        file: "src/server/routes/accounts/$constructor.ts",
        message:
          'Dynamic server route segment "$constructor" uses a reserved param name. Use a safe application-specific name such as "$userId".',
      },
      {
        level: "error",
        file: "src/server/routes/default.ts",
        message:
          "Server route modules must not use default exports. Export uppercase HTTP methods instead.",
      },
      {
        level: "error",
        file: "src/server/routes/files/$...path.ts",
        message:
          'Catch-all server route segments are not supported. Use programmatic createRoute() for wildcard or custom URL shapes instead of "$...path".',
      },
      {
        level: "error",
        file: "src/server/routes/foo.get.ts",
        message:
          'Server route method suffix files are not supported. Rename "foo.get.ts" so the URL path comes from the file path and HTTP methods come from uppercase exports such as "GET".',
      },
      {
        level: "error",
        file: "src/server/routes/invalid-middlewares.ts",
        message: "Server route middlewares must be an array of functions.",
      },
      {
        level: "error",
        file: "src/server/routes/lowercase.ts",
        message:
          "Server route modules must export at least one uppercase HTTP method such as GET or POST.",
      },
      {
        level: "error",
        file: "src/server/routes/lowercase.ts",
        message:
          'Server route module exports lowercase method "get". Use uppercase "GET".',
      },
      {
        level: "error",
        file: "src/server/routes/middleware-only.ts",
        message:
          "Server route modules must export at least one uppercase HTTP method such as GET or POST.",
      },
      {
        level: "error",
        file: "src/server/routes/schema.ts",
        message:
          'Server route module export "schema" is not supported. Move helpers to a non-route file or export only HTTP methods and middlewares.',
      },
      {
        level: "error",
        file: "src/server/routes/users/[id].ts",
        message:
          'Dynamic server route segments must use $param filenames. Bracket segment "[id]" is not supported. Rename the file to "$id" for a dynamic segment.',
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
