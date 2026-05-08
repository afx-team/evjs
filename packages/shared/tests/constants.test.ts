import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ENDPOINT, getFunctionEndpoint } from "../src/constants.js";

describe("getFunctionEndpoint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("falls back to the default endpoint without a build-time define", () => {
    expect(getFunctionEndpoint()).toBe(DEFAULT_ENDPOINT);
  });

  it("uses the process env endpoint define when present", () => {
    vi.stubEnv("EVJS_FUNCTION_ENDPOINT", "/api/rpc");

    expect(getFunctionEndpoint()).toBe("/api/rpc");
  });

  it("uses the build-time endpoint define when present", () => {
    vi.stubGlobal("__EVJS_FUNCTION_ENDPOINT__", "/api/rpc");

    expect(getFunctionEndpoint()).toBe("/api/rpc");
  });
});
