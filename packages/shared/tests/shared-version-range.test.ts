import { describe, expect, it } from "vitest";
import {
  getSharedVersionRangeValidationError,
  isSharedVersionRange,
  SHARED_VERSION_RANGE_DESCRIPTION,
} from "../src/index.js";

describe("shared version range helpers", () => {
  it("accepts shared dependency version range forms", () => {
    for (const value of [
      "*",
      "19",
      "19.2",
      "19.2.5",
      "v19.2.5",
      "19.2.5-canary.1",
      "^19.0.0",
      "~19.2.0",
      ">=18 <20",
      "^18.0.0 || ^19.0.0",
    ]) {
      expect(isSharedVersionRange(value)).toBe(true);
      expect(getSharedVersionRangeValidationError(value)).toBeUndefined();
    }
  });

  it("classifies unsupported or malformed ranges", () => {
    expect(getSharedVersionRangeValidationError("")).toBe("empty");
    expect(getSharedVersionRangeValidationError(null)).toBe("empty");
    expect(getSharedVersionRangeValidationError(" ^19.0.0")).toBe("whitespace");

    for (const value of [
      "latest",
      "^",
      ">=",
      "=>19",
      "^18 ||",
      "|| ^19",
      "^18 || || ^19",
      "19.x",
      "19.2.5.1",
    ]) {
      expect(getSharedVersionRangeValidationError(value)).toBe("invalid-range");
      expect(isSharedVersionRange(value)).toBe(false);
    }
  });

  it("keeps the user-facing rule description stable", () => {
    expect(SHARED_VERSION_RANGE_DESCRIPTION).toBe(
      'supported version range syntax (examples: "19", "^19.0.0", ">=18 <20", or "^18 || ^19")',
    );
  });
});
