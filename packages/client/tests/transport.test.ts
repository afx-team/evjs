import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetForTesting,
  callServer,
  createServerReference,
  getFnId,
  getFnName,
  initTransport,
  type ServerFunction,
} from "../src/transport.js";

describe("createServerReference / getFnId / getFnName", () => {
  beforeEach(() => {
    __resetForTesting();
  });

  it("creates a function and retrieves its ID", () => {
    const fn = createServerReference("test-id", callServer, "testFn");
    expect(getFnId(fn as never)).toBe("test-id");
  });

  it("retrieves the export name from fnId", () => {
    createServerReference("abc:myFn", callServer, "myFn");
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
    const fn = createServerReference("no-name", callServer);
    expect(getFnId(fn as never)).toBe("no-name");
    expect(getFnName("no-name")).toBe("no-name"); // fallback
  });
});

describe("ServerFunction metadata (.queryKey, .fnId, .fnName)", () => {
  beforeEach(() => {
    __resetForTesting();
  });

  it("attaches .fnId and .fnName on creation", () => {
    const fn = createServerReference("abc123", callServer, "getUsers");
    expect(fn.fnId).toBe("abc123");
    expect(fn.fnName).toBe("getUsers");
  });

  it("makes .fnId and .fnName read-only", () => {
    const fn = createServerReference("abc123", callServer, "getUsers");

    expect(() => {
      (fn as unknown as { fnId: string }).fnId = "changed";
    }).toThrow();
    expect(() => {
      (fn as unknown as { fnName: string }).fnName = "changed";
    }).toThrow();
  });

  it("falls back .fnName to fnId when no export name given", () => {
    const fn = createServerReference("hash-only", callServer);
    expect(fn.fnName).toBe("hash-only");
  });

  it("attaches .queryKey() that returns [fnId]", () => {
    const fn = createServerReference("mod:getUsers", callServer, "getUsers");
    expect(fn.queryKey()).toEqual(["mod:getUsers"]);
  });

  it(".queryKey() includes args", () => {
    const fn = createServerReference("mod:getUser", callServer, "getUser");
    expect(fn.queryKey("abc")).toEqual(["mod:getUser", "abc"]);
    expect(fn.queryKey("abc", 42)).toEqual(["mod:getUser", "abc", 42]);
  });

  it("attaches .queryOptions() that returns TanStack { queryKey, queryFn }", async () => {
    const send = vi.fn().mockResolvedValue("test result");
    initTransport({ transport: { send } });

    const fn = createServerReference(
      "mod:getUser",
      callServer,
      "getUser",
    ) as ServerFunction<[string], unknown>;
    const opts = fn.queryOptions("abc");

    expect(opts.queryKey).toEqual(["mod:getUser", "abc"]);

    // Check queryFn uses callServer properly
    const signal = new AbortController().signal;
    const result = await opts.queryFn({ signal });
    expect(send).toHaveBeenCalledWith("mod:getUser", ["abc"], { signal });
    expect(result).toBe("test result");
  });
});

describe("initTransport + callServer", () => {
  beforeEach(() => {
    __resetForTesting();
  });

  it("calls custom transport.send with fnId and args", async () => {
    const send = vi.fn().mockResolvedValue({ greeting: "hello" });
    initTransport({ transport: { send } });

    const result = await callServer("fn1", ["arg1", "arg2"]);

    expect(send).toHaveBeenCalledWith("fn1", ["arg1", "arg2"], undefined);
    expect(result).toEqual({ greeting: "hello" });
  });

  it("passes context through to transport", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    initTransport({ transport: { send } });

    const signal = new AbortController().signal;
    await callServer("fn2", [], { signal });

    expect(send).toHaveBeenCalledWith("fn2", [], { signal });
  });

  it("warns on double init in non-production", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const send = vi.fn().mockResolvedValue(null);

    initTransport({ transport: { send } });
    initTransport({ transport: { send } });

    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("propagates transport errors", async () => {
    const send = vi.fn().mockRejectedValue(new Error("network failure"));
    initTransport({ transport: { send } });

    await expect(callServer("fn3", [])).rejects.toThrow("network failure");
  });
});

describe("createFetchTransport (default)", () => {
  beforeEach(() => {
    __resetForTesting();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds static headers from config", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: "ok" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    initTransport({ headers: { Authorization: "Bearer xyz" } });
    await callServer("myFn", []);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer xyz",
        }),
      }),
    );
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

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer dynamic-token",
        }),
      }),
    );
  });
});
