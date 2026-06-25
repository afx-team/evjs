import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspectFrameworkBuild } from "@evjs/ev";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatInspectJson,
  formatInspectText,
  hasInspectErrors,
} from "../src/inspect.js";
import { runInspectCommand } from "../src/inspect-command.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("inspect", () => {
  it("reports framework discovery without running a bundler or writing output", async () => {
    const cwd = await createFixture({
      "index.html": '<div id="app"></div>',
      "src/pages/index.tsx": `
        import { getUsers } from "../api/users.server";
        export const render = "ssr";
        export default function Home() {
          void getUsers;
          return null;
        }
      `,
      "src/pages/_card.tsx": "export function Card() { return null; }",
      "src/api/users.server.ts": `
        "use server";
        export async function getUsers() {
          return [];
        }
      `,
      "src/apis/api/health.ts": `
        export const GET = () => Response.json({ ok: true });
      `,
    });

    const result = await inspectFrameworkBuild(
      {
        routing: { mode: "spa" },
        server: { routing: true },
      },
      { cwd },
    );

    expect(hasInspectErrors(result)).toBe(false);
    expect(result.routing).toMatchObject({
      mode: "spa",
      dir: "./src/pages",
      routeTypes: "./src/route-types.d.ts",
    });
    expect(result.pageRoutes).toEqual([
      { id: "index", path: "/", module: "./src/pages/index.tsx" },
    ]);
    expect(result.routeFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "./src/pages/index.tsx",
          status: "route",
          routePath: "/",
        }),
        expect.objectContaining({
          file: "./src/pages/_card.tsx",
          status: "ignored",
        }),
      ]),
    );
    expect(result.pages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "index",
          render: "ssr",
          component: "./src/pages/index.tsx",
        }),
      ]),
    );
    expect(result.serverFunctions).toEqual([
      expect.objectContaining({
        module: "src/api/users.server.ts",
        exportName: "getUsers",
      }),
    ]);
    expect(result.serverRoutes).toEqual([
      expect.objectContaining({
        module: "src/apis/api/health.ts",
        path: "/api/health",
        methods: ["GET"],
      }),
    ]);
    expect(result.runtime.server).toMatchObject({
      basePath: "/__evjs",
      fn: "/__evjs/fn",
      ppr: "/__evjs/ppr",
      rsc: "/__evjs/rsc",
    });
    await expectPathMissing(path.join(cwd, "dist"));
    await expectPathMissing(path.join(cwd, "src/route-types.d.ts"));
  });

  it("formats text and JSON output", async () => {
    const cwd = await createFixture({
      "index.html": '<div id="app"></div>',
      "src/pages/index.tsx": "export default function Home() { return null; }",
    });
    const result = await inspectFrameworkBuild(
      { routing: true, output: { client: "dist" } },
      { cwd },
    );

    const text = formatInspectText(result);
    expect(text).toContain("ev inspect");
    expect(text).toContain("Routing");
    expect(text).toContain("conventions.layout: auto");
    expect(text).toContain("/ -> index");

    const json = JSON.parse(formatInspectJson(result));
    expect(json.routing.mode).toBe("spa");
    expect(json.routing.conventions.layout).toBe(true);
    expect(json.pageRoutes[0].path).toBe("/");
  });

  it("returns route diagnostics for rejected files without throwing", async () => {
    const cwd = await createFixture({
      "index.html": '<div id="app"></div>',
      "src/pages/index.tsx": "export default function Home() { return null; }",
      "src/pages/users/[id].tsx":
        "export default function User() { return null; }",
    });

    const result = await inspectFrameworkBuild(
      { routing: true, output: { client: "dist" } },
      { cwd },
    );

    expect(hasInspectErrors(result)).toBe(true);
    expect(result.routeFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "./src/pages/users/[id].tsx",
          status: "rejected",
        }),
      ]),
    );
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          source: "page-routes",
          file: "src/pages/users/[id].tsx",
          message: expect.stringContaining(
            'Bracket segment "[id]" is not supported',
          ),
        }),
      ]),
    );
    await expectPathMissing(path.join(cwd, "dist"));
    await expectPathMissing(path.join(cwd, "src/route-types.d.ts"));
  });

  it("returns a failing CLI exit code for error diagnostics", async () => {
    const cwd = await createFixture({
      "ev.config.ts": `
        import { defineConfig } from "@evjs/ev";
        export default defineConfig({ routing: true, output: { client: "dist" } });
      `,
      "index.html": '<div id="app"></div>',
      "src/pages/index.tsx": "export default function Home() { return null; }",
      "src/pages/users/[id].tsx":
        "export default function User() { return null; }",
    });

    const result = await runInspectCommand({ cwd, json: true });
    const output = JSON.parse(result.output);

    expect(result.exitCode).toBe(1);
    expect(output.routeFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "./src/pages/users/[id].tsx",
          status: "rejected",
        }),
      ]),
    );
    expect(output.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          source: "page-routes",
        }),
      ]),
    );
    await expectPathMissing(path.join(cwd, "dist"));
    await expectPathMissing(path.join(cwd, "src/route-types.d.ts"));
  });
});

async function createFixture(files: Record<string, string>): Promise<string> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "evjs-inspect-"));
  tempDirs.push(cwd);
  for (const [file, source] of Object.entries(files)) {
    const absolute = path.join(cwd, file);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, source, "utf-8");
  }
  return cwd;
}

async function expectPathMissing(file: string): Promise<void> {
  await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
}
