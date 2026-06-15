import { describe, expect, it } from "vitest";
import {
  getServerRouteParamNameValidationError,
  getServerRouteParamSegmentValidationError,
  isReservedServerRouteParamName,
  serverRoutePathShapeFromPath,
} from "../src/index.js";

describe("server route data helpers", () => {
  it("validates unsafe server route param names", () => {
    expect(getServerRouteParamNameValidationError("")).toBe("empty");
    expect(getServerRouteParamNameValidationError("__proto__")).toBe(
      "reserved",
    );
    expect(getServerRouteParamNameValidationError("constructor")).toBe(
      "reserved",
    );
    expect(getServerRouteParamNameValidationError("prototype")).toBe(
      "reserved",
    );
    expect(getServerRouteParamNameValidationError("postId")).toBeUndefined();
    expect(isReservedServerRouteParamName("__proto__")).toBe(true);
    expect(isReservedServerRouteParamName("postId")).toBe(false);
    expect(getServerRouteParamSegmentValidationError("/users/:")).toEqual({
      segment: ":",
      name: "",
      error: "empty",
    });
    expect(getServerRouteParamSegmentValidationError("/users/:?")).toEqual({
      segment: ":?",
      name: "",
      error: "empty",
    });
    expect(
      getServerRouteParamSegmentValidationError("/users/:constructor"),
    ).toEqual({
      segment: ":constructor",
      name: "constructor",
      error: "reserved",
    });
    expect(
      getServerRouteParamSegmentValidationError("/users/:__proto__{[0-9]+}?"),
    ).toEqual({
      segment: ":__proto__{[0-9]+}?",
      name: "__proto__",
      error: "reserved",
    });
    expect(
      getServerRouteParamSegmentValidationError(
        "/users/:userId/posts/:userId{[0-9]+}",
      ),
    ).toEqual({
      segment: ":userId{[0-9]+}",
      name: "userId",
      error: "duplicate",
    });
    expect(
      getServerRouteParamSegmentValidationError("/users/:userId{[0-9]+}?"),
    ).toBeUndefined();
  });

  it("normalizes server route path shapes by Hono parameter position", () => {
    expect(serverRoutePathShapeFromPath("/api/users/:id")).toBe(
      "/api/users/:param",
    );
    expect(serverRoutePathShapeFromPath("/api/users/:userId")).toBe(
      "/api/users/:param",
    );
    expect(serverRoutePathShapeFromPath("/api/users/:id/details")).toBe(
      "/api/users/:param/details",
    );
    expect(serverRoutePathShapeFromPath("/api/users/$id")).toBe(
      "/api/users/$id",
    );
    expect(serverRoutePathShapeFromPath("/api//users/:id/")).toBe(
      "/api//users/:param/",
    );
  });
});
