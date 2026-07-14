import { describe, expect, it } from "vitest";
import {
  findBestPageRoute,
  getPageRouteParamNameValidationError,
  getPageRouteParamSegmentValidationError,
  isReservedPageRouteParamName,
  matchPageRouteParams,
  normalizeRoutePathname,
  pageRoutePathMatches,
  pageRoutePathShapeFromPath,
  parsePageSearch,
} from "../src/index.js";

describe("page route data helpers", () => {
  it("matches page route paths with dynamic, colon, and wildcard segments", () => {
    expect(pageRoutePathMatches("/orders/$orderId", "/orders/123")).toBe(true);
    expect(pageRoutePathMatches("/orders/:orderId", "/orders/123")).toBe(true);
    expect(pageRoutePathMatches("/docs/$", "/docs/guides/install")).toBe(true);
    expect(pageRoutePathMatches("/orders/$orderId", "/orders/123/items")).toBe(
      false,
    );
  });

  it("matches encoded and decoded Unicode static route segments", () => {
    expect(pageRoutePathMatches("/你好", "/%E4%BD%A0%E5%A5%BD")).toBe(true);
    expect(pageRoutePathMatches("/%E4%BD%A0%E5%A5%BD", "/你好")).toBe(true);
    expect(pageRoutePathMatches("/a%2Fb", "/a%2Fb")).toBe(true);
    expect(pageRoutePathMatches("/a%2Fb", "/a/b")).toBe(false);
  });

  it("finds the most specific matching page route independent of route order", () => {
    const routes = [
      { id: "user", path: "/users/$userId" },
      { id: "catchall", path: "/users/$" },
      { id: "settings", path: "/users/settings" },
    ];

    expect(findBestPageRoute(routes, "/users/settings")?.id).toBe("settings");
    expect(findBestPageRoute(routes, "/users/42")?.id).toBe("user");
    expect(findBestPageRoute(routes, "/users/42/details")?.id).toBe("catchall");
  });

  it("matches dynamic page route params from encoded pathnames", () => {
    expect(
      matchPageRouteParams(
        "/posts/$postId/comments/$commentId",
        "/posts/a%2Fb/comments/c%20d",
      ),
    ).toEqual({
      postId: "a/b",
      commentId: "c d",
    });
  });

  it("validates unsafe page route param names", () => {
    expect(getPageRouteParamNameValidationError("")).toBe("empty");
    expect(getPageRouteParamNameValidationError("__proto__")).toBe("reserved");
    expect(getPageRouteParamNameValidationError("constructor")).toBe(
      "reserved",
    );
    expect(getPageRouteParamNameValidationError("prototype")).toBe("reserved");
    expect(getPageRouteParamNameValidationError("_splat")).toBe("reserved");
    expect(getPageRouteParamNameValidationError("postId")).toBeUndefined();
    expect(isReservedPageRouteParamName("__proto__")).toBe(true);
    expect(isReservedPageRouteParamName("_splat")).toBe(true);
    expect(isReservedPageRouteParamName("postId")).toBe(false);
    expect(getPageRouteParamSegmentValidationError("/users/:")).toEqual({
      segment: ":",
      name: "",
      error: "empty",
    });
    expect(
      getPageRouteParamSegmentValidationError("/users/$constructor"),
    ).toEqual({
      segment: "$constructor",
      name: "constructor",
      error: "reserved",
    });
    expect(
      getPageRouteParamSegmentValidationError("/users/:__proto__"),
    ).toEqual({
      segment: ":__proto__",
      name: "__proto__",
      error: "reserved",
    });
    expect(getPageRouteParamSegmentValidationError("/docs/:_splat")).toEqual({
      segment: ":_splat",
      name: "_splat",
      error: "reserved",
    });
    expect(
      getPageRouteParamSegmentValidationError("/users/:userId/posts/:userId"),
    ).toEqual({
      segment: ":userId",
      name: "userId",
      error: "duplicate",
    });
    expect(getPageRouteParamSegmentValidationError("/docs/$/edit/$")).toEqual({
      segment: "$",
      name: "_splat",
      error: "duplicate-wildcard",
    });
    expect(getPageRouteParamSegmentValidationError("/docs/*")).toEqual({
      segment: "*",
      name: "_splat",
      error: "star-wildcard",
    });
    expect(
      getPageRouteParamSegmentValidationError("/users/:userId"),
    ).toBeUndefined();
  });

  it("matches colon-style dynamic page route params", () => {
    expect(matchPageRouteParams("/posts/:postId", "/posts/42")).toEqual({
      postId: "42",
    });
  });

  it("matches wildcard page route params as splats", () => {
    expect(matchPageRouteParams("/docs/$", "/docs/guides/install")).toEqual({
      _splat: "guides/install",
    });
    expect(matchPageRouteParams("/files/$/edit", "/files/readme/edit")).toEqual(
      {
        _splat: "readme",
      },
    );
    expect(
      matchPageRouteParams("/files/$/edit/$", "/files/readme/edit/intro"),
    ).toEqual({
      _splat: "readme",
    });
  });

  it("does not expose reserved route params from direct helper calls", () => {
    const params = matchPageRouteParams(
      "/users/:__proto__/:constructor/:prototype/:_splat/:safe",
      "/users/a/b/c/d/e",
    );

    expect(params).toEqual({ safe: "e" });
    expect(Object.hasOwn(params, "__proto__")).toBe(false);
    expect(Object.hasOwn(params, "constructor")).toBe(false);
    expect(Object.hasOwn(params, "prototype")).toBe(false);
    expect(Object.hasOwn(params, "_splat")).toBe(false);
  });

  it("normalizes page route path shapes by dynamic parameter position", () => {
    expect(pageRoutePathShapeFromPath("/users/$id")).toBe("/users/:param");
    expect(pageRoutePathShapeFromPath("/users/:userId")).toBe("/users/:param");
    expect(pageRoutePathShapeFromPath("users/$id/details")).toBe(
      "/users/:param/details",
    );
    expect(pageRoutePathShapeFromPath("/docs/$")).toBe("/docs/$");
    expect(pageRoutePathShapeFromPath("/users/$id/")).toBe("/users/:param");
  });

  it("normalizes route pathnames for shared route matching", () => {
    expect(normalizeRoutePathname("users/42")).toBe("/users/42");
    expect(normalizeRoutePathname("/users/42/")).toBe("/users/42");
    expect(normalizeRoutePathname("/users/42///")).toBe("/users/42");
    expect(normalizeRoutePathname("/")).toBe("/");
  });

  it("keeps malformed encoded path params readable", () => {
    expect(matchPageRouteParams("/posts/$postId", "/posts/%E0%A4%A")).toEqual({
      postId: "%E0%A4%A",
    });
  });

  it("parses page search params with repeated keys", () => {
    expect(parsePageSearch("?q=hello+world&tag=a&tag=b&empty")).toEqual({
      q: "hello world",
      tag: ["a", "b"],
      empty: "",
    });
  });

  it("parses page search params without invoking inherited setters", () => {
    const params = parsePageSearch(
      "?__proto__=polluted&__proto__=safe&constructor=value",
    );

    expect(Object.hasOwn(params, "__proto__")).toBe(true);
    expect(Reflect.get(params, "__proto__")).toEqual(["polluted", "safe"]);
    expect(Reflect.get(params, "constructor")).toBe("value");
    expect(Object.getPrototypeOf(params)).toBe(Object.prototype);
  });
});
