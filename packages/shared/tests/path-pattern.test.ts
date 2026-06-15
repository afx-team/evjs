import { describe, expect, it } from "vitest";
import {
  findBestPathPatternMatch,
  getPathPatternListValidationError,
  getPathPatternValidationError,
  isPathPattern,
  pathPatternMatches,
} from "../src/path-pattern.js";

describe("path pattern helpers", () => {
  it("accepts slash-prefixed path patterns without query, hash, or whitespace", () => {
    for (const value of ["/", "/*", "/crm/*", "/api/v1"]) {
      expect(isPathPattern(value)).toBe(true);
      expect(getPathPatternValidationError(value)).toBeUndefined();
    }
  });

  it("classifies invalid path pattern reasons", () => {
    expect(getPathPatternValidationError("")).toBe("empty");
    expect(getPathPatternValidationError(" ")).toBe("empty");
    expect(getPathPatternValidationError(null)).toBe("empty");
    expect(getPathPatternValidationError("/crm page/*")).toBe("whitespace");
    expect(getPathPatternValidationError("crm/*")).toBe(
      "missing-leading-slash",
    );
    expect(getPathPatternValidationError("/crm/*?preview=1")).toBe(
      "query-or-hash",
    );
    expect(getPathPatternValidationError("/crm/*#main")).toBe("query-or-hash");
  });

  it("classifies invalid path pattern list reasons", () => {
    expect(getPathPatternListValidationError("/crm/*")).toEqual({
      kind: "not-array",
    });
    expect(getPathPatternListValidationError([])).toEqual({
      kind: "empty-array",
    });
    expect(
      getPathPatternListValidationError([], { allowEmpty: true }),
    ).toBeUndefined();
    expect(getPathPatternListValidationError(["/crm/*", ""])).toEqual({
      kind: "invalid-pattern",
      value: "",
      error: "empty",
    });
    expect(getPathPatternListValidationError(["/crm/*", "/crm/*"])).toEqual({
      kind: "duplicate-pattern",
      pattern: "/crm/*",
    });
  });

  it("matches slash-star patterns as path segment prefixes", () => {
    expect(pathPatternMatches("/crm", "/crm/*")).toBe(true);
    expect(pathPatternMatches("/crm/customers", "/crm/*")).toBe(true);
    expect(pathPatternMatches("/crm-customers", "/crm/*")).toBe(false);
  });

  it("matches generic wildcard patterns against the whole pathname", () => {
    expect(pathPatternMatches("/assets/crm/v1", "/assets/*/v1")).toBe(true);
    expect(pathPatternMatches("/assets/crm/v2", "/assets/*/v1")).toBe(false);
  });

  it("prefers exact patterns over wildcard patterns", () => {
    expect(
      findBestPathPatternMatch("/crm/customers", ["/crm/*", "/crm/customers"])
        ?.pattern,
    ).toBe("/crm/customers");
  });

  it("prefers the most specific wildcard pattern", () => {
    expect(
      findBestPathPatternMatch("/app/crm/customers", ["/app/*", "/app/crm/*"])
        ?.pattern,
    ).toBe("/app/crm/*");
  });

  it("prefers fewer wildcards when specificity is otherwise equal", () => {
    expect(findBestPathPatternMatch("/ab", ["/*b", "/**b"])?.pattern).toBe(
      "/*b",
    );
  });

  it("uses lexical order as a deterministic final tie-breaker", () => {
    expect(
      findBestPathPatternMatch("/a/b/c", ["/*/b/c", "/a/*/c"])?.pattern,
    ).toBe("/*/b/c");
  });
});
