import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareFrameworkBuild } from "../src/_internal/build/commands.js";
import type { Plugin } from "../src/plugin/index.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((cwd) => fs.rm(cwd, { recursive: true, force: true })),
  );
});

async function loadServer(
  files: Record<string, string>,
  plugins: Plugin[] = [],
) {
  const cwd = await fs.mkdtemp(
    path.join(os.tmpdir(), "evjs-middleware-runtime-"),
  );
  tempDirs.push(cwd);
  for (const [name, source] of Object.entries({
    "src/apis/items/api.ts": "export const GET = () => new Response('ok');",
    "render-stub.ts":
      "export const createReactFrameworkServer = () => undefined;",
    ...files,
  })) {
    const file = path.join(cwd, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, source);
  }
  const prepared = await prepareFrameworkBuild({ plugins }, { cwd });
  await prepared.dispose();

  // Rendering normally resolves through bundler aliases. Exercise the actual
  // generated API entry with rendering disabled and the real server runtime.
  const jiti = createJiti(import.meta.url, {
    fsCache: false,
    moduleCache: false,
    alias: {
      "@evjs/ev/_internal/server/react": path.join(cwd, "render-stub.ts"),
      "@evjs/ev/_internal/server": fileURLToPath(
        new URL("../src/_internal/generated/server/index.ts", import.meta.url),
      ),
      "@evjs/ev/api": fileURLToPath(
        new URL("../src/api/index.ts", import.meta.url),
      ),
      "@evjs/ev/server-context": fileURLToPath(
        new URL("../src/server-context/index.ts", import.meta.url),
      ),
    },
  });
  return jiti.import<{ fetch: (request: Request) => Promise<Response> }>(
    path.join(cwd, ".ev/entries/server.ts"),
  );
}

describe("generated server middleware", () => {
  it("runs plugin, global, and explicit method chains without loading API middleware files", async () => {
    const server = await loadServer(
      {
        "src/trace.ts": `
        export const trace = (name) => async (ctx, next) => {
          const order = ctx.get('order') ?? [];
          order.push(name);
          ctx.set('order', order);
          await next();
          ctx.header('x-order', order.join(','));
        };
      `,
        "src/middlewares/middleware.ts": `
        import { trace } from '../trace';
        const factory = () => [trace('global-1'), trace('global-2')];
        export default factory();
      `,
        "src/apis/middleware.ts":
          "throw new Error('API root helper must not load implicitly');",
        "src/apis/items/middleware.ts":
          "throw new Error('API directory helper must not load implicitly');",
        "src/apis/items/policies.ts": `
        import { trace } from '../../trace';
        export const policies = [trace('shared-1'), trace('shared-2')];
      `,
        "src/apis/items/api.ts": `
        import { withMiddlewares } from '@evjs/ev/api';
        import { trace } from '../../trace';
        import { policies } from './policies';
        export const GET = () => new Response('public');
        export const POST = withMiddlewares(() => new Response('created', { status: 201 }), [...policies, trace('method')]);
      `,
        "src/apis/items/child/api.ts":
          "export const GET = () => new Response('child');",
      },
      [
        {
          id: "trace-plugin",
          emitIR(ctx) {
            const module = ctx.emit.module({
              id: "trace",
              scope: { kind: "server" },
              source:
                "export default [async (ctx, next) => { ctx.set('order', ['plugin']); await next(); }];",
            });
            ctx
              .slot("server.request.middleware")
              .add({ id: "trace-slot", module });
          },
        },
      ],
    );

    for (const [method, status] of [
      ["GET", 200],
      ["POST", 201],
      ["HEAD", 200],
      ["OPTIONS", 204],
      ["DELETE", 405],
    ] as const) {
      const response = await server.fetch(
        new Request("http://localhost/items", { method }),
      );
      expect(response.status).toBe(status);
      expect(response.headers.get("x-order")).toBe(
        [
          "plugin",
          "global-1",
          "global-2",
          ...(method === "POST" ? ["shared-1", "shared-2", "method"] : []),
        ].join(","),
      );
      if (method === "HEAD") expect(await response.text()).toBe("");
    }
    const child = await server.fetch(
      new Request("http://localhost/items/child"),
    );
    expect(await child.text()).toBe("child");
    expect(child.headers.get("x-order")).toBe("plugin,global-1,global-2");
  });

  it("supports existing server-context imports and a disabled global factory", async () => {
    const server = await loadServer({
      "src/middlewares/middleware.ts": `
        import { requestLogger } from '@evjs/ev/server-context';
        const factory = (enabled) => enabled ? [requestLogger()] : [];
        export default factory(false);
      `,
      "src/apis/items/policy.ts": `
        import type { MiddlewareHandler } from '@evjs/ev/server-context';
        const middleware: MiddlewareHandler = async (ctx, next) => {
          await next();
          ctx.header('x-existing-middleware', 'true');
        };
        export default middleware;
      `,
      "src/apis/items/api.ts": `
        import { withMiddlewares } from '@evjs/ev/api';
        import policy from './policy';
        export const GET = withMiddlewares(() => new Response('ok'), policy);
      `,
    });
    const response = await server.fetch(new Request("http://localhost/items"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-existing-middleware")).toBe("true");
  });

  it("rejects empty method chains before serving requests", async () => {
    await expect(
      loadServer({
        "src/apis/items/api.ts": `
          import { withMiddlewares } from '@evjs/ev/api';
          const factory = () => [];
          export const GET = withMiddlewares(() => new Response('ok'), factory());
        `,
      }),
    ).rejects.toThrow(
      "withMiddlewares() middlewares must be a middleware function or a non-empty array",
    );
  });

  it("unwinds directly called method middleware after errors in generated routes", async () => {
    const server = await loadServer({
      "src/middlewares/middleware.ts": `
        export default async (ctx, next) => {
          ctx.set('order', ['global']);
          await next();
          ctx.header('x-order', ctx.get('order').join(','));
        };
      `,
      "src/apis/items/$id/api.ts": `
        import { withMiddlewares } from '@evjs/ev/api';
        const wrapped = withMiddlewares(() => { throw new Error('boom'); }, async (ctx, next) => {
          const order = ctx.get('order');
          order.push('method');
          await next();
          order.push('after:' + ctx.error?.message);
          ctx.header('x-item', ctx.req.param('id'));
        });
        export const GET = (request, context) => wrapped(request, context);
      `,
    });
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const method of ["GET", "HEAD"]) {
        const response = await server.fetch(
          new Request("http://localhost/items/42", { method }),
        );
        expect(response.status).toBe(500);
        expect(response.headers.get("x-order")).toBe(
          "global,method,after:boom",
        );
        expect(response.headers.get("x-item")).toBe("42");
        expect(await response.text()).toBe(
          method === "HEAD" ? "" : "Internal Server Error",
        );
      }
      expect(logError).toHaveBeenCalledTimes(2);
    } finally {
      logError.mockRestore();
    }
  });

  it("reports the source and invalid index of a factory-produced global chain", async () => {
    await expect(
      loadServer({
        "src/middlewares/middleware.ts":
          "const factory = () => [async (_ctx, next) => next(), {}]; export default factory();",
      }),
    ).rejects.toThrow(
      "src/middlewares/middleware.ts default export[1] must be a middleware function.",
    );
  });
});
