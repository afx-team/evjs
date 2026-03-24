import { beforeEach, describe, expect, it } from "vitest";
import { registerServerFn, registry, type ServerFn } from "../src/functions/register.js";

describe("registerServerFn", () => {
  beforeEach(() => {
    registry.clear();
  });

  it("registers a function by ID", () => {
    const fn: ServerFn = async () => "result";
    registerServerFn("test-fn", fn);
    expect(registry.get("test-fn")).toBe(fn);
  });

  it("overwrites an existing registration", () => {
    const fn1: ServerFn = async () => "first";
    const fn2: ServerFn = async () => "second";
    registerServerFn("fn", fn1);
    registerServerFn("fn", fn2);
    expect(registry.get("fn")).toBe(fn2);
  });

  it("supports multiple registrations", () => {
    registerServerFn("a", async () => "a");
    registerServerFn("b", async () => "b");
    registerServerFn("c", async () => "c");
    expect(registry.size).toBe(3);
  });

  it("returns undefined for unregistered ID", () => {
    expect(registry.get("missing")).toBeUndefined();
  });
});
