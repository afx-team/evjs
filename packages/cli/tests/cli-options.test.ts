import { describe, expect, it } from "vitest";
import { parseCliFlags } from "../src/program/options.js";

describe("CLI options", () => {
  it("collects multiple plugin flags from command arguments", () => {
    expect({ ...parseCliFlags(["--mock", "--coverage"]) }).toEqual({
      mock: true,
      coverage: true,
    });
  });

  it("isolates prototype-shaped names and preserves negative values", () => {
    const flags = parseCliFlags([
      "--to-string=first",
      "--to-string=second",
      "--__proto__=safe",
      "--threshold",
      "-1",
    ]);

    expect(Object.getPrototypeOf(flags)).toBeNull();
    expect(Object.hasOwn(flags, "toString")).toBe(true);
    expect(Object.hasOwn(flags, "__proto__")).toBe(true);
    expect(Reflect.get(flags, "toString")).toEqual(["first", "second"]);
    expect(Reflect.get(flags, "__proto__")).toBe("safe");
    expect(flags.threshold).toBe("-1");
  });
});
