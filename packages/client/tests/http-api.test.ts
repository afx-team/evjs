import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { createApiClient } from "../src/http-api/client.js";
import { ApiError } from "../src/http-api/error.js";
import {
  createFrameworkApiClient,
  readApplicationTransport,
} from "../src/http-api/framework-runtime.js";
import type { ApiCall, ApiRequestOptions } from "../src/http-api/types.js";

afterEach(() => {
  delete globalThis.__EVJS_APP_TRANSPORTS__;
  vi.unstubAllGlobals();
});

describe("application HTTP client", () => {
  it.each([
    [undefined, "/health", "/health"],
    [
      "/gateway/version/",
      "/api/tasks?limit=2",
      "/gateway/version/api/tasks?limit=2",
    ],
    [
      "https://webgw.test/app/api/yuyan/id/version",
      "/api/tasks",
      "https://webgw.test/app/api/yuyan/id/version/api/tasks",
    ],
    [
      "https://api.test/prefix",
      "/api/index",
      "https://api.test/prefix/api/index",
    ],
    [
      "https://api.test/prefix",
      "/users/a%2Fb?name=a%20b",
      "https://api.test/prefix/users/a%2Fb?name=a%20b",
    ],
    [
      "https://api.test/prefix",
      "/../../health",
      "https://api.test/prefix/health",
    ],
  ])("preserves application paths with base %s", async (baseUrl, path, expected) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response());
    const api = createApiClient({ baseUrl, fetch });
    await api.get(path);
    expect(fetch.mock.calls[0][0]).toBe(expected);
  });

  it.each([
    "https://other.test/api",
    "//other.test/api",
    "relative",
    "/\\other.test",
    "/api\ntasks",
  ])("rejects non-application path %s", async (path) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(createApiClient({ fetch }).get(path)).rejects.toThrow(
      "API paths",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("snapshots defaults, merges headers, and forwards native options", async () => {
    const defaults = { "X-WebGW-Appid": "app-a", "X-Trace": "default" };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ id: "1" }));
    const api = createApiClient({
      headers: defaults,
      credentials: "include",
      fetch,
    });
    defaults["X-WebGW-Appid"] = "app-b";
    const controller = new AbortController();
    const call = api.post("/api/tasks", {
      json: { title: "demo" },
      signal: controller.signal,
      cache: "no-store",
      credentials: "omit",
      headers: [["x-trace", "request"]],
    });
    expect(call).toBeInstanceOf(Promise);
    const response = await call;
    expect(response.bodyUsed).toBe(false);
    await expect(call.json<{ id: string }>()).resolves.toEqual({ id: "1" });
    expect(fetch).toHaveBeenCalledTimes(1);
    const init = fetch.mock.calls[0][1];
    expect(init).toMatchObject({
      method: "POST",
      body: '{"title":"demo"}',
      credentials: "omit",
      signal: controller.signal,
      cache: "no-store",
    });
    expect(Object.fromEntries(new Headers(init?.headers))).toEqual({
      "content-type": "application/json",
      "x-webgw-appid": "app-a",
      "x-trace": "request",
    });
  });

  it("preserves HTTP errors until the JSON reader is used", async () => {
    const response = new Response("denied", { status: 403 });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
    const call = createApiClient({ baseUrl: "https://api.test", fetch }).get(
      "/health",
    );
    expect(await call).toBe(response);
    await expect(call.json()).rejects.toMatchObject({
      name: "ApiError",
      response,
      status: 403,
      url: "https://api.test/health",
    });
    expect(response.bodyUsed).toBe(false);
    expect(await response.text()).toBe("denied");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reports non-JSON responses without consuming the body", async () => {
    const response = new Response("<html>login</html>", {
      headers: { "content-type": "text/html" },
    });
    const api = createApiClient({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(response),
    });
    await expect(api.get("/health").json()).rejects.toBeInstanceOf(ApiError);
    expect(response.bodyUsed).toBe(false);
  });

  it("accepts JSON media types and forwards malformed JSON errors", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response('{"ok":true}', {
          headers: {
            "content-type": "application/problem+json; charset=utf-8",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response("{", { headers: { "content-type": "application/json" } }),
      );
    const api = createApiClient({ fetch });
    await expect(api.get("/health").json()).resolves.toEqual({ ok: true });
    await expect(api.get("/health").json()).rejects.toBeInstanceOf(SyntaxError);
  });

  it("forwards raw bodies and never retries failures", async () => {
    const error = new TypeError("network unavailable");
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(error);
    const body = new Uint8Array([1, 2]);
    await expect(
      createApiClient({ fetch }).put("/upload", { body }),
    ).rejects.toBe(error);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]?.body).toBe(body);
  });

  it("rejects json/body conflicts before fetching", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const api = createApiClient({ fetch });
    // @ts-expect-error Shared request options forbid two body representations.
    const call = api.post("/api/tasks", { json: {}, body: "raw" });
    await expect(call).rejects.toThrow("mutually exclusive");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("has basic request types without a generated API contract", () => {
    expectTypeOf<ApiCall>().toExtend<Promise<Response>>();
    expectTypeOf<ReturnType<ApiCall["json"]>>().toEqualTypeOf<
      Promise<unknown>
    >();
    expectTypeOf<{ method: string }>().not.toExtend<ApiRequestOptions>();
  });

  it("reads an SSE chunk before completion and cancels a native fetch stream", async () => {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests++;
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write("data: first\n\n");
      // Deliberately leave the response open until the client aborts.
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const api = createApiClient({
        baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/deployment`,
      });
      const controller = new AbortController();
      const response = await api.post("/events", {
        json: { task: "demo" },
        signal: controller.signal,
      });
      expect(response.bodyUsed).toBe(false);
      if (!response.body) throw new Error("Expected an SSE body");
      const reader = response.body.getReader();
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toBe("data: first\n\n");
      controller.abort();
      await expect(reader.read()).rejects.toMatchObject({ name: "AbortError" });
      expect(requests).toBe(1);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});

describe("application-scoped HTTP transport", () => {
  it("rejects configuration failures through the request promise before fetching", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetch);
    const api = createFrameworkApiClient(
      { buildId: "build", applicationId: "app" },
      {},
      () => {
        throw new Error("Missing application WebGW transport");
      },
    );
    const request = api.get("/health");
    expect(request).toBeInstanceOf(Promise);
    await expect(request.json()).rejects.toThrow(
      "Missing application WebGW transport",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("isolates two builds and captures deployment, application, and request settings", async () => {
    const scopeA = { buildId: "build-a", applicationId: "app" };
    const scopeB = { buildId: "build-b", applicationId: "app" };
    const key = (scope: typeof scopeA) =>
      JSON.stringify([scope.buildId, scope.applicationId]);
    globalThis.__EVJS_APP_TRANSPORTS__ = {
      [key(scopeA)]: {
        baseUrl: "https://a.test/version",
        credentials: "include",
        headers: { "x-gateway": "a", "x-custom": "deployment" },
      },
      [key(scopeB)]: {
        baseUrl: "https://b.test/version",
        headers: { "x-gateway": "b" },
      },
    };
    vi.stubGlobal("__EVJS_TRANSPORT__", { baseUrl: "https://wrong.test" });
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    const apiA = createFrameworkApiClient(scopeA, {
      headers: { "X-Custom": "application" },
    });
    const apiB = createFrameworkApiClient(scopeB);
    globalThis.__EVJS_APP_TRANSPORTS__[key(scopeA)] = {
      baseUrl: "https://changed.test",
    };
    await apiA.get("/health");
    await apiB.get("/health");
    await apiA.get("/health", { headers: { "X-Custom": "request" } });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://a.test/version/health",
      "https://b.test/version/health",
      "https://a.test/version/health",
    ]);
    expect(fetch.mock.calls[0][1]?.credentials).toBe("include");
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get("x-custom")).toBe(
      "application",
    );
    expect(new Headers(fetch.mock.calls[2][1]?.headers).get("x-custom")).toBe(
      "request",
    );
  });

  it("honors explicit application baseUrl and never uses legacy global defaults", async () => {
    vi.stubGlobal("__EVJS_TRANSPORT__", { baseUrl: "https://wrong.test" });
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response());
    vi.stubGlobal("fetch", fetch);
    const scope = { buildId: "build", applicationId: "app" };
    expect(readApplicationTransport(scope)).toBeUndefined();
    await createFrameworkApiClient(scope).get("/health");
    await createFrameworkApiClient(scope, {
      baseUrl: "https://explicit.test",
    }).get("/health");
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "/health",
      "https://explicit.test/health",
    ]);
  });
});
