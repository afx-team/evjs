import { describe, expect, it } from "vitest";
import {
  compareRoutePathsBySpecificity,
  findBestPageRoute,
  getPageRouteParamNameValidationError,
  getPageRouteParamSegmentValidationError,
  isReservedPageRouteParamName,
  matchPageRouteParams,
  normalizeRoutePathname,
  pageRoutePathMatches,
  pageRoutePathShapeFromPath,
  pageRoutePathToRegExp,
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

  it("compiles terminal splats as zero-or-more path segments", () => {
    const splat = pageRoutePathToRegExp("/docs/$");
    expect(splat.test("/docs")).toBe(true);
    expect(splat.test("/docs/")).toBe(true);
    expect(splat.test("/docs/a")).toBe(true);
    expect(splat.test("/docs/a/b")).toBe(true);
    expect(splat.test("/doc")).toBe(false);

    const param = pageRoutePathToRegExp("/docs/$slug");
    expect(param.test("/docs/a")).toBe(true);
    expect(param.test("/docs/a/b")).toBe(false);
  });

  it("keeps imperative and regexp matching aligned around empty segments", () => {
    const cases = [
      ["/", "/", true],
      ["/", "//", false],
      ["/users/profile", "/users/profile", true],
      ["/users/profile", "/users/profile/", true],
      ["/users/profile", "/users/profile//", false],
      ["/users/profile", "/users//profile", false],
      ["/users/$id", "/users/42", true],
      ["/users/$id", "/users//", false],
      ["/docs/$", "/docs", true],
      ["/docs/$", "/docs/", true],
      ["/docs/$", "/docs/a/b", true],
      ["/docs/$", "/docs//b", false],
      ["/docs/$", "/docs/a//", false],
    ] as const;

    for (const [routePath, pathname, expected] of cases) {
      expect(pageRoutePathMatches(routePath, pathname)).toBe(expected);
      expect(pageRoutePathToRegExp(routePath).test(pathname)).toBe(expected);
    }

    expect(matchPageRouteParams("/users/$id", "/users//")).toEqual({});
  });

  it("matches encoded and decoded Unicode static route segments", () => {
    expect(pageRoutePathMatches("/你好", "/%E4%BD%A0%E5%A5%BD")).toBe(true);
    expect(pageRoutePathMatches("/%E4%BD%A0%E5%A5%BD", "/你好")).toBe(true);
    expect(pageRoutePathMatches("/a%2Fb", "/a%2Fb")).toBe(true);
    expect(pageRoutePathMatches("/a%2Fb", "/a/b")).toBe(false);

    const decodedPattern = pageRoutePathToRegExp("/你好");
    expect(decodedPattern.test("/你好")).toBe(true);
    expect(decodedPattern.test("/%E4%BD%A0%E5%A5%BD")).toBe(true);
    expect(decodedPattern.test("/%e4%bd%a0%e5%a5%bd")).toBe(true);

    const encodedSlashPattern = pageRoutePathToRegExp("/a%2Fb");
    expect(encodedSlashPattern.test("/a%2Fb")).toBe(true);
    expect(encodedSlashPattern.test("/a%2fb")).toBe(true);
    expect(encodedSlashPattern.test("/a/b")).toBe(false);
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

  it("uses segment-wise specificity for crossing static and dynamic branches", () => {
    const routes = [
      { id: "dynamic-first", path: "/users/$identifier/profile" },
      { id: "static-first", path: "/users/x/$section" },
    ];

    expect(findBestPageRoute(routes, "/users/x/profile")?.id).toBe(
      "static-first",
    );
    expect(
      compareRoutePathsBySpecificity(routes[0].path, routes[1].path),
    ).toBeGreaterThan(0);
  });

  it("ignores parameter names until a later segment decides specificity", () => {
    const routes = [
      { id: "dynamic-tail", path: "/users/$a/$rest" },
      { id: "static-tail", path: "/users/$z/profile" },
    ];

    expect(findBestPageRoute(routes, "/users/x/profile")?.id).toBe(
      "static-tail",
    );
    expect(
      compareRoutePathsBySpecificity(routes[0].path, routes[1].path),
    ).toBeGreaterThan(0);
  });

  it("compares encoded static aliases before later route specificity", () => {
    const routes = [
      { id: "dynamic-tail", path: "/users/%61/$rest" },
      { id: "static-tail", path: "/users/a/profile" },
    ];

    expect(findBestPageRoute(routes, "/users/a/profile")?.id).toBe(
      "static-tail",
    );
    expect(
      compareRoutePathsBySpecificity(routes[0].path, routes[1].path),
    ).toBeGreaterThan(0);
  });

  it("continues after URL-equivalent static segments", () => {
    const routes = [
      { id: "encoded-wildcard", path: "/users/%61/$" },
      { id: "decoded-static", path: "/users/a/profile" },
    ];

    expect(findBestPageRoute(routes, "/users/a/profile")?.id).toBe(
      "decoded-static",
    );
    expect(
      findBestPageRoute([...routes].reverse(), "/users/a/profile")?.id,
    ).toBe("decoded-static");
    expect(
      compareRoutePathsBySpecificity(routes[0].path, routes[1].path),
    ).toBeGreaterThan(0);

    expect(compareRoutePathsBySpecificity("/a%2F/$", "/a/$")).not.toBe(0);
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
    expect(pageRoutePathShapeFromPath("/%75sers/$userId")).toBe(
      "/users/:param",
    );
    expect(pageRoutePathShapeFromPath("/a%2Fb/$id")).not.toBe(
      pageRoutePathShapeFromPath("/a/b/$id"),
    );
  });

  it("aligns regexp matching for encoded static aliases", () => {
    const users = pageRoutePathToRegExp("/users");
    expect(users.test("/%75sers")).toBe(true);
    expect(users.test("/u%73e%72s")).toBe(true);

    expect(pageRoutePathMatches("/files/%252F", "/files/%2F")).toBe(false);
    expect(pageRoutePathToRegExp("/files/%252F").test("/files/%2F")).toBe(
      false,
    );
    expect(pageRoutePathToRegExp("/files/a%2Fb").test("/files/a/b")).toBe(
      false,
    );
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

  it("parses page search params as strings and keeps the last repeated value", () => {
    expect(parsePageSearch("?q=hello+world&tag=a&tag=b&empty")).toEqual({
      q: "hello world",
      tag: "b",
      empty: "",
    });
  });

  it("parses page search params without invoking inherited setters", () => {
    const params = parsePageSearch(
      "?__proto__=polluted&__proto__=safe&constructor=value",
    );

    expect(Object.hasOwn(params, "__proto__")).toBe(true);
    expect(Reflect.get(params, "__proto__")).toBe("safe");
    expect(Reflect.get(params, "constructor")).toBe("value");
    expect(Object.getPrototypeOf(params)).toBe(Object.prototype);
  });
});
