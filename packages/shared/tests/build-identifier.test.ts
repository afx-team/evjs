import { describe, expect, it } from "vitest";
import {
  BUILD_IDENTIFIER_DESCRIPTION,
  isBuildIdentifier,
} from "../src/build-identifier.js";

describe("build identifier helpers", () => {
  it("accepts package-safe build identifiers", () => {
    for (const value of ["default", "crm_2026", "widget-app", "A1_b-2"]) {
      expect(isBuildIdentifier(value)).toBe(true);
    }
  });

  it("rejects empty, whitespace, dotted, slash, and non-string values", () => {
    for (const value of [
      "",
      " ",
      " crm ",
      "build.1",
      "crm/main",
      "crm main",
      null,
      42,
    ]) {
      expect(isBuildIdentifier(value)).toBe(false);
    }
  });

  it("keeps the user-facing rule description stable", () => {
    expect(BUILD_IDENTIFIER_DESCRIPTION).toBe(
      "letters, numbers, underscores, or hyphens",
    );
  });
});
