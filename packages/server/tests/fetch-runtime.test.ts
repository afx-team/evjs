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

  it("serves the generated server function endpoint", async () => {
    vi.stubGlobal("__EVJS_FUNCTION_ENDPOINT__", "/api/rpc");
    const { registerServerReference } = await import(
      "../src/server-functions/register.js"
    );

    registerServerReference(
      (...args: unknown[]) => `hello ${String(args[0])}`,
      "runtime-fetch-test",
    );

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

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: "hello edge" });
  });
});
