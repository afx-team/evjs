import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverFileRoutes } from "../src/build-tools/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("discoverFileRoutes", () => {
  it("discovers SPA file routes from src/pages", async () => {
    const cwd = await createFixture({
      "src/pages/__root.tsx": "export default function Root() { return null; }",
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

    const discovery = await discoverFileRoutes(cwd, { dir: "./src/pages" });

    expect(discovery.rootModule).toBe("./src/pages/__root.tsx");
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

  it("reports duplicate route paths", async () => {
    const cwd = await createFixture({
      "src/pages/users/$id.tsx": "export default function A() { return null; }",
      "src/pages/users/[id].tsx":
        "export default function B() { return null; }",
    });

    const discovery = await discoverFileRoutes(cwd, { dir: "./src/pages" });

    expect(discovery.routes).toHaveLength(1);
    expect(discovery.diagnostics).toEqual([
      expect.objectContaining({
        level: "error",
        file: "src/pages/users/[id].tsx",
        message: expect.stringContaining(
          'Duplicate file route path "/users/$id"',
        ),
      }),
    ]);
  });
});

async function createFixture(files: Record<string, string>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "evjs-file-routes-"));
  tempDirs.push(dir);

  for (const [file, content] of Object.entries(files)) {
    const absolute = path.join(dir, file);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content);
  }

  return dir;
}
