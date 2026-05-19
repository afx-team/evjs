import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetForTesting,
  callServer,
  createServerReference,
  getFnId,
  getFnName,
  initTransport,
  type ServerFunction,
  type TransportOptions,
} from "../src/transport.js";

const REQUEST_CONTEXT_KEY = Symbol.for("evjs.transport.requestContext");

type StoredRequestContext = {
  baseUrl?: string;
  headers?: HeadersInit;
  signal?: AbortSignal;
};

function setStoredRequestContext(context: StoredRequestContext): void {
  (globalThis as unknown as Record<symbol, unknown>)[REQUEST_CONTEXT_KEY] = {
    getStore: () => context,
  };
}

afterEach(() => {
  delete (globalThis as unknown as Record<symbol, unknown>)[
    REQUEST_CONTEXT_KEY
  ];
});

describe("createServerReference / getFnId / getFnName", () => {
  beforeEach(() => {
    __resetForTesting();
  });

  it("creates a function and retrieves its ID", () => {
    const fn = createServerReference("test-id", "testFn");
    expect(getFnId(fn as never)).toBe("test-id");
  });

  it("retrieves the export name from fnId", () => {
    createServerReference("abc:myFn", "myFn");
    expect(getFnName("abc:myFn")).toBe("myFn");
  });

  it("returns fnId as fallback when no name registered", () => {
    expect(getFnName("unknown-id")).toBe("unknown-id");
  });

  it("returns undefined for unregistered function", () => {
    const fn = async () => {};
    expect(getFnId(fn)).toBeUndefined();
  });

  it("handles creation without export name", () => {
    const fn = createServerReference("no-name");
    expect(getFnId(fn as never)).toBe("no-name");
    expect(getFnName("no-name")).toBe("no-name"); // fallback
  });
});

describe("ServerFunction metadata (.queryKey, .fnId, .fnName)", () => {
  beforeEach(() => {
    __resetForTesting();
  });

  it("attaches .fnId and .fnName on creation", () => {
    const fn = createServerReference("abc123", "getUsers");
    expect(fn.fnId).toBe("abc123");
    expect(fn.fnName).toBe("getUsers");
  });

  it("makes .fnId and .fnName read-only", () => {
    const fn = createServerReference("abc123", "getUsers");

    expect(() => {
      (fn as unknown as { fnId: string }).fnId = "changed";
    }).toThrow();
    expect(() => {
      (fn as unknown as { fnName: string }).fnName = "changed";
    }).toThrow();
  });

  it("falls back .fnName to fnId when no export name given", () => {
    const fn = createServerReference("hash-only");
    expect(fn.fnName).toBe("hash-only");
  });

  it("attaches .queryKey() that returns [fnId]", () => {
    const fn = createServerReference("mod:getUsers", "getUsers");
    expect(fn.queryKey()).toEqual(["mod:getUsers"]);
  });

  it(".queryKey() includes args", () => {
    const fn = createServerReference("mod:getUser", "getUser");
    expect(fn.queryKey("abc")).toEqual(["mod:getUser", "abc"]);
    expect(fn.queryKey("abc", 42)).toEqual(["mod:getUser", "abc", 42]);
  });

  it("attaches .queryOptions() that returns TanStack { queryKey, queryFn }", async () => {
    const send = vi.fn().mockResolvedValue("test result");
    initTransport({ adapter: { send } });

    const fn = createServerReference(
      "mod:getUser",
      "getUser",
    ) as ServerFunction<[string], unknown>;
    const opts = fn.queryOptions("abc");

    expect(opts.queryKey).toEqual(["mod:getUser", "abc"]);

    // Check queryFn uses callServer properly
    const signal = new AbortController().signal;
    const result = await opts.queryFn({ signal });
    expect(send).toHaveBeenCalledWith(
      "mod:getUser",
      ["abc"],
      expect.objectContaining({ signal }),
    );
    expect(result).toBe("test result");
  });
});

describe("initTransport + callServer", () => {
  beforeEach(() => {
    __resetForTesting();
  });

  it("calls custom adapter.send with fnId and args", async () => {
    const send = vi.fn().mockResolvedValue({ greeting: "hello" });
    initTransport({ adapter: { send } });

    const result = await callServer("fn1", ["arg1", "arg2"]);

    expect(send).toHaveBeenCalledWith("fn1", ["arg1", "arg2"], undefined);
    expect(result).toEqual({ greeting: "hello" });
  });

  it("keeps HTTP request defaults out of custom adapter context", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    initTransport({
      baseUrl: "https://api.example.com/backend",
      credentials: "include",
      headers: { Authorization: "Bearer xyz" },
      functions: { endpoint: "api/rpc" },
      adapter: { send },
    });

    const signal = new AbortController().signal;
    await callServer("fn1", [], { signal });

    const context = send.mock.calls[0]?.[2];
    expect(send).toHaveBeenCalledWith(
      "fn1",
      [],
      expect.objectContaining({
        signal,
      }),
    );
    expect(context).not.toHaveProperty("url");
    expect(context).not.toHaveProperty("request");
  });

  it("passes context through to adapter", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    initTransport({ adapter: { send } });

    const signal = new AbortController().signal;
    await callServer("fn2", [], { signal });

    expect(send).toHaveBeenCalledWith(
      "fn2",
      [],
      expect.objectContaining({ signal }),
    );
  });

  it("keeps request-scoped SSR context out of custom adapters", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    initTransport({ adapter: { send } });
    setStoredRequestContext({
      baseUrl: "https://ssr.example.com/",
      headers: { cookie: "sid=1" },
    });

    await callServer("fn2", []);

    expect(send).toHaveBeenCalledWith("fn2", [], undefined);
  });

  it("warns on double init in non-production", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const send = vi.fn().mockResolvedValue(null);

    initTransport({ adapter: { send } });
    initTransport({ adapter: { send } });

    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("propagates transport errors", async () => {
    const send = vi.fn().mockRejectedValue(new Error("network failure"));
    initTransport({ adapter: { send } });

    await expect(callServer("fn3", [])).rejects.toThrow("network failure");
  });
});

