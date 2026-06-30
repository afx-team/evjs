import { ServerError } from "@evjs/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { dispatch } from "../src/server-functions/dispatch.js";
import {
  registerServerReference,
  registry,
} from "../src/server-functions/register.js";

describe("dispatch", () => {
  beforeEach(() => {
    registry.clear();
  });

  it("dispatches a registered function and returns result", async () => {
    registerServerReference(async () => ({ users: ["Alice"] }), "fn1");

    const result = await dispatch("fn1", []);
    expect(result).toEqual({ result: { users: ["Alice"] } });
  });

  it("dispatches a registered sync function", async () => {
    registerServerReference(() => ({ ok: true }), "sync-fn");

    const result = await dispatch("sync-fn", []);
    expect(result).toEqual({ result: { ok: true } });
  });

  it("passes arguments to the function", async () => {
    registerServerReference(async (name: unknown) => `Hello ${name}`, "fn2");

    const result = await dispatch("fn2", ["World"]);
    expect(result).toEqual({ result: "Hello World" });
  });

  it("preserves undefined server function results for HTTP serialization", async () => {
    registerServerReference(async () => undefined, "void-fn");

    const result = await dispatch("void-fn", []);
    expect(result).toEqual({ result: undefined });
    expect("result" in result).toBe(true);
  });

  it("returns 404 for unregistered function", async () => {
    const result = await dispatch("nonexistent", []);
    expect(result).toEqual({
      error: 'Server function "nonexistent" not found',
      fnId: "nonexistent",
      status: 404,
    });
  });

  it("returns 500 for malformed registry entries", async () => {
    registry.set("fn1", "not a function" as never);

    const result = await dispatch("fn1", []);
    expect(result).toEqual({
      error: '[evjs] Server function "fn1" registry entry must be a function.',
      fnId: "fn1",
      status: 500,
    });
  });

  it("returns 400 for missing fnId", async () => {
    const result = await dispatch("", []);
    expect(result).toEqual({
      error: "Missing or invalid 'fnId' in request body",
      fnId: "",
      status: 400,
    });
  });

  it("returns 400 for non-string fnId values from custom transports", async () => {
    const result = await dispatch(42, []);
    expect(result).toEqual({
      error: "Missing or invalid 'fnId' in request body",
      fnId: "",
      status: 400,
    });
  });

  it("returns 400 for fnId with surrounding whitespace", async () => {
    registerServerReference(async () => "ok", "fn1");

    const result = await dispatch(" fn1 ", []);
    expect(result).toEqual({
      error: "Missing or invalid 'fnId' in request body",
      fnId: " fn1 ",
      status: 400,
    });
  });

  it("returns 400 for non-array args from custom transports", async () => {
    registerServerReference(async () => "ok", "fn1");

    const result = await dispatch("fn1", { name: "Ada" });
    expect(result).toEqual({
      error: "'args' must be an array",
      fnId: "fn1",
      status: 400,
    });
  });

  it("handles ServerError with status and data", async () => {
    registerServerReference(async () => {
      throw new ServerError("Not found", { status: 404, data: { id: "123" } });
    }, "fn3");

    const result = await dispatch("fn3", []);
    expect(result).toEqual({
      error: "Not found",
      fnId: "fn3",
      status: 404,
      data: { id: "123" },
    });
  });

  it("handles ServerError-compatible errors from another package copy", async () => {
    registerServerReference(async () => {
      const error = new Error("Duplicate package conflict") as Error & {
        data: unknown;
        status: number;
      };
      error.name = "ServerError";
      error.status = 409;
      error.data = { resource: "project" };
      throw error;
    }, "fn3");

    const result = await dispatch("fn3", []);
    expect(result).toEqual({
      error: "Duplicate package conflict",
      fnId: "fn3",
      status: 409,
      data: { resource: "project" },
    });
  });

  it("does not treat invalid ServerError-compatible statuses as structured errors", async () => {
    registerServerReference(async () => {
      const error = new Error("Invalid status") as Error & { status: number };
      error.name = "ServerError";
      error.status = 302;
      throw error;
    }, "fn3");

    const result = await dispatch("fn3", []);
    expect(result).toEqual({
      error: "Invalid status",
      fnId: "fn3",
      status: 500,
    });
  });

  it("handles invalid ServerError status construction as a generic error", async () => {
    registerServerReference(async () => {
      throw new ServerError("Invalid status", { status: 200 });
    }, "fn3");

    const result = await dispatch("fn3", []);
    expect(result).toEqual({
      error:
        "[evjs] ServerError status must be an integer HTTP error status between 400 and 599.",
      fnId: "fn3",
      status: 500,
    });
  });

  it("handles generic Error with 500 status", async () => {
    registerServerReference(async () => {
      throw new Error("Something broke");
    }, "fn4");

    const result = await dispatch("fn4", []);
    expect(result).toEqual({
      error: "Something broke",
      fnId: "fn4",
      status: 500,
    });
  });

  it("redacts generic Error messages in production", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    registerServerReference(async () => {
      throw new Error("database password leaked");
    }, "fn4");

    try {
      const result = await dispatch("fn4", []);
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
    registerServerReference(async () => {
      throw new Error("edge failure");
    }, "fn4");

    try {
      const result = await dispatch("fn4", []);
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
    registerServerReference(async () => {
      throw "string error";
    }, "fn5");

    const result = await dispatch("fn5", []);
    expect(result).toEqual({
      error: "string error",
      fnId: "fn5",
      status: 500,
    });
  });

  it("handles non-Error throws that cannot be stringified", async () => {
    registerServerReference(async () => {
      throw {
        toString() {
          throw new Error("stringify failed");
        },
      };
    }, "fn5");

    const result = await dispatch("fn5", []);
    expect(result).toEqual({
      error: "Unknown server function error",
      fnId: "fn5",
      status: 500,
    });
  });

  it("redacts non-Error throws in production", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    registerServerReference(async () => {
      throw "database token leaked";
    }, "fn5");

    try {
      const result = await dispatch("fn5", []);
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
