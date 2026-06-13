import { describe, expect, it } from "vitest";
import { generatePageRouteTypes } from "../src/build-tools/index.js";

describe("generatePageRouteTypes", () => {
  it("generates a client Register augmentation from discovered page routes", () => {
    const source = generatePageRouteTypes({
      routes: [
        {
          id: "posts_postId",
          path: "/posts/$postId",
          module: "./src/pages/posts/$postId.tsx",
        },
        {
          id: "index",
          path: "/",
          module: "./src/pages/index.tsx",
        },
        {
          id: "search",
          path: "/search",
          module: "./src/pages/search.tsx",
        },
      ],
    });

    expect(source).toContain(
      'import type * as EvPage_index from "./src/pages/index";',
    );
    expect(source).toContain(
      'import type * as EvPage_posts_postId from "./src/pages/posts/$postId";',
    );
    expect(source).toContain(
      'EvRoute_posts_postId: { id: "posts_postId"; path: "/posts/$postId"; module: typeof EvPage_posts_postId };',
    );
    expect(source).toContain(
      'import type { CreatePageRouteRegister } from "@evjs/client/internal/route-types";',
    );
    expect(source).not.toContain("@tanstack/react-router");
    expect(source).toContain('declare module "@evjs/client"');
    expect(source).toContain(
      "interface Register extends CreatePageRouteRegister<EvPageRoutes> {}",
    );
  });

  it("rewrites page module imports relative to the generated declaration", () => {
    const source = generatePageRouteTypes({
      importBaseDir: "./src",
      routes: [
        {
          id: "posts_postId",
          path: "/posts/$postId",
          module: "./src/pages/posts/$postId.tsx",
        },
      ],
    });

    expect(source).toContain(
      'import type * as EvPage_posts_postId from "./pages/posts/$postId";',
    );
  });

  it("escapes route ids that are not valid TypeScript identifiers", () => {
    const source = generatePageRouteTypes({
      routes: [
        {
          id: "123-admin.panel",
          path: "/admin.panel",
          module: "./src/pages/admin.panel.tsx",
        },
      ],
    });

    expect(source).toContain(
      'import type * as EvPage__123_admin_panel from "./src/pages/admin.panel";',
    );
    expect(source).toContain(
      'EvRoute__123_admin_panel: { id: "123-admin.panel"; path: "/admin.panel"; module: typeof EvPage__123_admin_panel };',
    );
  });
});
