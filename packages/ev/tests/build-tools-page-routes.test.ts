import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverPageRoutes } from "../src/build-tools/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("discoverPageRoutes", () => {
  it("discovers SPA page routes from src/pages", async () => {
    const cwd = await createFixture({
      "src/layout.tsx": "export default function Root() { return null; }",
      "src/pages/index.tsx": "export default function Home() { return null; }",
      "src/pages/about.tsx": "export default function About() { return null; }",
      "src/pages/users/$userId.tsx":
        "export default function User() { return null; }",
      "src/pages/posts/[postId].tsx":
        "export default function Post() { return null; }",
      "src/pages/_private.tsx":
        "export default function Private() { return null; }",
      "src/pages/about.test.tsx":
        "export default function Test() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, { dir: "./src/pages" });

    expect(discovery.rootModule).toBe("./src/layout.tsx");
    expect(discovery.routes).toEqual([
      {
        id: "index",
        path: "/",
        module: "./src/pages/index.tsx",
      },
      {
        id: "about",
        path: "/about",
        module: "./src/pages/about.tsx",
      },
      {
        id: "posts_postId",
        path: "/posts/$postId",
        module: "./src/pages/posts/[postId].tsx",
      },
      {
        id: "users_userId",
        path: "/users/$userId",
        module: "./src/pages/users/$userId.tsx",
      },
    ]);
    expect(discovery.diagnostics).toEqual([]);
  });

  it("keeps nested layout.tsx files out of the root layout slot", async () => {
    const cwd = await createFixture({
      "src/layout.tsx": "export default function Layout() { return null; }",
      "src/pages/posts/layout.tsx":
        "export default function PostsLayout() { return null; }",
      "src/pages/index.tsx": "export default function Home() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, { dir: "./src/pages" });

    expect(discovery.rootModule).toBe("./src/layout.tsx");
    expect(discovery.routes).toEqual([
      {
        id: "index",
        path: "/",
        module: "./src/pages/index.tsx",
      },
      {
        id: "posts_layout",
        path: "/posts/layout",
        module: "./src/pages/posts/layout.tsx",
      },
    ]);
    expect(discovery.diagnostics).toEqual([]);
  });

  it("rejects root layout files inside the page route directory", async () => {
    const cwd = await createFixture({
      "src/pages/layout.tsx":
        "export default function Layout() { return null; }",
      "src/pages/index.tsx": "export default function Home() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, { dir: "./src/pages" });

    expect(discovery.rootModule).toBeUndefined();
    expect(discovery.routes).toEqual([
      {
        id: "index",
        path: "/",
        module: "./src/pages/index.tsx",
      },
    ]);
    expect(discovery.diagnostics).toEqual([
      {
        level: "error",
        file: "src/pages/layout.tsx",
        message:
          "Root layout files must live at ./src/layout.tsx, not inside the page route directory.",
      },
    ]);
  });

  it("rejects root layout directory aliases", async () => {
    const cwd = await createFixture({
      "src/layout/index.tsx":
        "export default function Layout() { return null; }",
      "src/pages/index.tsx": "export default function Home() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, { dir: "./src/pages" });

    expect(discovery.rootModule).toBeUndefined();
    expect(discovery.routes).toEqual([
      {
        id: "index",
        path: "/",
        module: "./src/pages/index.tsx",
      },
    ]);
    expect(discovery.diagnostics).toEqual([
      {
        level: "error",
        file: "src/layout/index.tsx",
        message:
          "Root layout must be a single file at ./src/layout.tsx. ./src/layout/index.tsx is not supported.",
      },
    ]);
  });

  it("reports duplicate route paths", async () => {
    const cwd = await createFixture({
      "src/pages/users/$id.tsx": "export default function A() { return null; }",
      "src/pages/users/[id].tsx":
        "export default function B() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, { dir: "./src/pages" });

    expect(discovery.routes).toHaveLength(1);
    expect(discovery.diagnostics).toEqual([
      expect.objectContaining({
        level: "error",
        file: "src/pages/users/[id].tsx",
        message: expect.stringContaining(
          'Duplicate page route path "/users/$id"',
        ),
      }),
    ]);
  });
});

async function createFixture(files: Record<string, string>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "evjs-page-routes-"));
  tempDirs.push(dir);

  for (const [file, content] of Object.entries(files)) {
    const absolute = path.join(dir, file);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content);
  }

  return dir;
}
