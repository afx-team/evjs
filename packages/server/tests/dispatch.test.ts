import { ServerError } from "@evjs/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { dispatch } from "../src/functions/dispatch.js";
import {
  registerServerReference,
  registry,
} from "../src/functions/register.js";

describe("dispatch", () => {
  beforeEach(() => {
    registry.clear();
  });

  it("dispatches a registered function and returns result", async () => {
    registerServerReference(async () => ({ users: ["Alice"] }), "fn1");

    const result = await dispatch("fn1", []);
    expect(result).toEqual({ result: { users: ["Alice"] } });
  });

  it("passes arguments to the function", async () => {
    registerServerReference(async (name: unknown) => `Hello ${name}`, "fn2");

    const result = await dispatch("fn2", ["World"]);
    expect(result).toEqual({ result: "Hello World" });
  });

  it("returns 404 for unregistered function", async () => {
    const result = await dispatch("nonexistent", []);
    expect(result).toEqual({
      error: 'Server function "nonexistent" not found',
      fnId: "nonexistent",
      status: 404,
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
});
