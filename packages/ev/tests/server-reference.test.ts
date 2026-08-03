import { describe, expect, it, vi } from "vitest";
import {
  getServerReferenceId,
  registerServerReference,
} from "../src/_internal/generated/server/server-reference.js";

describe("Utoopack server reference bridge", () => {
  it("records weak transform metadata by function and export name", () => {
    const reference = vi.fn(async (value: string) => `value:${value}`);

    expect(
      registerServerReference(reference, "native-get", "getValue"),
    ).toBeUndefined();
    registerServerReference(reference, "native-save", "saveValue");

    expect(getServerReferenceId(reference, "getValue")).toBe("native-get");
    expect(getServerReferenceId(reference, "saveValue")).toBe("native-save");
    expect(getServerReferenceId(reference, "missing")).toBeUndefined();
    expect(getServerReferenceId(vi.fn(), "getValue")).toBeUndefined();
  });

  it("accepts an idempotent transform registration", () => {
    const reference = vi.fn();

    registerServerReference(reference, "native-id", "run");

    expect(() =>
      registerServerReference(reference, "native-id", "run"),
    ).not.toThrow();
  });

  it("rejects conflicting action IDs for one transformed export", () => {
    const reference = vi.fn();
    registerServerReference(reference, "first-id", "run");

    expect(() =>
      registerServerReference(reference, "second-id", "run"),
    ).toThrow(
      '[evjs] Utoopack registered server export "run" with conflicting action IDs "first-id" and "second-id".',
    );
  });

  it("rejects malformed transform metadata instead of skipping aliases", () => {
    const reference = vi.fn();

    expect(() => registerServerReference(reference, "", "run")).toThrow(
      "[evjs] registerServerReference() fnId must be a non-empty string without leading or trailing whitespace.",
    );
    expect(() =>
      registerServerReference(reference, "native-id", " run "),
    ).toThrow(
      "[evjs] registerServerReference() exportName must be a non-empty string without leading or trailing whitespace.",
    );
  });
});
