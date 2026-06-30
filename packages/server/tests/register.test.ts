import { beforeEach, describe, expect, it } from "vitest";
import {
  registerServerReference,
  registry,
  type ServerFn,
} from "../src/server-functions/register.js";

describe("registerServerReference", () => {
  beforeEach(() => {
    registry.clear();
  });

  it("registers a function by ID", () => {
    const fn: ServerFn = async () => "result";
    registerServerReference(fn, "test-fn");
    expect(registry.get("test-fn")).toBe(fn);
  });

  it("registers sync functions by ID", () => {
    const fn: ServerFn = () => "result";
    registerServerReference(fn, "sync-fn");
    expect(registry.get("sync-fn")).toBe(fn);
  });

  it("rejects invalid registrations", () => {
    const invalidFnIdError =
      "[evjs] registerServerReference() fnId must be a non-empty string without leading or trailing whitespace.";

    expect(() =>
      registerServerReference("not a function" as unknown as ServerFn, "bad"),
    ).toThrow("[evjs] registerServerReference() fn must be a function.");

    expect(() =>
      registerServerReference(async () => "result", 1 as unknown as string),
    ).toThrow(invalidFnIdError);

    expect(() => registerServerReference(async () => "result", "")).toThrow(
      invalidFnIdError,
    );

    expect(() => registerServerReference(async () => "result", "   ")).toThrow(
      invalidFnIdError,
    );

    expect(() => registerServerReference(async () => "result", " fn")).toThrow(
      invalidFnIdError,
    );

    expect(() => registerServerReference(async () => "result", "fn ")).toThrow(
      invalidFnIdError,
    );
  });

  it("rejects invalid generated export name metadata", () => {
    const invalidExportNameError =
      "[evjs] registerServerReference() exportName must be a non-empty string without leading or trailing whitespace.";

    expect(() =>
      registerServerReference(async () => "result", "fn", ""),
    ).toThrow(invalidExportNameError);

    expect(() =>
      registerServerReference(async () => "result", "fn", " exportName"),
    ).toThrow(invalidExportNameError);

    expect(() =>
      registerServerReference(async () => "result", "fn", "exportName "),
    ).toThrow(invalidExportNameError);

    expect(registry.size).toBe(0);
  });

  it("rejects duplicate registrations", () => {
    const fn1: ServerFn = async () => "first";
    const fn2: ServerFn = async () => "second";
    registerServerReference(fn1, "fn");
    expect(() => registerServerReference(fn2, "fn")).toThrow(
      '[evjs] registerServerReference() duplicate fnId "fn". Server function IDs must be unique.',
    );
    expect(registry.get("fn")).toBe(fn1);
  });

  it("supports multiple registrations", () => {
    registerServerReference(async () => "a", "a");
    registerServerReference(async () => "b", "b");
    registerServerReference(async () => "c", "c");
    expect(registry.size).toBe(3);
  });

  it("returns undefined for unregistered ID", () => {
    expect(registry.get("missing")).toBeUndefined();
  });
});
