import { describe, expect, expectTypeOf, it } from "vitest";
import type { MiddlewareChain, MiddlewareHandler } from "../src/index.js";
import { normalizeMiddleware } from "../src/middleware/middleware-chain.js";
import { withMiddlewares } from "../src/routes/api-handler.js";

describe("MiddlewareChain", () => {
  const first: MiddlewareHandler = async (_context, next) => next();
  const second: MiddlewareHandler = async (_context, next) => next();

  it("models an explicitly ordered non-empty middleware tuple", () => {
    const chain = [first, second] satisfies MiddlewareChain;

    expect(chain).toEqual([first, second]);
    expectTypeOf(chain).toMatchTypeOf<MiddlewareChain>();
    expectTypeOf<MiddlewareChain>().toEqualTypeOf<
      readonly [MiddlewareHandler, ...MiddlewareHandler[]]
    >();
  });

  it("statically rejects empty or non-callable chains", () => {
    // @ts-expect-error A middleware chain must contain at least one handler.
    const empty = [] satisfies MiddlewareChain;
    // @ts-expect-error Every middleware chain item must be callable.
    const invalid = [first, null] satisfies MiddlewareChain;

    expect(empty).toEqual([]);
    expect(invalid).toEqual([first, null]);
  });

  it.each(
    [
      [],
      null,
      false,
      {},
      function* generator() {
        yield 1;
      },
      async function* asyncGenerator() {
        yield 1;
      },
      class InvalidMiddleware {},
    ].map((value) => [value]),
  )("rejects invalid resolved exports (%s)", (value) => {
    expect(() =>
      normalizeMiddleware(value, "src/apis/middleware.ts default export"),
    ).toThrow(
      "src/apis/middleware.ts default export must be a middleware function or a non-empty array",
    );
    expect(() => withMiddlewares(() => new Response(), value as never)).toThrow(
      "withMiddlewares() middlewares must be a middleware function or a non-empty array",
    );
  });

  it.each(
    [
      [first, null],
      [first, [second]],
      [first, ...Array(1)],
    ].map((value) => [value]),
  )("reports the source and zero-based index of invalid entries", (value) => {
    expect(() =>
      normalizeMiddleware(value, "src/apis/middleware.ts default export"),
    ).toThrow(
      "src/apis/middleware.ts default export[1] must be a middleware function.",
    );
  });

  it("validates sparse lists and resolved empty factory results", () => {
    const factory = () => [];
    expect(() =>
      normalizeMiddleware(factory(), "factory default export"),
    ).toThrow("non-empty array");
    expect(() =>
      normalizeMiddleware(Array(2), "sparse default export"),
    ).toThrow("sparse default export[0]");
  });

  it("keeps conditional global middleware factories compatible", () => {
    const factory = () => [];
    expect(
      normalizeMiddleware(factory(), "global factory default export", {
        allowEmpty: true,
      }),
    ).toEqual([]);
  });
});