describe("transport types", () => {
  it("only exposes supported HTTP defaults as top-level options", () => {
    const options: TransportOptions = {
      credentials: "include",
      headers: { Authorization: "Bearer xyz" },
    };
    expect(options).toEqual({
      credentials: "include",
      headers: { Authorization: "Bearer xyz" },
    });

    const invalidMode: TransportOptions = {
      // @ts-expect-error Fetch mode is intentionally omitted from transport config.
      mode: "no-cors",
    };
    expect(invalidMode).toEqual({ mode: "no-cors" });

    const invalidCache: TransportOptions = {
      // @ts-expect-error Only explicit transport request defaults are exposed.
      cache: "no-store",
    };
    expect(invalidCache).toEqual({ cache: "no-store" });

    const invalidRequestInit: TransportOptions = {
      // @ts-expect-error requestInit was removed in favor of top-level options.
      requestInit: { credentials: "include" },
    };
    expect(invalidRequestInit).toEqual({
      requestInit: { credentials: "include" },
    });
  });
});

describe("default fetch adapter", () => {
  beforeEach(() => {
    __resetForTesting();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the build-time endpoint define by default", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: "ok" }),
    });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubGlobal("__EVJS_FUNCTION_ENDPOINT__", "/api/rpc");

    await callServer("myFn", []);

    expect(mockFetch).toHaveBeenCalledWith(
      new URL("http://localhost/api/rpc"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("uses the build-time endpoint define when initTransport omits endpoint", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: "ok" }),
    });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubGlobal("__EVJS_FUNCTION_ENDPOINT__", "/api/rpc");

    initTransport({
      headers: { Authorization: "Bearer xyz" },
    });
    await callServer("myFn", []);

    expect(mockFetch).toHaveBeenCalledWith(
      new URL("http://localhost/api/rpc"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("resolves the default endpoint from the current origin root", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: "ok" }),
    });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubGlobal("location", new URL("http://app.example.com/posts/1"));

    initTransport({ functions: { endpoint: "/api/rpc" } });
    await callServer("myFn", []);

    expect(mockFetch).toHaveBeenCalledWith(
      new URL("http://app.example.com/api/rpc"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("resolves the endpoint against baseUrl with URL semantics", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: "ok" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    initTransport({
      baseUrl: "https://api.example.com/backend",
      functions: { endpoint: "/api/rpc" },
    });
    await callServer("myFn", []);

    expect(mockFetch).toHaveBeenCalledWith(
      new URL("https://api.example.com/api/rpc"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("resolves a relative endpoint against the baseUrl path", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: "ok" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    initTransport({
      baseUrl: "https://api.example.com/backend",
      functions: { endpoint: "api/rpc" },
    });
    await callServer("myFn", []);

    expect(mockFetch).toHaveBeenCalledWith(
      new URL("https://api.example.com/backend/api/rpc"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("uses request-scoped baseUrl and headers for SSR calls", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: "ok" }),
    });
    vi.stubGlobal("fetch", mockFetch);
    setStoredRequestContext({
      baseUrl: "https://ssr.example.com/",
      headers: { cookie: "sid=1" },
    });

    initTransport({ functions: { endpoint: "api/fn" } });
    await callServer("myFn", []);

    expect(mockFetch).toHaveBeenCalledWith(
      new URL("https://ssr.example.com/api/fn"),
      expect.objectContaining({
        method: "POST",
      }),
    );
    const headers = new Headers(mockFetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get("cookie")).toBe("sid=1");
  });

  it("supports a complete URL as the endpoint", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: "ok" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    initTransport({
      baseUrl: "https://api.example.com/backend",
      functions: { endpoint: "https://rpc.example.comapi/fn" },
    });
    await callServer("myFn", []);

    expect(mockFetch).toHaveBeenCalledWith(
      new URL("https://rpc.example.comapi/fn"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("adds static headers from config", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: "ok" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    initTransport({
      headers: { Authorization: "Bearer xyz" },
    });
    await callServer("myFn", []);

    const headers = new Headers(mockFetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer xyz");
  });

  it("passes fetch credentials from config", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: "ok" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    initTransport({ credentials: "include" });
    await callServer("myFn", []);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        credentials: "include",
      }),
    );
  });

  it("uses configured headers and request-scoped signal in fetch init", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: "ok" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    initTransport({
      headers: { Authorization: "Bearer config", "x-default": "yes" },
    });
    const signal = new AbortController().signal;
    await callServer("myFn", [], { signal });

    const init = mockFetch.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer config");
    expect(headers.get("x-default")).toBe("yes");
    expect(init?.signal).toBe(signal);
  });

  it("adds dynamic headers via factory function", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: "ok" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    // Provide dynamic async headers
    initTransport({
      headers: async () => ({ Authorization: "Bearer dynamic-token" }),
    });
    await callServer("myFn", []);

    const headers = new Headers(mockFetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer dynamic-token");
  });
});
