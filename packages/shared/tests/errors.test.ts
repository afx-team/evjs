import { describe, expect, it } from "vitest";
import { ServerError, ServerFunctionError } from "../src/errors.js";

describe("ServerError", () => {
  it("creates with message and default status 500", () => {
    const err = new ServerError("Something failed");
    expect(err.message).toBe("Something failed");
    expect(err.name).toBe("ServerError");
    expect(err.status).toBe(500);
    expect(err.data).toBeUndefined();
  });

  it("creates with custom status", () => {
    const err = new ServerError("Not found", { status: 404 });
    expect(err.status).toBe(404);
  });

  it("creates with structured data", () => {
    const err = new ServerError("Validation failed", {
      status: 422,
      data: { field: "email", reason: "invalid" },
    });
    expect(err.status).toBe(422);
    expect(err.data).toEqual({ field: "email", reason: "invalid" });
  });

  it("is an instance of Error", () => {
    const err = new ServerError("test");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ServerError);
  });
});

describe("ServerFunctionError", () => {
  it("creates with message, fnId, and status", () => {
    const err = new ServerFunctionError("Call failed", "abc123", 500);
    expect(err.message).toBe("Call failed");
    expect(err.name).toBe("ServerFunctionError");
    expect(err.fnId).toBe("abc123");
    expect(err.status).toBe(500);
    expect(err.data).toBeUndefined();
  });

  it("creates with structured error data", () => {
    const err = new ServerFunctionError("Not found", "fn1", 404, {
      data: { userId: "42" },
    });
    expect(err.data).toEqual({ userId: "42" });
  });

  it("supports cause option", () => {
    const cause = new Error("original");
    const err = new ServerFunctionError("Wrapped", "fn1", 500, { cause });
    expect(err.cause).toBe(cause);
  });

  it("is an instance of Error", () => {
    const err = new ServerFunctionError("test", "fn1", 500);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ServerFunctionError);
  });
});
