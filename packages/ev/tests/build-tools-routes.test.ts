import { describe, expect, it } from "vitest";
import { resolveRoutes } from "../src/build-tools/routes.js";

describe("resolveRoutes", () => {
  it("resolves simple child paths to full paths", () => {
    const result = resolveRoutes([
      { path: "/", parentName: "rootRoute", varName: "homeRoute" },
      { path: "/about", parentName: "rootRoute", varName: "aboutRoute" },
    ]);
    expect(result).toEqual([{ path: "/" }, { path: "/about" }]);
  });

  it("resolves nested relative paths", () => {
    const result = resolveRoutes([
      { path: "/posts", parentName: "rootRoute", varName: "postsRoute" },
      {
        path: "$postId",
        parentName: "postsRoute",
        varName: "postDetailRoute",
      },
    ]);
    expect(result).toEqual([{ path: "/posts" }, { path: "/posts/$postId" }]);
  });

  it("excludes index routes under non-root parents", () => {
    const result = resolveRoutes([
      { path: "/posts", parentName: "rootRoute", varName: "postsRoute" },
      {
        path: "/",
        parentName: "postsRoute",
        varName: "postsIndexRoute",
      },
      {
        path: "$postId",
        parentName: "postsRoute",
        varName: "postDetailRoute",
      },
    ]);
    expect(result).toEqual([{ path: "/posts" }, { path: "/posts/$postId" }]);
  });

  it("keeps root index route", () => {
    const result = resolveRoutes([
      { path: "/", parentName: "rootRoute", varName: "homeRoute" },
    ]);
    expect(result).toEqual([{ path: "/" }]);
  });

  it("de-duplicates identical resolved paths", () => {
    const result = resolveRoutes([
      { path: "/about", parentName: "rootRoute", varName: "aboutRoute" },
      { path: "/about", parentName: "rootRoute", varName: "aboutRoute2" },
    ]);
    expect(result).toEqual([{ path: "/about" }]);
  });

  it("handles orphan routes", () => {
    const result = resolveRoutes([{ path: "/orphan", varName: "orphanRoute" }]);
    expect(result).toEqual([{ path: "/orphan" }]);
  });

  it("resolves nested page route paths", () => {
    const result = resolveRoutes([
      { path: "/", id: "index", module: "./src/pages/index.tsx" },
      { path: "/posts", id: "posts", module: "./src/pages/posts/index.tsx" },
      {
        path: "/posts/$postId",
        id: "posts_postId",
        module: "./src/pages/posts/$postId.tsx",
      },
    ]);
    expect(result).toEqual([
      { path: "/", id: "index", module: "./src/pages/index.tsx" },
      { path: "/posts", id: "posts", module: "./src/pages/posts/index.tsx" },
      {
        path: "/posts/$postId",
        id: "posts_postId",
        module: "./src/pages/posts/$postId.tsx",
      },
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(resolveRoutes([])).toEqual([]);
  });

  it("resolves deeply nested routes", () => {
    const result = resolveRoutes([
      { path: "/a", parentName: "rootRoute", varName: "aRoute" },
      { path: "b", parentName: "aRoute", varName: "bRoute" },
      { path: "c", parentName: "bRoute", varName: "cRoute" },
    ]);
    expect(result).toEqual([
      { path: "/a" },
      { path: "/a/b" },
      { path: "/a/b/c" },
    ]);
  });
});
