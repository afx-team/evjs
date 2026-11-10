import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ApiRuntimeScope } from "@evjs/client/internal/http-api";
import type { BuildPlan, CoreGraph } from "@evjs/shared/manifest";
import { createJiti } from "jiti";
import { afterEach, expect, expectTypeOf, it, vi } from "vitest";
import { prepareFrameworkBuild } from "../src/_internal/build/commands.js";
import { createApiClientSource } from "../src/_internal/build/generated-ir/sources/api-client-source.js";
import { apiRuntimeScope as unboundScope } from "../src/_internal/generated/client/api.js";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    directories
      .splice(0)
      .map((cwd) => fs.rm(cwd, { recursive: true, force: true })),
  );
});

it("binds top-level calls to the application before evaluating consumer modules", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "evjs-http-client-"));
  directories.push(cwd);
  for (const [name, content] of Object.entries({
    "index.html":
      '<!doctype html><html><head></head><body><div id="app"></div></body></html>',
    "src/pages/page.tsx": "export default function Page() { return null; }",
    "src/apis/health/api.ts":
      "throw new Error('server implementation must not be imported'); export const GET = () => Response.json({ ok: true });",
    "consumer.ts":
      'import { api } from "@evjs/ev"; export { apiRuntimeScope } from "@evjs/ev/_internal/client/api"; export const request = api.get("/health");',
  })) {
    await fs.mkdir(path.dirname(path.join(cwd, name)), { recursive: true });
    await fs.writeFile(path.join(cwd, name), content);
  }
  const prepared = await prepareFrameworkBuild(
    {
      routing: { mode: "spa" },
      transport: { headers: { "X-App": "application" } },
    },
    { cwd },
  );
  await prepared.dispose();
  const { plan } = JSON.parse(
    await fs.readFile(path.join(cwd, ".ev/framework/build-plan.json"), "utf8"),
  ) as { plan: BuildPlan };
  vi.stubGlobal("__EVJS_APP_TRANSPORTS__", {
    [JSON.stringify([plan.buildId, "default"])]: {
      baseUrl: "https://gateway.test/app/version",
      headers: { "x-gateway": "deployment" },
    },
  });
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetch);
  const alias = Object.fromEntries(
    Object.entries(plan.resolve?.alias ?? {}).map(([key, value]) => [
      key,
      path.resolve(cwd, value),
    ]),
  );
  const jiti = createJiti(import.meta.url, {
    fsCache: false,
    moduleCache: false,
    alias: {
      ...alias,
      "@evjs/ev/_internal/client/api-transport": fileURLToPath(
        new URL(
          "../src/_internal/generated/client/api-transport.ts",
          import.meta.url,
        ),
      ),
      "@evjs/client/internal/http-api": fileURLToPath(
        new URL(
          "../../client/src/http-api/framework-runtime.ts",
          import.meta.url,
        ),
      ),
      "@evjs/ev": fileURLToPath(new URL("../src/browser.ts", import.meta.url)),
    },
  });
  const consumer = await jiti.import<{
    request: Promise<Response>;
    apiRuntimeScope: Readonly<ApiRuntimeScope>;
  }>(path.join(cwd, "consumer.ts"));
  expect(consumer.apiRuntimeScope).toEqual({
    buildId: plan.buildId,
    applicationId: "default",
  });
  expect(Object.isFrozen(consumer.apiRuntimeScope)).toBe(true);
  await expect((await consumer.request).json()).resolves.toEqual({ ok: true });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe(
    "https://gateway.test/app/version/health",
  );
  expect(
    Object.fromEntries(new Headers(fetch.mock.calls[0][1]?.headers)),
  ).toEqual({ "x-app": "application", "x-gateway": "deployment" });
});

