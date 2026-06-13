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
      "src/layout/index.tsx": "export default function Root() { return null; }",
      "src/pages/index.tsx": "export default function Home() { return null; }",
      "src/pages/about.tsx": "export default function About() { return null; }",
      "src/pages/users/$userId.tsx":
        "export default function User() { return null; }",
      "src/pages/posts/$postId.tsx":
        "export default function Post() { return null; }",
      "src/pages/_private.tsx":
        "export default function Private() { return null; }",
      "src/pages/_internal/index.tsx":
        "export default function Internal() { return null; }",
      "src/pages/posts/_draft.tsx":
        "export default function DraftPost() { return null; }",
      "src/pages/posts/_components/Card.tsx":
        "export default function PostCard() { return null; }",
      "src/pages/about.test.tsx":
        "export default function Test() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, { dir: "./src/pages" });

    expect(discovery.rootModule).toBe("./src/layout/index.tsx");
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
        module: "./src/pages/posts/$postId.tsx",
      },
      {
        id: "users_userId",
        path: "/users/$userId",
        module: "./src/pages/users/$userId.tsx",
      },
    ]);
    expect(discovery.diagnostics).toEqual([]);
  });

  it("discovers the root layout beside a custom page route directory", async () => {
    const cwd = await createFixture({
      "src/layout/index.tsx": "export const NotTheAppLayout = true;",
      "src/app/layout/index.tsx":
        "export default function AppLayout() { return null; }",
      "src/app/pages/index.tsx":
        "export default function Home() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, {
      dir: "./src/app/pages",
    });

    expect(discovery.rootModule).toBe("./src/app/layout/index.tsx");
    expect(discovery.routes).toEqual([
      {
        id: "index",
        path: "/",
        module: "./src/app/pages/index.tsx",
      },
    ]);
    expect(discovery.diagnostics).toEqual([]);
  });

  it("uses an explicit root layout module without checking convention aliases", async () => {
    const cwd = await createFixture({
      "src/layout.tsx": "export function LayoutAlias() { return null; }",
      "src/shell/AppLayout.tsx":
        "export default function AppLayout() { return null; }",
      "src/pages/index.tsx": "export default function Home() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, {
      dir: "./src/pages",
      rootLayout: "./src/shell/AppLayout.tsx",
    });

    expect(discovery.rootModule).toBe("./src/shell/AppLayout.tsx");
    expect(discovery.routes).toEqual([
      {
        id: "index",
        path: "/",
        module: "./src/pages/index.tsx",
      },
    ]);
    expect(discovery.diagnostics).toEqual([]);
  });

  it("reports missing explicit root layout modules", async () => {
    const cwd = await createFixture({
      "src/pages/index.tsx": "export default function Home() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, {
      dir: "./src/pages",
      rootLayout: "./src/shell/AppLayout.tsx",
    });

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
        file: "src/shell/AppLayout.tsx",
        message: "Root layout module not found: ./src/shell/AppLayout.tsx.",
      },
    ]);
  });

  it("reports explicit root layout directories", async () => {
    const cwd = await createFixture({
      "src/shell/index.tsx":
        "export default function ShellIndex() { return null; }",
      "src/pages/index.tsx": "export default function Home() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, {
      dir: "./src/pages",
      rootLayout: "./src/shell",
    });

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
        file: "src/shell",
        message: "Root layout module must be a file: ./src/shell.",
      },
    ]);
  });

  it("rejects bracket dynamic route segments", async () => {
    const cwd = await createFixture({
      "src/pages/index.tsx": "export default function Home() { return null; }",
      "src/pages/posts/[postId].tsx":
        "export default function Post() { return null; }",
      "src/pages/files/[...path].tsx":
        "export default function FilePath() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, { dir: "./src/pages" });

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
        file: "src/pages/files/[...path].tsx",
        message:
          'Dynamic page route segments must use $param filenames. Bracket segment "[...path]" is not supported.',
      },
      {
        level: "error",
        file: "src/pages/posts/[postId].tsx",
        message:
          'Dynamic page route segments must use $param filenames. Bracket segment "[postId]" is not supported.',
      },
    ]);
  });

  it("rejects layout files inside the page route directory", async () => {
    const cwd = await createFixture({
      "src/layout/index.tsx":
        "export default function Layout() { return null; }",
      "src/pages/posts/layout.tsx":
        "export default function PostsLayout() { return null; }",
      "src/pages/admin/layout.jsx":
        "export default function AdminLayout() { return null; }",
      "src/pages/layout/index.tsx":
        "export default function LayoutIndex() { return null; }",
      "src/pages/index.tsx": "export default function Home() { return null; }",
      "src/pages/posts/layout/index.jsx":
        "export default function PostLayoutIndex() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, { dir: "./src/pages" });

    expect(discovery.rootModule).toBe("./src/layout/index.tsx");
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
        file: "src/pages/admin/layout.jsx",
        message:
          "Layout files must live at ./src/layout/index.tsx. Files or folders named layout inside the page route directory are not route pages.",
      },
      {
        level: "error",
        file: "src/pages/layout/index.tsx",
        message:
          "Layout files must live at ./src/layout/index.tsx. Files or folders named layout inside the page route directory are not route pages.",
      },
      {
        level: "error",
        file: "src/pages/posts/layout.tsx",
        message:
          "Layout files must live at ./src/layout/index.tsx. Files or folders named layout inside the page route directory are not route pages.",
      },
      {
        level: "error",
        file: "src/pages/posts/layout/index.jsx",
        message:
          "Layout files must live at ./src/layout/index.tsx. Files or folders named layout inside the page route directory are not route pages.",
      },
    ]);
  });

  it("reports the custom root layout path for layout files inside a custom route directory", async () => {
    const cwd = await createFixture({
      "src/app/pages/layout.tsx":
        "export default function Layout() { return null; }",
      "src/app/pages/posts/layout/index.tsx":
        "export default function PostLayoutIndex() { return null; }",
      "src/app/pages/index.tsx":
        "export default function Home() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, {
      dir: "./src/app/pages",
    });

    expect(discovery.rootModule).toBeUndefined();
    expect(discovery.routes).toEqual([
      {
        id: "index",
        path: "/",
        module: "./src/app/pages/index.tsx",
      },
    ]);
    expect(discovery.diagnostics).toEqual([
      {
        level: "error",
        file: "src/app/pages/layout.tsx",
        message:
          "Layout files must live at ./src/app/layout/index.tsx. Files or folders named layout inside the page route directory are not route pages.",
      },
      {
        level: "error",
        file: "src/app/pages/posts/layout/index.tsx",
        message:
          "Layout files must live at ./src/app/layout/index.tsx. Files or folders named layout inside the page route directory are not route pages.",
      },
    ]);
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
          "Layout files must live at ./src/layout/index.tsx. Files or folders named layout inside the page route directory are not route pages.",
      },
    ]);
  });

  it("rejects root layout aliases", async () => {
    const cwd = await createFixture({
      "src/layout.jsx": "export default function LayoutJsx() { return null; }",
      "src/layout.tsx": "export default function LayoutTsx() { return null; }",
      "src/layout/index.js":
        "export default function LayoutIndexJs() { return null; }",
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
        file: "src/layout.tsx",
        message:
          "Root layout must live at ./src/layout/index.tsx. ./src/layout.tsx is not supported.",
      },
      {
        level: "error",
        file: "src/layout.jsx",
        message:
          "Root layout must live at ./src/layout/index.tsx. ./src/layout.jsx is not supported.",
      },
      {
        level: "error",
        file: "src/layout/index.js",
        message:
          "Root layout must live at ./src/layout/index.tsx. ./src/layout/index.js is not supported.",
      },
    ]);
  });

  it("rejects root layout directory aliases beside a custom page route directory", async () => {
    const cwd = await createFixture({
      "src/app/layout/index.jsx":
        "export default function Layout() { return null; }",
      "src/app/pages/index.tsx":
        "export default function Home() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, {
      dir: "./src/app/pages",
    });

    expect(discovery.rootModule).toBeUndefined();
    expect(discovery.routes).toEqual([
      {
        id: "index",
        path: "/",
        module: "./src/app/pages/index.tsx",
      },
    ]);
    expect(discovery.diagnostics).toEqual([
      {
        level: "error",
        file: "src/app/layout/index.jsx",
        message:
          "Root layout must live at ./src/app/layout/index.tsx. ./src/app/layout/index.jsx is not supported.",
      },
    ]);
  });

  it("rejects route files without default exports", async () => {
    const cwd = await createFixture({
      "src/pages/index.tsx": "export default function Home() { return null; }",
      "src/pages/about.tsx":
        "export function About() { return null; }\nexport const loader = () => null;",
      "src/pages/posts.tsx": "export const title = 'Posts';",
      "src/pages/_helpers/format.ts": "export const format = () => null;",
    });

    const discovery = await discoverPageRoutes(cwd, { dir: "./src/pages" });

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
        file: "src/pages/about.tsx",
        message:
          "Page route modules must default-export a React component. Move non-route helpers under an underscore-prefixed file or folder.",
      },
      {
        level: "error",
        file: "src/pages/posts.tsx",
        message:
          "Page route modules must default-export a React component. Move non-route helpers under an underscore-prefixed file or folder.",
      },
    ]);
  });

  it("rejects root layout files without default exports", async () => {
    const cwd = await createFixture({
      "src/layout/index.tsx": "export function Layout() { return null; }",
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
        message: "Root layout must default-export a React component.",
      },
    ]);
  });

  it("rejects route files with syntax errors", async () => {
    const cwd = await createFixture({
      "src/pages/index.tsx": "export default function Home() { return null; }",
      "src/pages/broken.tsx": "export default function Broken( {",
    });

    const discovery = await discoverPageRoutes(cwd, { dir: "./src/pages" });

    expect(discovery.routes).toEqual([
      {
        id: "index",
        path: "/",
        module: "./src/pages/index.tsx",
      },
    ]);
    expect(discovery.diagnostics).toEqual([
      expect.objectContaining({
        level: "error",
        file: "src/pages/broken.tsx",
        message: expect.stringContaining(
          "Page route module could not be parsed:",
        ),
      }),
    ]);
  });

  it("rejects root layout files with syntax errors", async () => {
    const cwd = await createFixture({
      "src/layout/index.tsx": "export default function Layout( {",
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
      expect.objectContaining({
        level: "error",
        file: "src/layout/index.tsx",
        message: expect.stringContaining(
          "Root layout module could not be parsed:",
        ),
      }),
    ]);
  });

  it("does not consume root layout files when root layout discovery is disabled", async () => {
    const cwd = await createFixture({
      "src/layout.tsx": "export function Layout() { return null; }",
      "src/layout/index.tsx":
        "export default function Layout() { return null; }",
      "src/pages/index.tsx": "export default function Home() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, {
      dir: "./src/pages",
      rootLayout: false,
    });

    expect(discovery.rootModule).toBeUndefined();
    expect(discovery.routes).toEqual([
      {
        id: "index",
        path: "/",
        module: "./src/pages/index.tsx",
      },
    ]);
    expect(discovery.diagnostics).toEqual([]);
  });

  it("reports duplicate route paths", async () => {
    const cwd = await createFixture({
      "src/pages/users/$id.tsx": "export default function A() { return null; }",
      "src/pages/users/$id/index.tsx":
        "export default function B() { return null; }",
    });

    const discovery = await discoverPageRoutes(cwd, { dir: "./src/pages" });

    expect(discovery.routes).toHaveLength(1);
    expect(discovery.diagnostics).toEqual([
      expect.objectContaining({
        level: "error",
        file: "src/pages/users/$id/index.tsx",
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
