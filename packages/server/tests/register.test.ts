import { beforeEach, describe, expect, it } from "vitest";
import {
  registerServerReference,
  registry,
  type ServerFn,
} from "../src/functions/register.js";

describe("registerServerReference", () => {
  beforeEach(() => {
    registry.clear();
  });

  it("registers a function by ID", () => {
    const fn: ServerFn = async () => "result";
    registerServerReference(fn, "test-fn");
    expect(registry.get("test-fn")).toBe(fn);
  });

  it("overwrites an existing registration", () => {
    const fn1: ServerFn = async () => "first";
    const fn2: ServerFn = async () => "second";
    registerServerReference(fn1, "fn");
    registerServerReference(fn2, "fn");
    expect(registry.get("fn")).toBe(fn2);
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
