import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config/resolution.js";

describe("build filesystem root configuration", () => {
  it("keeps root discovery implicit by default", () => {
    expect(resolveConfig({})).not.toHaveProperty("rootPath");
  });

  it("preserves an explicit root for adapter resolution relative to the application", () => {
    expect(resolveConfig({ rootPath: "../.." })).toHaveProperty(
      "rootPath",
      "../..",
    );
  });

  it.each([
    "",
    " ",
    1,
    null,
    {},
  ])("rejects an invalid rootPath: %j", (rootPath) => {
    expect(() => resolveConfig({ rootPath } as never)).toThrow(
      "rootPath must be a non-empty string",
    );
  });
});