it("exports the same immutable scope used by the client and isolates build and application identities", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "evjs-api-scope-"));
  directories.push(cwd);
  await fs.mkdir(path.join(cwd, "src/pages"), { recursive: true });
  await fs.writeFile(
    path.join(cwd, "src/pages/page.tsx"),
    "export default function Page() { return null; }",
  );
  await fs.writeFile(path.join(cwd, "index.html"), '<main id="app"></main>');
  const prepared = await prepareFrameworkBuild(
    { routing: { mode: "spa" } },
    { cwd },
  );
  const { graph } = JSON.parse(
    await fs.readFile(path.join(cwd, ".ev/framework/core-graph.json"), "utf8"),
  ) as { graph: CoreGraph };
  const { plan } = JSON.parse(
    await fs.readFile(path.join(cwd, ".ev/framework/build-plan.json"), "utf8"),
  ) as { plan: BuildPlan };
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async () => Response.json({ ok: true }));
  const resolver = vi.fn((scope: ApiRuntimeScope) => ({
    baseUrl: `https://${scope.buildId}.${scope.applicationId}.test`,
    fetch,
  }));
  vi.stubGlobal("__EVJS_TEST_SCOPE_RESOLVER__", resolver);
  const resolverFile = path.join(cwd, "transport.mjs");
  await fs.writeFile(
    resolverFile,
    "export const resolveApiTransport = globalThis.__EVJS_TEST_SCOPE_RESOLVER__;",
  );
  const clientRuntime = new URL(
    "../../client/esm/http-api/framework-runtime.js",
    import.meta.url,
  ).href;
  const expectedScopes = [
    { buildId: "build-a", applicationId: "application-a" },
    { buildId: "build-b", applicationId: "application-a" },
    { buildId: "build-a", applicationId: "application-b" },
  ];
  const scopes: Readonly<ApiRuntimeScope>[] = [];
  try {
    const application = Object.values(graph.applications)[0];
    for (const [index, scope] of expectedScopes.entries()) {
      const filename = path.join(cwd, `client-${index}.mjs`);
      await fs.writeFile(
        filename,
        createApiClientSource(
          {
            ...graph,
            applications: {
              [scope.applicationId]: {
                ...application,
                id: scope.applicationId,
              },
            },
          },
          { ...plan, buildId: scope.buildId },
        )
          .replace(
            '"@evjs/client/internal/http-api"',
            JSON.stringify(clientRuntime),
          )
          .replace(
            '"@evjs/ev/_internal/client/api-transport"',
            JSON.stringify(pathToFileURL(resolverFile).href),
          ),
      );
      const generated = (await import(pathToFileURL(filename).href)) as {
        apiRuntimeScope: Readonly<ApiRuntimeScope>;
        api: { get(path: string): Promise<Response> };
      };
      expect(generated.apiRuntimeScope).toEqual(scope);
      expect(Object.isFrozen(generated.apiRuntimeScope)).toBe(true);
      expect(resolver.mock.calls[index][0]).toBe(generated.apiRuntimeScope);
      expect(Reflect.set(generated.apiRuntimeScope, "buildId", "changed")).toBe(
        false,
      );
      scopes.push(generated.apiRuntimeScope);
      await expect(
        (await generated.api.get("/health")).json(),
      ).resolves.toEqual({ ok: true });
    }
    expect(resolver).toHaveBeenCalledTimes(3);
    expect(new Set(scopes).size).toBe(3);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(
      expectedScopes.map(
        ({ buildId, applicationId }) =>
          `https://${buildId}.${applicationId}.test/health`,
      ),
    );
  } finally {
    await prepared.dispose();
  }
});

it("exposes a readonly frozen scope from the unbound fallback module", () => {
  expect(unboundScope).toEqual({
    buildId: "unbound",
    applicationId: "unbound",
  });
  expect(Object.isFrozen(unboundScope)).toBe(true);
  expectTypeOf(unboundScope).toMatchTypeOf<Readonly<ApiRuntimeScope>>();
  const checkReadonly = (source: typeof unboundScope) => {
    // @ts-expect-error generated runtime scope fields are readonly.
    unboundScope.buildId = source.buildId;
    // @ts-expect-error generated runtime scope fields are readonly.
    unboundScope.applicationId = source.applicationId;
  };
  void checkReadonly;
});
