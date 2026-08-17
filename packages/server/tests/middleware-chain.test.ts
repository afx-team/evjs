import { describe, expect, expectTypeOf, it } from "vitest";
import type { MiddlewareChain, MiddlewareHandler } from "../src/index.js";

describe("MiddlewareChain", () => {
  const first: MiddlewareHandler = async (_context, next) => next();
  const second: MiddlewareHandler = async (_context, next) => next();

  it("models an explicitly ordered non-empty middleware tuple", () => {
    const chain = [first, second] satisfies MiddlewareChain;

    expect(chain).toEqual([first, second]);
    expectTypeOf(chain).toMatchTypeOf<MiddlewareChain>();
  });

  it("statically rejects empty or non-callable chains", () => {
    // @ts-expect-error A middleware chain must contain at least one handler.
    const empty = [] satisfies MiddlewareChain;
    // @ts-expect-error Every middleware chain item must be callable.
    const invalid = [first, null] satisfies MiddlewareChain;

    expect(empty).toEqual([]);
    expect(invalid).toEqual([first, null]);
  });
});
