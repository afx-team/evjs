import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as publicTransport from "../src/transport.js";
import {
  __resetForTesting,
  callServer,
  createServerReference,
  getFnId,
  getFnName,
  getServerFunction,
  initTransport,
  initTransportFromManifest,
  type ServerFunction,
  type TransportAdapter,
  type TransportOptions,
} from "../src/transport-runtime.js";

describe("createServerReference / getFnId / getFnName", () => {
  beforeEach(() => {
    __resetForTesting();
  });

  it("creates a function and retrieves its ID", () => {
    const fn = createServerReference("test-id", "testFn");
    expect(getFnId(fn)).toBe("test-id");
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
    expect(getServerFunction(fn)).toBeUndefined();
  });

  it("handles creation without export name", () => {
    const fn = createServerReference("no-name");
    expect(getFnId(fn)).toBe("no-name");
    expect(getFnName("no-name")).toBe("no-name"); // fallback
  });

  it("rejects invalid server reference metadata", () => {
    const invalidFnIdError =
      "[evjs] createServerReference() fnId must be a non-empty string without leading or trailing whitespace.";
    const invalidExportNameError =
      "[evjs] createServerReference() exportName must be a non-empty string without leading or trailing whitespace when provided.";

    expect(() => createServerReference("")).toThrow(invalidFnIdError);
    expect(() => createServerReference(42 as never)).toThrow(invalidFnIdError);
    expect(() => createServerReference(" fn1")).toThrow(invalidFnIdError);
    expect(() => createServerReference("fn1 ")).toThrow(invalidFnIdError);
    expect(() => createServerReference("fn1", "")).toThrow(
      invalidExportNameError,
    );
    expect(() => createServerReference("fn1", 42 as never)).toThrow(
      invalidExportNameError,
    );
    expect(() => createServerReference("fn1", " getUser")).toThrow(
      invalidExportNameError,
    );
    expect(() => createServerReference("fn1", "getUser ")).toThrow(
      invalidExportNameError,
    );
  });

  it("resolves registered server function metadata", () => {
    const fn = createServerReference("mod:getUser", "getUser");
    const serverFunction = getServerFunction(fn);

    expect(serverFunction).toBe(fn);
    expect(serverFunction?.fnId).toBe("mod:getUser");
    expect(serverFunction?.queryKey("42")).toEqual(["mod:getUser", "42"]);
  });
});

