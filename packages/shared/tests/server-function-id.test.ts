import { describe, expect, it } from "vitest";
import {
  assertServerFunctionExportName,
  assertServerFunctionId,
  getRequestFnId,
  isServerFunctionExportName,
  isServerFunctionId,
} from "../src/server-function-id.js";

describe("server function ID helpers", () => {
  it("accepts non-empty IDs without surrounding whitespace", () => {
    expect(isServerFunctionId("mod:getUser")).toBe(true);
    expect(isServerFunctionId("hash-123")).toBe(true);
    expect(() =>
      assertServerFunctionId("mod:getUser", "createServerReference()"),
    ).not.toThrow();
  });

  it("rejects missing, non-string, and whitespace-padded IDs", () => {
    const message =
      "[evjs] callServer() fnId must be a non-empty string without leading or trailing whitespace.";

    for (const value of ["", " fn", "fn ", "   ", 42, null, undefined]) {
      expect(isServerFunctionId(value)).toBe(false);
      expect(() => assertServerFunctionId(value, "callServer()")).toThrow(
        message,
      );
    }
  });

  it("preserves raw string request IDs for error payloads only", () => {
    expect(getRequestFnId(" fn ")).toBe(" fn ");
    expect(getRequestFnId(42)).toBe("");
  });

  it("validates server function export names for generated registration metadata", () => {
    expect(isServerFunctionExportName("getUser")).toBe(true);
    expect(isServerFunctionExportName("save-user")).toBe(true);
    expect(() =>
      assertServerFunctionExportName("save-user", "registerServerReference()"),
    ).not.toThrow();

    const message =
      "[evjs] registerServerReference() exportName must be a non-empty string without leading or trailing whitespace.";

    for (const value of ["", " save", "save ", "   ", 42, null, undefined]) {
      expect(isServerFunctionExportName(value)).toBe(false);
      expect(() =>
        assertServerFunctionExportName(value, "registerServerReference()"),
      ).toThrow(message);
    }
  });
});
