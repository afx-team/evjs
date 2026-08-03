import { ServerError } from "@evjs/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createServerFunctionRegistry,
  type ServerFn,
  type ServerFunctionRegistry,
} from "../src/server-functions/registry.js";

describe("ServerFunctionRegistry.dispatch", () => {
  let serverFunctions: ServerFunctionRegistry;

  beforeEach(() => {
    serverFunctions = createServerFunctionRegistry();
  });

  const registerServerFunction = (fn: ServerFn, id: string) =>
    serverFunctions.register(id, fn);
  const dispatchServerFunction = (id: unknown, args: unknown) =>
    serverFunctions.dispatch(id, args);

  it("dispatches a registered function and returns result", async () => {
    registerServerFunction(async () => ({ users: ["Alice"] }), "fn1");

    const result = await dispatchServerFunction("fn1", []);
    expect(result).toEqual({ result: { users: ["Alice"] } });
  });

  it("dispatches a registered sync function", async () => {
    registerServerFunction(() => ({ ok: true }), "sync-fn");

    const result = await dispatchServerFunction("sync-fn", []);
    expect(result).toEqual({ result: { ok: true } });
  });

  it("passes arguments to the function", async () => {
    registerServerFunction(async (name: unknown) => `Hello ${name}`, "fn2");

    const result = await dispatchServerFunction("fn2", ["World"]);
    expect(result).toEqual({ result: "Hello World" });
  });

  it("preserves undefined server function results for HTTP serialization", async () => {
    registerServerFunction(async () => undefined, "void-fn");

    const result = await dispatchServerFunction("void-fn", []);
    expect(result).toEqual({ result: undefined });
    expect("result" in result).toBe(true);
  });

  it("returns 404 for unregistered function", async () => {
    const result = await dispatchServerFunction("nonexistent", []);
    expect(result).toEqual({
      error: 'Server function "nonexistent" not found',
      fnId: "nonexistent",
      status: 404,
    });
  });

  it("returns 400 for missing fnId", async () => {
    const result = await dispatchServerFunction("", []);
    expect(result).toEqual({
      error: "Missing or invalid 'fnId' in request body",
      fnId: "",
      status: 400,
    });
  });

  it("returns 400 for non-string fnId values from custom transports", async () => {
    const result = await dispatchServerFunction(42, []);
    expect(result).toEqual({
      error: "Missing or invalid 'fnId' in request body",
      fnId: "",
      status: 400,
    });
  });

  it("returns 400 for fnId with surrounding whitespace", async () => {
    registerServerFunction(async () => "ok", "fn1");

    const result = await dispatchServerFunction(" fn1 ", []);
    expect(result).toEqual({
      error: "Missing or invalid 'fnId' in request body",
      fnId: " fn1 ",
      status: 400,
    });
  });

  it("returns 400 for non-array args from custom transports", async () => {
    registerServerFunction(async () => "ok", "fn1");

    const result = await dispatchServerFunction("fn1", { name: "Ada" });
    expect(result).toEqual({
      error: "'args' must be an array",
      fnId: "fn1",
      status: 400,
    });
  });

  it("handles ServerError with status and data", async () => {
    registerServerFunction(async () => {
      throw new ServerError("Not found", { status: 404, data: { id: "123" } });
    }, "fn3");

    const result = await dispatchServerFunction("fn3", []);
    expect(result).toEqual({
      error: "Not found",
      fnId: "fn3",
      status: 404,
      data: { id: "123" },
    });
  });

  it("handles ServerError-compatible errors from another package copy", async () => {
    registerServerFunction(async () => {
      const error = new Error("Duplicate package conflict") as Error & {
        data: unknown;
        status: number;
      };
      error.name = "ServerError";
      error.status = 409;
      error.data = { resource: "project" };
      throw error;
    }, "fn3");

    const result = await dispatchServerFunction("fn3", []);
    expect(result).toEqual({
      error: "Duplicate package conflict",
      fnId: "fn3",
      status: 409,
      data: { resource: "project" },
    });
  });

  it("does not treat invalid ServerError-compatible statuses as structured errors", async () => {
    registerServerFunction(async () => {
      const error = new Error("Invalid status") as Error & { status: number };
      error.name = "ServerError";
      error.status = 302;
      throw error;
    }, "fn3");

    const result = await dispatchServerFunction("fn3", []);
    expect(result).toEqual({
      error: "Invalid status",
      fnId: "fn3",
      status: 500,
    });
  });

  it("handles invalid ServerError status construction as a generic error", async () => {
    registerServerFunction(async () => {
      throw new ServerError("Invalid status", { status: 200 });
    }, "fn3");

    const result = await dispatchServerFunction("fn3", []);
    expect(result).toEqual({
      error:
        "[evjs] ServerError status must be an integer HTTP error status between 400 and 599.",
      fnId: "fn3",
      status: 500,
    });
  });

  it("handles generic Error with 500 status", async () => {
    registerServerFunction(async () => {
      throw new Error("Something broke");
    }, "fn4");

    const result = await dispatchServerFunction("fn4", []);
    expect(result).toEqual({
      error: "Something broke",
      fnId: "fn4",
      status: 500,
    });
  });

  it("redacts generic Error messages in production", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    registerServerFunction(async () => {
      throw new Error("database password leaked");
    }, "fn4");

    try {
      const result = await dispatchServerFunction("fn4", []);
      expect(result).toEqual({
        error: "Internal server error",
        fnId: "fn4",
        status: 500,
      });
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
    }
  });

  it("handles generic Error messages when process is unavailable", async () => {
    const processDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "process",
    );
    Object.defineProperty(globalThis, "process", {
      configurable: true,
      value: undefined,
    });
    registerServerFunction(async () => {
      throw new Error("edge failure");
    }, "fn4");

    try {
      const result = await dispatchServerFunction("fn4", []);
      expect(result).toEqual({
        error: "edge failure",
        fnId: "fn4",
        status: 500,
      });
    } finally {
      if (processDescriptor) {
        Object.defineProperty(globalThis, "process", processDescriptor);
      } else {
        delete (globalThis as { process?: unknown }).process;
      }
    }
  });

  it("handles non-Error throws", async () => {
    registerServerFunction(async () => {
      throw "string error";
    }, "fn5");

    const result = await dispatchServerFunction("fn5", []);
    expect(result).toEqual({
      error: "string error",
      fnId: "fn5",
      status: 500,
    });
  });

  it("handles non-Error throws that cannot be stringified", async () => {
    registerServerFunction(async () => {
      throw {
        toString() {
          throw new Error("stringify failed");
        },
      };
    }, "fn5");

    const result = await dispatchServerFunction("fn5", []);
    expect(result).toEqual({
      error: "Unknown server function error",
      fnId: "fn5",
      status: 500,
    });
  });

  it("redacts non-Error throws in production", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    registerServerFunction(async () => {
      throw "database token leaked";
    }, "fn5");

    try {
      const result = await dispatchServerFunction("fn5", []);
      expect(result).toEqual({
        error: "Internal server error",
        fnId: "fn5",
        status: 500,
      });
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
    }
  });
});
