import { expect, test } from "vitest";
import { createAppRootRoute } from "../src/context";
import { createRoute } from "../src/route";

test("createRoute() rejects broad string type at compile time", () => {
  // Real enforcement is via @ts-expect-error below — tsc --noEmit validates it.
  // This test ensures the file is a valid vitest suite.
  expect(typeof createRoute).toBe("function");
});

const rootRoute = createAppRootRoute({
  component: () => null,
});

// ✅ Success: string literal path should compile
export const literalRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/users",
  component: () => null,
});

// Test: Should fail if path is broad string
const path: string = "/dynamic";
export const dynamicRoute = createRoute({
  getParentRoute: () => rootRoute,
  // @ts-expect-error — broad `string` type is not allowed, must be a string literal
  path: path,
  component: () => null,
});
