import { expect, test } from "vitest";
import type { MiddlewareHandler } from "../src/index";
import { createRoute } from "../src/index";

test("createRoute() rejects broad string type at compile time", () => {
  // Real enforcement is via @ts-expect-error below — tsc --noEmit validates it.
  // This test ensures the file is a valid vitest suite.
  expect(typeof createRoute).toBe("function");
});

test("exports Hono-compatible middleware type", () => {
  const middleware: MiddlewareHandler = async (_ctx, next) => {
    await next();
  };

  expect(typeof middleware).toBe("function");
});

// ✅ Success: string literal path should compile
export const literalHandler = createRoute("/api/users", {
  GET: async () => Response.json({}),
});

// Test: Should fail if path is broad string
const path: string = "/dynamic";
export const dynamicHandler = createRoute(
  // @ts-expect-error — broad `string` type is not allowed, must be a string literal
  path,
  { GET: async () => Response.json({}) },
);
