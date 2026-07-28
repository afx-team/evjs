import { describe, expect, it } from "vitest";
import {
  formatConcreteRuntimePathSegmentValidationError,
  getConcreteRuntimePathSegmentValidationError,
} from "../src/index.js";

describe("concrete runtime path segments", () => {
  it("accepts absolute base paths and relative endpoints with URL-safe ASCII segments", () => {
    expect(
      getConcreteRuntimePathSegmentValidationError("/__evjs/runtime-v1"),
    ).toBeUndefined();
    expect(
      getConcreteRuntimePathSegmentValidationError("__evjs/rsc~v1"),
    ).toBeUndefined();
  });

  it.each([
    "/",
    "//runtime",
    "/runtime/",
    "/./runtime",
    "/../runtime",
  ])("rejects empty and dot segments in %s", (value) => {
    expect(getConcreteRuntimePathSegmentValidationError(value)).toBeDefined();
  });

  it.each([
    "/运行时",
    "/%E8%BF%90%E8%A1%8C%E6%97%B6",
    "/runtime/:id",
  ])("rejects encoded, Unicode, and pattern segments in %s", (value) => {
    const error = getConcreteRuntimePathSegmentValidationError(value);
    expect(error).toBeDefined();
    if (!error) throw new Error(`Expected "${value}" to be rejected.`);
    expect(formatConcreteRuntimePathSegmentValidationError(error)).toContain(
      "ASCII URL-safe segments",
    );
  });
});
