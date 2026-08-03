import { describe, expect, it } from "vitest";
import * as serverRuntime from "../src/index.js";
import {
  createServerFunctionRegistry,
  type ServerFn,
} from "../src/server-functions/registry.js";

describe("createServerFunctionRegistry", () => {
  it("keeps the public registry type factory-owned", () => {
    const assertNominalContract = () => {
      const structuralRegistry = {
        async dispatch() {
          return { result: undefined };
        },
        register() {},
      };
      // @ts-expect-error A structural lookalike is not a factory-owned registry.
      const registry: serverRuntime.ServerFunctionRegistry = structuralRegistry;
      return registry;
    };

    expect(assertNominalContract).toBeTypeOf("function");
  });

  it("is the only public registration and dispatch surface", () => {
    expect(serverRuntime.createServerFunctionRegistry).toBe(
      createServerFunctionRegistry,
    );
    expect(serverRuntime).not.toHaveProperty("registerServerReference");
    expect(serverRuntime).not.toHaveProperty("dispatch");
  });

  it("registers async and sync functions by id", async () => {
    const serverFunctions = createServerFunctionRegistry();
    serverFunctions.register("async-fn", async () => "async");
    serverFunctions.register("sync-fn", () => "sync");

    await expect(serverFunctions.dispatch("async-fn", [])).resolves.toEqual({
      result: "async",
    });
    await expect(serverFunctions.dispatch("sync-fn", [])).resolves.toEqual({
      result: "sync",
    });
  });

  it("rejects invalid registrations", () => {
    const serverFunctions = createServerFunctionRegistry();
    const invalidIdError =
      "[evjs] serverFunctions.register() id must be a non-empty string without leading or trailing whitespace.";

    expect(() =>
      serverFunctions.register("bad", "not a function" as unknown as ServerFn),
    ).toThrow("[evjs] serverFunctions.register() fn must be a function.");
    expect(() =>
      serverFunctions.register(1 as unknown as string, async () => "result"),
    ).toThrow(invalidIdError);
    expect(() => serverFunctions.register("", async () => "result")).toThrow(
      invalidIdError,
    );
    expect(() => serverFunctions.register("   ", async () => "result")).toThrow(
      invalidIdError,
    );
    expect(() => serverFunctions.register(" fn", async () => "result")).toThrow(
      invalidIdError,
    );
    expect(() => serverFunctions.register("fn ", async () => "result")).toThrow(
      invalidIdError,
    );
  });

  it("rejects duplicate ids without replacing the first function", async () => {
    const serverFunctions = createServerFunctionRegistry();
    serverFunctions.register("fn", async () => "first");

    expect(() => serverFunctions.register("fn", async () => "second")).toThrow(
      '[evjs] serverFunctions.register() duplicate id "fn". Server function IDs must be unique within one app.',
    );
    await expect(serverFunctions.dispatch("fn", [])).resolves.toEqual({
      result: "first",
    });
  });

  it.each([
    "__proto__",
    "constructor",
    "toString",
  ])("supports and deduplicates the prototype-shaped id %s", async (id) => {
    const serverFunctions = createServerFunctionRegistry();
    serverFunctions.register(id, async () => "first");

    expect(() => serverFunctions.register(id, async () => "duplicate")).toThrow(
      `[evjs] serverFunctions.register() duplicate id "${id}". Server function IDs must be unique within one app.`,
    );
    await expect(serverFunctions.dispatch(id, [])).resolves.toEqual({
      result: "first",
    });
  });

  it("returns 404 for an id not owned by the registry", async () => {
    const serverFunctions = createServerFunctionRegistry();

    await expect(serverFunctions.dispatch("missing", [])).resolves.toEqual({
      error: 'Server function "missing" not found',
      fnId: "missing",
      status: 404,
    });
  });
});
