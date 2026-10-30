import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildPlan } from "@evjs/shared/manifest";
import { createJiti } from "jiti";
import { afterEach, expect, it, vi } from "vitest";
import { prepareFrameworkBuild } from "../src/_internal/build/commands.js";

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
      'import { api } from "@evjs/ev"; export const request = api.get("/health");',
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
  const consumer = await jiti.import<{ request: Promise<Response> }>(
    path.join(cwd, "consumer.ts"),
  );
  await expect((await consumer.request).json()).resolves.toEqual({ ok: true });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe(
    "https://gateway.test/app/version/health",
  );
  expect(
    Object.fromEntries(new Headers(fetch.mock.calls[0][1]?.headers)),
  ).toEqual({ "x-app": "application", "x-gateway": "deployment" });
});
