import { afterEach, describe, expect, it, vi } from "vitest";

describe("@evjs/server/fetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("exports a worker-compatible named fetch handler", async () => {
    const runtime = await import("../src/runtimes/fetch.js");

    expect(runtime.fetch).toBeTypeOf("function");
    expect(runtime.default).toEqual({ fetch: runtime.fetch });
  });

  it("does not inherit server functions from another app", async () => {
    vi.stubGlobal("__EVJS_FUNCTION_ENDPOINT__", "/api/rpc");
    const runtime = await import("../src/runtimes/fetch.js");
    const res = await runtime.fetch(
      new Request("http://localhost/api/rpc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fnId: "runtime-fetch-test",
          args: ["edge"],
        }),
      }),
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'Server function "runtime-fetch-test" not found',
      fnId: "runtime-fetch-test",
      status: 404,
    });
  });

  it.each([
    "__proto__",
    "constructor",
    "toString",
  ])("does not resolve an unowned prototype-shaped id %s", async (fnId) => {
    vi.stubGlobal("__EVJS_FUNCTION_ENDPOINT__", "/api/rpc");
    const runtime = await import("../src/runtimes/fetch.js");
    const response = await runtime.fetch(
      new Request("http://localhost/api/rpc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fnId, args: [] }),
      }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: `Server function "${fnId}" not found`,
      fnId,
      status: 404,
    });
  });
});