describe("ServerFunction metadata (.queryKey, .fnId, .fnName)", () => {
  beforeEach(() => {
    __resetForTesting();
  });

  it("attaches .fnId and .fnName on creation", () => {
    const fn = createServerReference("abc123", "getUsers", 1);
    expect(fn.fnId).toBe("abc123");
    expect(fn.fnName).toBe("getUsers");
    expect(fn.fnArity).toBe(1);
  });

  it("makes server function metadata read-only", () => {
    const fn = createServerReference("abc123", "getUsers", 1);

    expect(() => {
      (fn as unknown as { queryKey: () => unknown[] }).queryKey = () => [];
    }).toThrow();
    expect(() => {
      (fn as unknown as { queryOptions: () => unknown }).queryOptions = () => ({
        queryKey: [],
        queryFn: async () => null,
      });
    }).toThrow();
    expect(() => {
      (fn as unknown as { fnId: string }).fnId = "changed";
    }).toThrow();
    expect(() => {
      (fn as unknown as { fnName: string }).fnName = "changed";
    }).toThrow();
    expect(() => {
      (fn as unknown as { fnArity: number }).fnArity = 2;
    }).toThrow();
  });

  it("falls back .fnName to fnId when no export name given", () => {
    const fn = createServerReference("hash-only");
    expect(fn.fnName).toBe("hash-only");
  });

  it("rejects invalid server function arity metadata", () => {
    expect(() => createServerReference("bad-arity", "badArity", -1)).toThrow(
      "[evjs] createServerReference() arity must be a non-negative integer.",
    );
    expect(() => createServerReference("bad-arity", "badArity", 1.5)).toThrow(
      "[evjs] createServerReference() arity must be a non-negative integer.",
    );
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

  it("accepts omitted transport options", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    initTransport();
    initTransport({ adapter: { send }, silent: true });

    await expect(callServer("fn1", [])).resolves.toBe("ok");
    expect(send).toHaveBeenCalledWith("fn1", [], undefined);
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

  it("warns on double init in non-production", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const send = vi.fn().mockResolvedValue(null);

    initTransport({ adapter: { send } });
    initTransport({ adapter: { send } });

    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      "[evjs] initTransport() was called more than once. This overwrites the previous transport configuration.",
    );
    warn.mockRestore();
  });

  it("rejects invalid transport option shapes", () => {
    expect(() => initTransport(null as never)).toThrow(
      "[evjs] initTransport() options must be an object.",
    );
    expect(() => initTransport([] as never)).toThrow(
      "[evjs] initTransport() options must be an object.",
    );
    expect(() => initTransport({ baseUrl: "" })).toThrow(
      "[evjs] initTransport() baseUrl must be a non-empty URL string.",
    );
    expect(() =>
      initTransport({ baseUrl: " https://api.example.com" }),
    ).toThrow(
      "[evjs] initTransport() baseUrl must not contain leading or trailing whitespace.",
    );
    expect(() =>
      initTransport({ baseUrl: "https://api.example.com " }),
    ).toThrow(
      "[evjs] initTransport() baseUrl must not contain leading or trailing whitespace.",
    );
    expect(() => initTransport({ baseUrl: "http://[::1" })).toThrow(
      "[evjs] initTransport() baseUrl must be a valid URL string.",
    );
    expect(() =>
      initTransport({ credentials: "credentialed" as never }),
    ).toThrow(
      '[evjs] initTransport() credentials must be "omit", "same-origin", or "include".',
    );
    expect(() => initTransport({ headers: [["bad"]] as never })).toThrow(
      "[evjs] initTransport() headers must be valid HeadersInit or a header factory.",
    );
    expect(() => initTransport({ headers: null as never })).toThrow(
      "[evjs] initTransport() headers must be valid HeadersInit or a header factory.",
    );
    expect(() => initTransport({ functions: null as never })).toThrow(
      "[evjs] initTransport() functions must be an object.",
    );
    expect(() => initTransport({ functions: [] as never })).toThrow(
      "[evjs] initTransport() functions must be an object.",
    );
    expect(() => initTransport({ functions: { endpoint: "" } })).toThrow(
      "[evjs] initTransport() functions.endpoint must be a non-empty URL string.",
    );
    expect(() =>
      initTransport({ functions: { endpoint: " /api/rpc" } }),
    ).toThrow(
      "[evjs] initTransport() functions.endpoint must not contain leading or trailing whitespace.",
    );
    expect(() =>
      initTransport({ functions: { endpoint: "http://[::1" } }),
    ).toThrow(
      "[evjs] initTransport() functions.endpoint must be a valid URL string.",
    );
    expect(() => initTransport({ adapter: null as never })).toThrow(
      "[evjs] initTransport() adapter must be an object.",
    );
    expect(() => initTransport({ adapter: { send: "send" } as never })).toThrow(
      "[evjs] initTransport() adapter.send must be a function when provided.",
    );
    expect(() =>
      initTransport({
        adapter: { flight: async () => new Response() } as never,
      }),
    ).toThrow(
      "[evjs] initTransport() adapter.flight is not supported. Custom transports only support send(fnId, args, context).",
    );
    expect(() =>
      initTransport({
        adapter: { render: async () => new Response() } as never,
      }),
    ).toThrow(
      "[evjs] initTransport() adapter.render is not supported. Custom transports only support send(fnId, args, context).",
    );
    expect(() => initTransport({ silent: "yes" as never })).toThrow(
      "[evjs] initTransport() silent must be a boolean.",
    );
  });

  it("rejects invalid manifest transport metadata", () => {
    expect(() => initTransportFromManifest(null as never)).toThrow(
      "[evjs] initTransportFromManifest() manifest must be a framework manifest object.",
    );
    expect(() => initTransportFromManifest({ runtime: null } as never)).toThrow(
      "[evjs] initTransportFromManifest() manifest.runtime must be an object.",
    );
    expect(() =>
      initTransportFromManifest({ runtime: { transport: [] } } as never),
    ).toThrow(
      "[evjs] initTransportFromManifest() manifest.runtime.transport must be an object.",
    );
    expect(() =>
      initTransportFromManifest({
        runtime: { transport: { baseUrl: "" } },
      } as never),
    ).toThrow(
      "[evjs] initTransportFromManifest() manifest.runtime.transport.baseUrl must be a non-empty URL string.",
    );
    expect(() =>
      initTransportFromManifest({
        runtime: { transport: { baseUrl: "https://api.example.com " } },
      } as never),
    ).toThrow(
      "[evjs] initTransportFromManifest() manifest.runtime.transport.baseUrl must not contain leading or trailing whitespace.",
    );
    expect(() =>
      initTransportFromManifest({
        runtime: { transport: { baseUrl: "http://[::1" } },
      } as never),
    ).toThrow(
      "[evjs] initTransportFromManifest() manifest.runtime.transport.baseUrl must be a valid URL string.",
    );
  });

  it("rejects invalid server function call payloads before adapters run", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    initTransport({ adapter: { send } });
    const invalidFnIdError =
      "[evjs] callServer() fnId must be a non-empty string without leading or trailing whitespace.";

    await expect(callServer("", [])).rejects.toThrow(invalidFnIdError);
    await expect(callServer(42 as never, [])).rejects.toThrow(invalidFnIdError);
    await expect(callServer(" fn1", [])).rejects.toThrow(invalidFnIdError);
    await expect(callServer("fn1 ", [])).rejects.toThrow(invalidFnIdError);
    await expect(callServer("fn1", { name: "Ada" } as never)).rejects.toThrow(
      "[evjs] callServer() args must be an array.",
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("reports adapters without send using evjs diagnostics", async () => {
    initTransport({ adapter: {} });

    await expect(callServer("fn1", [])).rejects.toThrow(
      "[evjs] Transport adapter does not implement send().",
    );
  });

  it("propagates transport errors", async () => {
    const send = vi.fn().mockRejectedValue(new Error("network failure"));
    initTransport({ adapter: { send } });

    await expect(callServer("fn3", [])).rejects.toThrow("network failure");
  });
});

describe("transport types", () => {
  it("only exposes server-function calls on custom adapters", () => {
    const adapter: TransportAdapter = {
      send: async () => "ok",
    };
    expect(adapter).toEqual({ send: adapter.send });

    const invalidFlightAdapter: TransportAdapter = {
      // @ts-expect-error RSC Flight transport is not part of the stable custom adapter contract.
      flight: async () => new Response(),
    };
    expect(invalidFlightAdapter).toEqual({
      flight: expect.any(Function),
    });

    const invalidRenderAdapter: TransportAdapter = {
      // @ts-expect-error SSR document rendering is not part of the stable custom adapter contract.
      render: async () => new Response(),
    };
    expect(invalidRenderAdapter).toEqual({
      render: expect.any(Function),
    });
  });

  it("only exposes supported HTTP defaults as top-level options", () => {
    const options: TransportOptions = {
      credentials: "include",
      functions: { endpoint: "/api/rpc" },
      headers: { Authorization: "Bearer xyz" },
    };
    expect(options).toEqual({
      credentials: "include",
      functions: { endpoint: "/api/rpc" },
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

    const invalidEndpointOption: TransportOptions = {
      functions: {
        // @ts-expect-error Endpoint must be a URL string.
        endpoint: new URL("https://api.example.com/fn"),
      },
    };
    expect(invalidEndpointOption).toEqual({
      functions: { endpoint: new URL("https://api.example.com/fn") },
    });
  });
});

describe("public transport subpath", () => {
  it("exposes stable transport APIs without framework bootstrap helpers", () => {
    expect(publicTransport.createServerReference).toBe(createServerReference);
    expect(publicTransport.getFnId).toBe(getFnId);
    expect(publicTransport.getFnName).toBe(getFnName);
    expect(publicTransport.initTransport).toBe(initTransport);
    expect("initTransportFromManifest" in publicTransport).toBe(false);
    expect("getServerFunction" in publicTransport).toBe(false);
    expect("__resetForTesting" in publicTransport).toBe(false);
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
    const mockFetch = createSuccessfulFetchMock({ result: "ok" });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubGlobal("__EVJS_FUNCTION_ENDPOINT__", "/api/rpc");

    await callServer("myFn", []);

    expect(mockFetch).toHaveBeenCalledWith(
      new URL("http://localhost/api/rpc"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("resolves undefined when the server function success payload omits result", async () => {
    const mockFetch = createSuccessfulFetchMock({});
    vi.stubGlobal("fetch", mockFetch);
    vi.stubGlobal("__EVJS_FUNCTION_ENDPOINT__", "/api/rpc");

    await expect(callServer("voidFn", [])).resolves.toBeUndefined();
  });

  it("uses the build-time endpoint define when initTransport omits endpoint", async () => {
    const mockFetch = createSuccessfulFetchMock({ result: "ok" });
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

  it("uses initTransport functions endpoint over the build-time endpoint", async () => {
    const mockFetch = createSuccessfulFetchMock({ result: "ok" });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubGlobal("__EVJS_FUNCTION_ENDPOINT__", "/api/fn");

    initTransport({
      functions: { endpoint: "/api/rpc" },
    });
    await callServer("myFn", []);

    expect(mockFetch).toHaveBeenCalledWith(
      new URL("http://localhost/api/rpc"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("resolves the default endpoint from the current origin root", async () => {
    const mockFetch = createSuccessfulFetchMock({ result: "ok" });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubGlobal("location", new URL("http://app.example.com/posts/1"));

    vi.stubGlobal("__EVJS_FUNCTION_ENDPOINT__", "/api/rpc");
    initTransport({});
    await callServer("myFn", []);

    expect(mockFetch).toHaveBeenCalledWith(
      new URL("http://app.example.com/api/rpc"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("resolves the endpoint against baseUrl with URL semantics", async () => {
    const mockFetch = createSuccessfulFetchMock({ result: "ok" });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubGlobal("__EVJS_FUNCTION_ENDPOINT__", "/api/rpc");

    initTransport({
      baseUrl: "https://api.example.com/backend",
    });
    await callServer("myFn", []);

    expect(mockFetch).toHaveBeenCalledWith(
      new URL("https://api.example.com/api/rpc"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("resolves a relative endpoint against the baseUrl path", async () => {
    const mockFetch = createSuccessfulFetchMock({ result: "ok" });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubGlobal("__EVJS_FUNCTION_ENDPOINT__", "api/rpc");

    initTransport({
      baseUrl: "https://api.example.com/backend",
    });
    await callServer("myFn", []);

    expect(mockFetch).toHaveBeenCalledWith(
      new URL("https://api.example.com/backend/api/rpc"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("supports a complete URL as the endpoint", async () => {
    const mockFetch = createSuccessfulFetchMock({ result: "ok" });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubGlobal(
      "__EVJS_FUNCTION_ENDPOINT__",
      "https://rpc.example.com/api/fn",
    );

    initTransport({
      baseUrl: "https://api.example.com/backend",
    });
    await callServer("myFn", []);

    expect(mockFetch).toHaveBeenCalledWith(
      new URL("https://rpc.example.com/api/fn"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("adds static headers from config", async () => {
    const mockFetch = createSuccessfulFetchMock({ result: "ok" });
    vi.stubGlobal("fetch", mockFetch);

    initTransport({
      headers: { Authorization: "Bearer xyz" },
    });
    await callServer("myFn", []);

    const headers = new Headers(mockFetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer xyz");
  });

  it("passes fetch credentials from config", async () => {
    const mockFetch = createSuccessfulFetchMock({ result: "ok" });
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
    const mockFetch = createSuccessfulFetchMock({ result: "ok" });
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

  it("keeps the server function content type owned by the default adapter", async () => {
    const mockFetch = createSuccessfulFetchMock({ result: "ok" });
    vi.stubGlobal("fetch", mockFetch);

    initTransport({
      headers: {
        Authorization: "Bearer config",
        "Content-Type": "text/plain",
      },
    });
    await callServer("myFn", []);

    const headers = new Headers(mockFetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer config");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("adds dynamic headers via factory function", async () => {
    const mockFetch = createSuccessfulFetchMock({ result: "ok" });
    vi.stubGlobal("fetch", mockFetch);

    // Provide dynamic async headers
    initTransport({
      headers: async () => ({ Authorization: "Bearer dynamic-token" }),
    });
    await callServer("myFn", []);

    const headers = new Headers(mockFetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer dynamic-token");
  });

  it("wraps request preparation failures with server function context", async () => {
    const headerError = new Error("missing auth state");
    const mockFetch = createSuccessfulFetchMock({ result: "ok" });
    vi.stubGlobal("fetch", mockFetch);

    initTransport({
      headers: () => {
        throw headerError;
      },
    });
    const getUser = createServerReference("mod:getUser", "getUser");

    await expect(getUser()).rejects.toMatchObject({
      name: "ServerFunctionError",
      message:
        'Server function "getUser" failed to prepare the request: missing auth state',
      fnId: "mod:getUser",
      status: 0,
      cause: headerError,
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("wraps non-serializable server function args with server function context", async () => {
    const mockFetch = createSuccessfulFetchMock({ result: "ok" });
    vi.stubGlobal("fetch", mockFetch);
    const getUser = createServerReference("mod:getUser", "getUser");

    await expect(getUser(1n)).rejects.toMatchObject({
      name: "ServerFunctionError",
      message: expect.stringContaining(
        'Server function "getUser" failed to prepare the request',
      ),
      fnId: "mod:getUser",
      status: 0,
      cause: expect.any(TypeError),
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("wraps fetch failures with server function context", async () => {
    const fetchError = new TypeError("network offline");
    const mockFetch = vi.fn().mockRejectedValue(fetchError);
    vi.stubGlobal("fetch", mockFetch);

    const getUser = createServerReference("mod:getUser", "getUser");

    await expect(getUser()).rejects.toMatchObject({
      name: "ServerFunctionError",
      message:
        'Server function "getUser" failed to reach the server: network offline',
      fnId: "mod:getUser",
      status: 0,
      cause: fetchError,
    });
  });

  it("wraps malformed fetch responses with server function context", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    mockFetch.mockResolvedValueOnce(null);
    await expect(callServer("fn1", [])).rejects.toMatchObject({
      name: "ServerFunctionError",
      message:
        'Server function "fn1" received an invalid fetch Response object: fetch returned a non-object response.',
      fnId: "fn1",
      status: 0,
    });

    mockFetch.mockResolvedValueOnce({});
    await expect(callServer("fn1", [])).rejects.toMatchObject({
      name: "ServerFunctionError",
      message:
        'Server function "fn1" received an invalid fetch Response object: fetch Response.ok must be a boolean.',
      fnId: "fn1",
      status: 0,
    });

    mockFetch.mockResolvedValueOnce({ ok: true });
    await expect(callServer("fn1", [])).rejects.toMatchObject({
      name: "ServerFunctionError",
      message:
        'Server function "fn1" received an invalid fetch Response object: fetch Response.json must be a function.',
      fnId: "fn1",
      status: 0,
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: async () => "failed",
    });
    await expect(callServer("fn1", [])).rejects.toMatchObject({
      name: "ServerFunctionError",
      message:
        'Server function "fn1" received an invalid fetch Response object: fetch Response.status must be a number when ok is false.',
      fnId: "fn1",
      status: 0,
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "failed",
    });
    await expect(callServer("fn1", [])).rejects.toMatchObject({
      name: "ServerFunctionError",
      message:
        'Server function "fn1" received an invalid fetch Response object: fetch Response.statusText must be a string when ok is false.',
      fnId: "fn1",
      status: 0,
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });
    await expect(callServer("fn1", [])).rejects.toMatchObject({
      name: "ServerFunctionError",
      message:
        'Server function "fn1" received an invalid fetch Response object: fetch Response.text must be a function.',
      fnId: "fn1",
      status: 0,
    });
  });

  it("falls back to the HTTP status when error payload status is invalid", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "service unavailable",
          fnId: "mod:getUser",
          status: 200,
          data: { retry: true },
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", mockFetch);

    const getUser = createServerReference("mod:getUser", "getUser");

    await expect(getUser()).rejects.toMatchObject({
      name: "ServerFunctionError",
      message: 'Server function "getUser" threw: service unavailable',
      fnId: "mod:getUser",
      status: 503,
      data: { retry: true },
    });
  });

  it("falls back to the requested function when error payload fnId is invalid", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "not found",
          fnId: " mod:getUser ",
          status: 404,
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", mockFetch);

    const getUser = createServerReference("mod:getUser", "getUser");

    await expect(getUser()).rejects.toMatchObject({
      name: "ServerFunctionError",
      message: 'Server function "getUser" threw: not found',
      fnId: "mod:getUser",
      status: 404,
    });
  });

  it("only trusts structured error envelopes from application/json responses", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "not found",
          fnId: "mod:getUser",
          status: 404,
        }),
        {
          status: 404,
          headers: { "Content-Type": "text/application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", mockFetch);

    const getUser = createServerReference("mod:getUser", "getUser");

    await expect(getUser()).rejects.toMatchObject({
      name: "ServerFunctionError",
      message:
        'Server function "getUser" failed (404): {"error":"not found","fnId":"mod:getUser","status":404}',
      fnId: "mod:getUser",
      status: 404,
    });
  });

  it("uses statusText when HTTP error responses have empty bodies", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 502,
        statusText: "Bad Gateway",
      }),
    );
    vi.stubGlobal("fetch", mockFetch);

    const getUser = createServerReference("mod:getUser", "getUser");

    await expect(getUser()).rejects.toMatchObject({
      name: "ServerFunctionError",
      message: 'Server function "getUser" failed (502): Bad Gateway',
      fnId: "mod:getUser",
      status: 502,
    });
  });

  it("uses statusText when HTTP error responses have whitespace bodies", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response("   \n\t  ", {
        status: 502,
        statusText: "Bad Gateway",
      }),
    );
    vi.stubGlobal("fetch", mockFetch);

    const getUser = createServerReference("mod:getUser", "getUser");

    await expect(getUser()).rejects.toMatchObject({
      name: "ServerFunctionError",
      message: 'Server function "getUser" failed (502): Bad Gateway',
      fnId: "mod:getUser",
      status: 502,
    });
  });

  it("falls back to the default error status for successful error envelopes", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "not found",
          fnId: "mod:getUser",
          status: 200,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", mockFetch);

    const getUser = createServerReference("mod:getUser", "getUser");

    await expect(getUser()).rejects.toMatchObject({
      name: "ServerFunctionError",
      message: 'Server function "getUser" threw: not found',
      fnId: "mod:getUser",
      status: 500,
    });
  });

  it("treats empty server error messages as error payloads", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "", status: 500 }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", mockFetch);

    await expect(callServer("fn1", [])).rejects.toMatchObject({
      name: "ServerFunctionError",
      message: 'Server function "fn1" threw: ',
      fnId: "fn1",
      status: 500,
    });
  });

  it("rejects malformed successful error envelopes", async () => {
    const mockFetch = createSuccessfulFetchMock({ error: true });
    vi.stubGlobal("fetch", mockFetch);

    await expect(callServer("fn1", [])).rejects.toMatchObject({
      name: "ServerFunctionError",
      message: 'Server function "fn1" returned invalid response payload',
      fnId: "fn1",
      status: 200,
    });
  });

  it("rejects successful responses without application/json content type", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ result: "ok" }), {
        status: 200,
        headers: { "Content-Type": "text/application/json" },
      }),
    );
    vi.stubGlobal("fetch", mockFetch);

    await expect(callServer("fn1", [])).rejects.toMatchObject({
      name: "ServerFunctionError",
      message:
        'Server function "fn1" returned invalid response Content-Type "text/application/json"; expected "application/json".',
      fnId: "fn1",
      status: 200,
    });
  });

  it("rejects successful responses with missing content type", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", mockFetch);

    await expect(callServer("fn1", [])).rejects.toMatchObject({
      name: "ServerFunctionError",
      message:
        'Server function "fn1" returned invalid response Content-Type missing Content-Type; expected "application/json".',
      fnId: "fn1",
      status: 200,
    });
  });

  it("rejects successful responses with non-object payloads", async () => {
    const mockFetch = createSuccessfulFetchMock(null);
    vi.stubGlobal("fetch", mockFetch);

    await expect(callServer("fn1", [])).rejects.toMatchObject({
      name: "ServerFunctionError",
      message: 'Server function "fn1" returned invalid response payload',
      fnId: "fn1",
      status: 200,
    });
  });
});

function createSuccessfulFetchMock(payload: unknown): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue(createSuccessfulFetchResponse(payload));
}

function createSuccessfulFetchResponse(payload: unknown): Response {
  return Response.json(payload);
}
